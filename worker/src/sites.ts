/*
 * Hosted sites, ours now: static files in the `malipetek-sites` R2 bucket,
 * served by the malipetek-sites Worker on malipetek.online.
 *
 *   <slug>.malipetek.online            production
 *   <slug>--preview.malipetek.online   preview
 *
 * A deploy is immutable: files are content-addressed blobs under
 * `sites/<slug>/blobs/<sha256>` and a manifest at
 * `sites/<slug>/deploys/<id>/manifest.json` maps path → hash. Preview and
 * production are pointers to deploy ids, so publishing and rolling back move
 * a pointer and nothing is rebuilt.
 *
 * `advanceSite` is still one idempotent step of a state machine, driven by
 * the portal while the client watches and by the cron when nobody is looking.
 * What it waits for now is a fleet node, not a control plane: allocation
 * makes the placeholder deploy itself, then a node creates the source repo
 * (the Worker has no git credentials) and reports it back.
 */
import { getSettings } from './queue.ts';
import { now, type Env } from './shared.ts';

export type SiteState = 'allocating' | 'ready' | 'failed';

export interface SiteRow {
  project_id: string;
  slug: string;
  state: SiteState;
  host: 'ours' | 'cloudflare';
  template: string | null;
  preview_deploy: string | null;
  production_deploy: string | null;
  spa: number;
  custom_domain: string | null;
  error: string | null;
  failure_alerted_at: number | null;
  rebuild_requested_at: number | null;
  rebuild_error: string | null;
  created_at: number;
  updated_at: number;
}

/** What the portal and the admin views show about a site. */
export interface SiteView {
  state: SiteState;
  slug: string;
  previewUrl: string | null;
  productionUrl: string | null;
  customDomain: string | null;
  error: string | null;
  previewDeploy: string | null;
  productionDeploy: string | null;
  rebuildRequestedAt: number | null;
  rebuildError: string | null;
  updatedAt: number;
}

/** The domain hosted sites live under when the setting does not say. */
export const DEFAULT_SITES_DOMAIN = 'malipetek.online';

function urls(row: Pick<SiteRow, 'slug' | 'custom_domain'>, domain: string) {
  return {
    previewUrl: `https://${row.slug}--preview.${domain}`,
    productionUrl: `https://${row.slug}.${domain}`,
    customDomain: row.custom_domain,
  };
}

export function siteView(row: SiteRow | null | undefined, domain = DEFAULT_SITES_DOMAIN): SiteView | null {
  if (!row) return null;
  return {
    state: row.state,
    slug: row.slug,
    ...urls(row, domain),
    error: row.error,
    previewDeploy: row.preview_deploy,
    productionDeploy: row.production_deploy,
    rebuildRequestedAt: row.rebuild_requested_at ?? null,
    rebuildError: row.rebuild_error ?? null,
    updatedAt: row.updated_at,
  };
}

/* ——————————————————————— deploy storage ——————————————————————— */

/** What one uploaded deploy may hold. Shared with the node's own check. */
export const DEPLOY_LIMITS = {
  files: 1000,
  fileBytes: 10 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
};

/** Deploys kept per site, plus whichever ones a channel points at. */
export const KEPT_DEPLOYS = 20;

const manifestKey = (slug: string, deploy: string) => `sites/${slug}/deploys/${deploy}/manifest.json`;
const blobKey = (slug: string, sha: string) => `sites/${slug}/blobs/${sha}`;

const SAFE_PATH = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[\w.@+\-/ ]{1,300}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export interface DeployFile {
  path: string;
  sha256: string;
  size: number;
  type?: string;
}

/** Bound a deploy manifest, or say why not. The error is the reply to send. */
export function cleanDeployManifest(value: unknown): { files: DeployFile[]; bytes: number } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) return { error: 'no files' };
  if (value.length > DEPLOY_LIMITS.files) return { error: `${value.length} files; a deploy takes at most ${DEPLOY_LIMITS.files}` };
  const files: DeployFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const raw of value as Record<string, unknown>[]) {
    const path = typeof raw?.path === 'string' ? raw.path : '';
    const sha256 = typeof raw?.sha256 === 'string' ? raw.sha256.toLowerCase() : '';
    const size = typeof raw?.size === 'number' ? raw.size : NaN;
    const type = typeof raw?.type === 'string' && raw.type.length <= 100 ? raw.type : undefined;
    if (!SAFE_PATH.test(path) || path.startsWith('.git/') || path === '.git') {
      return { error: `bad file entry ${JSON.stringify(path).slice(0, 80)}` };
    }
    if (!SHA256.test(sha256)) return { error: `bad sha256 for ${JSON.stringify(path).slice(0, 80)}` };
    if (!Number.isInteger(size) || size < 0 || size > DEPLOY_LIMITS.fileBytes) {
      return { error: `bad size for ${JSON.stringify(path).slice(0, 80)}` };
    }
    if (seen.has(path)) return { error: `${path} is listed twice` };
    seen.add(path);
    total += size;
    files.push({ path, sha256, size, ...(type ? { type } : {}) });
  }
  if (total > DEPLOY_LIMITS.totalBytes) return { error: 'the files add up to more than 100 MB' };
  return { files, bytes: total };
}

/** The deploy id: the manifest's own hash, so identical output is one deploy. */
async function deployId(files: DeployFile[], source: SourceFile[], siteConfig: SiteConfig): Promise<string> {
  const canonical = JSON.stringify({
    files: files.map((f) => [f.path, f.sha256, f.size]).sort(),
    source: source.map((f) => [f.path, f.sha256, f.size]).sort(),
    siteConfig,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `d${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40)}`;
}

export type SourceFile = { path: string; sha256: string; size: number };
export type SiteConfig = { build?: string; output?: string };
const SOURCE_LIMITS = { files: 500, fileBytes: 512 * 1024, totalBytes: 20 * 1024 * 1024 };

/**
 * Bound a manifest's `source` map (the worktree the deploy was built from, so
 * a client's agent can read the site without git access). Optional.
 */
function cleanSourceManifest(value: unknown): { source: SourceFile[] } | { error: string } {
  if (value === undefined || value === null) return { source: [] };
  if (!Array.isArray(value) || value.length > SOURCE_LIMITS.files) return { error: 'bad source manifest' };
  const source: SourceFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const raw of value as Record<string, unknown>[]) {
    const path = typeof raw?.path === 'string' ? raw.path : '';
    const sha256 = typeof raw?.sha256 === 'string' ? raw.sha256.toLowerCase() : '';
    const size = typeof raw?.size === 'number' ? raw.size : NaN;
    if (!SAFE_PATH.test(path) || path.startsWith('.git/') || path === '.git' || !SHA256.test(sha256) || !Number.isInteger(size) || size < 0 || size > SOURCE_LIMITS.fileBytes || seen.has(path)) {
      return { error: `bad source entry ${JSON.stringify(path).slice(0, 80)}` };
    }
    seen.add(path);
    total += size;
    source.push({ path, sha256, size });
  }
  if (total > SOURCE_LIMITS.totalBytes) return { error: 'the source adds up to more than 20 MB' };
  return { source };
}

/** Which of `shas` are not yet stored for this site. */
async function missingBlobs(env: Env, slug: string, shas: string[]): Promise<string[]> {
  const missing: string[] = [];
  // Bounded by DEPLOY_LIMITS.files; head calls in small batches.
  for (let i = 0; i < shas.length; i += 50) {
    const batch = await Promise.all(shas.slice(i, i + 50).map((sha) => env.SITES!.head(blobKey(slug, sha))));
    batch.forEach((object, j) => {
      if (!object) missing.push(shas[i + j]);
    });
  }
  return missing;
}

const sha256Hex = async (data: ArrayBuffer | Uint8Array) => {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/* ——————————————————————— the site row ——————————————————————— */

export async function getSite(env: Env, projectId: string): Promise<SiteRow | null> {
  return env.DB.prepare('SELECT * FROM sites WHERE project_id = ?').bind(projectId).first<SiteRow>();
}

export async function getSiteBySlug(env: Env, slug: string): Promise<SiteRow | null> {
  return env.DB.prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first<SiteRow>();
}

async function save(env: Env, projectId: string, patch: Partial<SiteRow>): Promise<void> {
  const keys = Object.keys(patch) as (keyof SiteRow)[];
  if (!keys.length) return;
  await env.DB.prepare(`UPDATE sites SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE project_id = ?`)
    .bind(...keys.map((k) => patch[k] ?? null), now(), projectId)
    .run();
}

/* ——————————————————————— slugs ——————————————————————— */

/** Names a client site may never take, on either channel. */
const RESERVED_SLUGS = new Set(['www', 'api', 'admin', 'portal', 'mail', 'preview', 'sites']);

export function cleanSiteSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  // `--` is the preview marker, so a site slug may never contain it.
  return /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/.test(slug) && !slug.includes('--') && !RESERVED_SLUGS.has(slug)
    ? slug
    : null;
}

/** A site slug no site holds: the project's own slug, then -2, -3, … */
async function uniqueSiteSlug(env: Env, base: string): Promise<string | null> {
  const first = cleanSiteSlug(base);
  if (!first) return null;
  for (let n = 1; n <= 20; n += 1) {
    const slug = n === 1 ? first : `${first}-${n}`;
    if (!cleanSiteSlug(slug)) continue;
    const taken = await env.DB.prepare('SELECT 1 FROM sites WHERE slug = ?').bind(slug).first();
    if (!taken) return slug;
  }
  return null;
}

/* ——————————————————————— allocation ——————————————————————— */

/** Waiting this long for a node to make the repo stops the site. */
const ALLOCATE_TIMEOUT_SECONDS = 30 * 60;

const PLACEHOLDER_DEPLOY = 'placeholder';

function placeholderHtml(name: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font-family: ui-sans-serif, system-ui, sans-serif; background: #f6f3ec; color: #2a2620; }
  main { max-width: 34rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.6rem; font-weight: 600; margin: 0 0 .75rem; }
  p { color: #6d6558; line-height: 1.6; margin: 0; }
</style>
</head>
<body><main>
<h1>${name}</h1>
<p>This site is being built. The first real version lands here soon.</p>
</main></body>
</html>
`;
}

/**
 * The standing-in site: a single page so both addresses answer while the
 * source repo is being made. Written through the same manifest+blob shape as
 * a real deploy, under the fixed id `placeholder`.
 */
async function placeholderDeploy(env: Env, slug: string, name: string): Promise<void> {
  const html = new TextEncoder().encode(placeholderHtml(name));
  const sha = await sha256Hex(html);
  await env.SITES!.put(blobKey(slug, sha), html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
  const manifest = {
    files: { 'index.html': { sha, size: html.length, type: 'text/html; charset=utf-8' } },
    placeholder: true,
  };
  await env.SITES!.put(manifestKey(slug, PLACEHOLDER_DEPLOY), JSON.stringify(manifest), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/**
 * Start hosting a project. Idempotent: a project that already has a site is
 * returned as it is; a failed one starts over.
 */
export async function startSite(
  env: Env,
  user: { id: string },
  project: { id: string; name: string; slug: string },
): Promise<SiteRow> {
  const existing = await getSite(env, project.id);
  if (existing && existing.state !== 'failed') return advanceSite(env, project.id);
  const slug = await uniqueSiteSlug(env, project.slug);
  if (!slug) throw new Error('No free site address left for this name.');
  const t = now();
  await env.DB.prepare(
    `INSERT INTO sites (project_id, slug, state, template, created_at, updated_at)
     VALUES (?, ?, 'allocating', 'site', ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET state = 'allocating', slug = excluded.slug,
       preview_deploy = NULL, production_deploy = NULL, error = NULL, failure_alerted_at = NULL,
       updated_at = excluded.updated_at`,
  )
    .bind(project.id, slug, t, t)
    .run();
  return advanceSite(env, project.id);
}

/**
 * Move one site one step forward. Never throws for a storage failure: the
 * site records it instead.
 */
export async function advanceSite(env: Env, projectId: string): Promise<SiteRow> {
  let site = await getSite(env, projectId);
  if (!site) throw new Error('no site');
  try {
    for (let step = 0; step < 4 && site.state !== 'ready' && site.state !== 'failed'; step += 1) {
      const before = `${site.state}:${site.preview_deploy}`;
      await stepSite(env, site);
      site = (await getSite(env, projectId))!;
      if (`${site.state}:${site.preview_deploy}` === before) break; // waiting on a node
    }
  } catch (error) {
    // A storage blip or our own bug: keep the state, record why, try next time.
    await save(env, projectId, { error: ((error as Error)?.message ?? 'unknown error').slice(0, 500) });
    site = (await getSite(env, projectId))!;
  }
  return site;
}

async function stepSite(env: Env, site: SiteRow): Promise<void> {
  if (site.state !== 'allocating') return;
  if (!site.preview_deploy) {
    const project = await env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(site.project_id).first<{ name: string }>();
    await placeholderDeploy(env, site.slug, project?.name ?? site.slug);
    await save(env, site.project_id, { preview_deploy: PLACEHOLDER_DEPLOY, production_deploy: PLACEHOLDER_DEPLOY });
    return;
  }
  const project = await env.DB.prepare('SELECT repo FROM projects WHERE id = ?').bind(site.project_id).first<{ repo: string | null }>();
  if (project?.repo) {
    await save(env, site.project_id, { state: 'ready', error: null });
    return;
  }
  if (now() - site.created_at > ALLOCATE_TIMEOUT_SECONDS) {
    await save(env, site.project_id, {
      state: 'failed',
      error: 'No machine created the source repo in 30 minutes. Check the fleet is online, then retry.',
    });
  }
}

/** Every site still being allocated, one step each. The cron's half. */
export async function advanceSites(env: Env): Promise<SiteRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT project_id FROM sites WHERE state = 'allocating' AND updated_at < ? LIMIT 20`,
  )
    .bind(now() - 30)
    .all<{ project_id: string }>();
  const out: SiteRow[] = [];
  for (const row of results ?? []) out.push(await advanceSite(env, row.project_id));
  return out;
}

/** Failed sites Ali has not been told about yet; marks them told. */
export async function takeNewSiteFailures(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT s.project_id, s.error, p.name, p.slug FROM sites s JOIN projects p ON p.id = s.project_id
      WHERE s.state = 'failed' AND s.failure_alerted_at IS NULL`,
  ).all<{ project_id: string; error: string | null; name: string; slug: string }>();
  if (results?.length) {
    await env.DB.batch(
      results.map((r) => env.DB.prepare('UPDATE sites SET failure_alerted_at = ? WHERE project_id = ?').bind(now(), r.project_id)),
    );
  }
  return results ?? [];
}

/* ——————————————————————— deploys ——————————————————————— */

export interface SiteDeployRow {
  id: string;
  project_id: string;
  ticket_id: number | null;
  commit_sha: string | null;
  files: number;
  bytes: number;
  created_at: number;
}

export async function listDeploys(env: Env, projectId: string, limit = 50): Promise<SiteDeployRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM site_deploys WHERE project_id = ? ORDER BY created_at DESC LIMIT ?',
  )
    .bind(projectId, Math.min(200, limit))
    .all<SiteDeployRow>();
  return results ?? [];
}

/**
 * Open a deploy: record its manifest and answer which blobs the store still
 * lacks. The manifest is written at once — it is content-addressed, so the
 * same body is the same deploy and a retry is free.
 */
export async function createDeploy(
  env: Env,
  slug: string,
  rawFiles: unknown,
  rawSource?: unknown,
  rawSiteConfig?: unknown,
): Promise<{ deployId: string; needed: string[]; files: DeployFile[] } | { error: string }> {
  if (!env.SITES) return { error: 'sites_unavailable' };
  const site = await getSiteBySlug(env, slug);
  if (!site || site.host !== 'ours') return { error: 'not_found' };
  const cleaned = cleanDeployManifest(rawFiles);
  if ('error' in cleaned) return cleaned;
  const source = cleanSourceManifest(rawSource);
  if ('error' in source) return source;
  const siteConfig: SiteConfig = {};
  const conf = rawSiteConfig as Record<string, unknown> | null;
  if (conf && typeof conf === 'object') {
    if (typeof conf.build === 'string' && conf.build.length <= 300) siteConfig.build = conf.build;
    if (typeof conf.output === 'string' && SAFE_PATH.test(conf.output) && conf.output.length <= 80) siteConfig.output = conf.output;
  }
  const id = await deployId(cleaned.files, source.source, siteConfig);
  const manifest = {
    files: Object.fromEntries(cleaned.files.map((f) => [f.path, { sha: f.sha256, size: f.size, ...(f.type ? { type: f.type } : {}) }])),
    ...(source.source.length ? { source: Object.fromEntries(source.source.map((f) => [f.path, { sha: f.sha256, size: f.size }])) } : {}),
    ...(Object.keys(siteConfig).length ? { siteConfig } : {}),
  };
  await env.SITES.put(manifestKey(slug, id), JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json' } });
  const shas = [...new Set([...cleaned.files.map((f) => f.sha256), ...source.source.map((f) => f.sha256)])];
  const needed = await missingBlobs(env, slug, shas);
  return { deployId: id, needed, files: cleaned.files };
}

/** One blob of an open deploy. The sha in the path must match the bytes. */
export async function uploadDeployBlob(
  env: Env,
  slug: string,
  deploy: string,
  sha: string,
  body: ArrayBuffer,
): Promise<{ ok: true } | { error: string }> {
  if (!env.SITES) return { error: 'sites_unavailable' };
  if (!SHA256.test(sha)) return { error: 'bad_sha' };
  if (body.byteLength === 0 || body.byteLength > DEPLOY_LIMITS.fileBytes) return { error: 'bad_size' };
  const manifestObject = await env.SITES.get(manifestKey(slug, deploy));
  if (!manifestObject) return { error: 'not_found' };
  const manifest = (await manifestObject.json()) as {
    files?: Record<string, { sha: string; type?: string }>;
    source?: Record<string, { sha: string }>;
  };
  const entry = Object.values(manifest.files ?? {}).find((f) => f.sha === sha);
  const sourceEntry = Object.values(manifest.source ?? {}).find((f) => f.sha === sha);
  if (!entry && !sourceEntry) return { error: 'not_in_manifest' };
  const digest = await sha256Hex(body);
  if (digest !== sha) return { error: 'sha_mismatch' };
  await env.SITES.put(blobKey(slug, sha), body, {
    httpMetadata: entry?.type ? { contentType: entry.type } : undefined,
  });
  return { ok: true };
}

/**
 * Close a deploy: every blob present, the row recorded, the preview pointed
 * at it. Production is untouched — only publish moves that pointer.
 */
export async function finishDeploy(
  env: Env,
  slug: string,
  deploy: string,
  meta: { ticketId?: number; commitSha?: string } = {},
): Promise<{ deployId: string; previewUrl: string; files: number; bytes: number } | { error: string }> {
  if (!env.SITES) return { error: 'sites_unavailable' };
  const site = await getSiteBySlug(env, slug);
  if (!site) return { error: 'not_found' };
  const manifestObject = await env.SITES.get(manifestKey(slug, deploy));
  if (!manifestObject) return { error: 'not_found' };
  const manifest = (await manifestObject.json()) as {
    files: Record<string, { sha: string; size: number }>;
    source?: Record<string, { sha: string }>;
  };
  const shas = [...new Set([...Object.values(manifest.files ?? {}).map((f) => f.sha), ...Object.values(manifest.source ?? {}).map((f) => f.sha)])];
  const missing = await missingBlobs(env, slug, shas);
  if (missing.length) return { error: `missing ${missing.length} file(s)` };

  const files = Object.keys(manifest.files ?? {}).length;
  const bytes = Object.values(manifest.files ?? {}).reduce((n, f) => n + f.size, 0);
  const t = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO site_deploys (id, project_id, ticket_id, commit_sha, files, bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    ).bind(deploy, site.project_id, meta.ticketId ?? null, meta.commitSha ?? null, files, bytes, t),
    env.DB.prepare('UPDATE sites SET preview_deploy = ?, rebuild_error = NULL, updated_at = ? WHERE project_id = ?').bind(deploy, t, site.project_id),
  ]);
  const { sitesDomain } = await getSettings(env);
  return { deployId: deploy, previewUrl: `https://${slug}--preview.${sitesDomain}`, files, bytes };
}

/** Production takes the deploy the preview is on. The caller decides who may. */
export async function publishSite(env: Env, projectId: string): Promise<{ productionUrl: string } | { error: string }> {
  const site = await getSite(env, projectId);
  if (!site) return { error: 'not_found' };
  if (site.state !== 'ready' || !site.preview_deploy) return { error: 'not_ready' };
  await env.DB.prepare('UPDATE sites SET production_deploy = preview_deploy, updated_at = ? WHERE project_id = ?')
    .bind(now(), projectId)
    .run();
  const { sitesDomain } = await getSettings(env);
  return { productionUrl: `https://${site.slug}.${sitesDomain}` };
}

/** Production goes back to an older deploy of this same site. */
export async function rollbackSite(env: Env, projectId: string, deployId: string): Promise<{ productionUrl: string } | { error: string }> {
  const site = await getSite(env, projectId);
  if (!site) return { error: 'not_found' };
  const deploy = await env.DB.prepare('SELECT 1 FROM site_deploys WHERE id = ? AND project_id = ?')
    .bind(deployId, projectId)
    .first();
  if (!deploy) return { error: 'unknown_deploy' };
  await env.DB.prepare('UPDATE sites SET production_deploy = ?, updated_at = ? WHERE project_id = ?')
    .bind(deployId, now(), projectId)
    .run();
  const { sitesDomain } = await getSettings(env);
  return { productionUrl: `https://${site.slug}.${sitesDomain}` };
}

/**
 * A node's report that it created the source repo: fill the project's blank
 * repo and move the site on. The repo column is never overwritten.
 */
export async function reportSiteRepo(env: Env, slug: string, repo: string): Promise<SiteRow | { code: string }> {
  const site = await getSiteBySlug(env, slug);
  if (!site) return { code: 'not_found' };
  await env.DB.prepare(`UPDATE projects SET repo = ?, repo_kind = 'repo' WHERE id = ? AND (repo IS NULL OR repo = '')`)
    .bind(repo, site.project_id)
    .run();
  return advanceSite(env, site.project_id);
}

/** Deploys past KEPT_DEPLOYS no channel points at: manifest and row gone, blobs too when nothing references them. */
export async function pruneDeploys(env: Env): Promise<void> {
  if (!env.SITES) return;
  const { results: sites } = await env.DB.prepare('SELECT project_id, slug, preview_deploy, production_deploy FROM sites')
    .all<{ project_id: string; slug: string; preview_deploy: string | null; production_deploy: string | null }>();
  for (const site of sites ?? []) {
    const pointed = new Set([site.preview_deploy, site.production_deploy].filter(Boolean) as string[]);
    const deploys = await listDeploys(env, site.project_id, KEPT_DEPLOYS + 50);
    const keep = new Set(pointed);
    for (const deploy of deploys.slice(0, KEPT_DEPLOYS)) keep.add(deploy.id);
    const drop = deploys.filter((d) => !keep.has(d.id)).map((d) => d.id);
    if (!drop.length) continue;

    const statements = drop.map((id) => env.DB.prepare('DELETE FROM site_deploys WHERE id = ?').bind(id));
    await env.DB.batch(statements);
    for (const id of drop) await env.SITES.delete(manifestKey(site.slug, id));

    // Blobs no kept manifest names: list this site's blobs, read its kept
    // manifests, delete the difference. Bounded by the site's own prefix.
    const referenced = new Set<string>();
    for (const id of keep) {
      const object = await env.SITES.get(manifestKey(site.slug, id));
      if (!object) continue;
      const manifest = (await object.json().catch(() => null)) as { files?: Record<string, { sha: string }> } | null;
      for (const file of Object.values(manifest?.files ?? {})) referenced.add(file.sha);
    }
    const blobs = await env.SITES.list({ prefix: `sites/${site.slug}/blobs/` });
    const orphans = blobs.objects.map((o) => o.key).filter((key) => !referenced.has(key.split('/').pop() ?? ''));
    if (orphans.length) await env.SITES.delete(orphans);
  }
}

/** Where a site's addresses point, for a view or a tool reply. */
export async function siteState(env: Env, projectId: string) {
  const site = await getSite(env, projectId);
  if (!site) return null;
  const { sitesDomain } = await getSettings(env);
  return { site: siteView(site, sitesDomain), deploys: await listDeploys(env, projectId) };
}

/* ——————————————————————— the workspace ——————————————————————— */

/*
 * A deploy's manifest can carry a `source` map — the worktree's own files,
 * content-addressed in the same blob store. That is what a client's agent
 * reads through the workspace tools: the source tree as the preview deploy
 * was built from, without the Worker needing git access.
 */
interface WorkspaceManifest {
  files?: Record<string, { sha: string; size: number; type?: string }>;
  source?: Record<string, { sha: string; size: number }>;
  siteConfig?: { build?: string; output?: string };
}

async function previewManifest(env: Env, projectId: string): Promise<{ slug: string; manifest: WorkspaceManifest } | null> {
  if (!env.SITES) return null;
  const site = await getSite(env, projectId);
  if (!site?.preview_deploy) return null;
  const object = await env.SITES.get(manifestKey(site.slug, site.preview_deploy));
  if (!object) return null;
  return { slug: site.slug, manifest: (await object.json().catch(() => ({}))) as WorkspaceManifest };
}

/** The source tree the current preview was built from. */
export async function workspaceFor(env: Env, projectId: string) {
  const found = await previewManifest(env, projectId);
  if (!found) return null;
  return {
    files: Object.keys(found.manifest.source ?? {}).sort(),
    siteConfig: found.manifest.siteConfig ?? null,
  };
}

/** One source file's text, or null. Bounded by what a node may upload. */
export async function workspaceRead(env: Env, projectId: string, path: string): Promise<{ content: string } | null> {
  if (!SAFE_PATH.test(path)) return null;
  const found = await previewManifest(env, projectId);
  const entry = found?.manifest.source?.[path];
  if (!found || !entry) return null;
  const object = await env.SITES!.get(blobKey(found.slug, entry.sha));
  if (!object || entry.size > DEPLOY_LIMITS.fileBytes) return null;
  return { content: await object.text() };
}

