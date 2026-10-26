/*
 * Provisioning: a project gets a hosted site, preview first, without Ali.
 *
 * The control plane (platform.ts) already creates and hosts Astro + Keystatic
 * sites: draft → provision (repo + Workers Builds) → preview branch → approve →
 * production. This module drives that pipeline for a CLIENT, server-side:
 *
 *   - Isolation comes from the platform's own sign-in. It mails a magic link
 *     to an address and scopes every later call to that account; we only ever
 *     ask it for the address the client verified with us, so a client can
 *     never reach another client's sites.
 *   - The platform key never leaves the Worker.
 *   - `advanceSite` is one idempotent step of a state machine. The portal calls
 *     it while the client watches; the five-minute cron calls it when nobody
 *     is looking. A step that is still waiting costs one platform read.
 *
 * The control plane's replies are read defensively (`pick`): this repo does
 * not own its source, so every field is looked up by the names it is known or
 * likely to use, and the trimmed reply is kept in `last_payload` so a surprise
 * shows up in the admin views instead of as a silent "pending" forever.
 */
import { PlatformError, platformFetch } from './platform.ts';
import { getSettings } from './queue.ts';
import { now, type Env } from './shared.ts';
import { parseBrief, type ProjectKind } from './setup.ts';

export type SiteState = 'signin' | 'creating' | 'provisioning' | 'ready' | 'failed';

export interface SiteRow {
  project_id: string;
  user_id: string;
  site_id: string | null;
  state: SiteState;
  operation_id: string | null;
  platform_slug: string | null;
  repo_url: string | null;
  preview_url: string | null;
  editor_url: string | null;
  production_url: string | null;
  custom_domain: string | null;
  error: string | null;
  last_payload: string | null;
  preview_updated_at: number | null;
  failure_alerted_at: number | null;
  created_at: number;
  updated_at: number;
}

/** What the portal and the admin views show about a site. */
export interface SiteView {
  state: SiteState;
  previewUrl: string | null;
  editorUrl: string | null;
  productionUrl: string | null;
  customDomain: string | null;
  repoUrl: string | null;
  error: string | null;
  previewUpdatedAt: number | null;
  updatedAt: number;
}

export function siteView(row: SiteRow | null | undefined): SiteView | null {
  if (!row) return null;
  return {
    state: row.state,
    previewUrl: row.preview_url,
    editorUrl: row.editor_url,
    productionUrl: row.production_url,
    customDomain: row.custom_domain,
    repoUrl: row.repo_url,
    error: row.error,
    previewUpdatedAt: row.preview_updated_at,
    updatedAt: row.updated_at,
  };
}

/** The edit-preview limits the control plane enforces; checked here first. */
export const PREVIEW_LIMITS = { files: 40, fileBytes: 512 * 1024, totalBytes: 2 * 1024 * 1024 };

/* ——————————————————————— reading the platform's replies ——————————————————————— */

/** The first string (or number) found at any of `paths` ("a.b.c"). */
export function pick(value: unknown, ...paths: string[]): string | null {
  for (const path of paths) {
    let cur: unknown = value;
    for (const key of path.split('.')) {
      cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[key] : undefined;
    }
    if (typeof cur === 'string' && cur.trim()) return cur.trim();
    if (typeof cur === 'number' && Number.isFinite(cur)) return String(cur);
  }
  return null;
}

const DONE = new Set(['succeeded', 'success', 'successful', 'completed', 'complete', 'done', 'ready', 'finished']);
const FAILED = new Set(['failed', 'failure', 'error', 'errored', 'cancelled', 'canceled', 'timed_out']);

/** An operation's outcome: done, failed (with why), or still running. */
export function operationOutcome(payload: unknown): { done: boolean; failed: string | null } {
  const status = (pick(payload, 'status', 'state', 'operation.status', 'operation.state') ?? '').toLowerCase();
  const raw = payload as Record<string, unknown> | null;
  if (FAILED.has(status) || raw?.ok === false) {
    return { done: false, failed: pick(payload, 'error.message', 'error', 'message', 'operation.error') ?? status ?? 'failed' };
  }
  return { done: DONE.has(status) || raw?.done === true || raw?.completed === true, failed: null };
}

const httpsUrl = (value: string | null): string | null => {
  if (!value) return null;
  const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(url).protocol === 'https:' || new URL(url).protocol === 'http:' ? url.replace(/\/$/, '') : null;
  } catch {
    return null;
  }
};

/**
 * The URLs a provisioned site answers on. The platform's own fields win; when
 * it only names the site's slug, the URLs are built from the configured sites
 * domain, which is how the platform lays them out.
 */
export function siteUrls(payload: unknown, domain: string) {
  const slug = pick(payload, 'slug', 'site.slug', 'siteSlug', 'subdomain', 'site.subdomain');
  const base = slug ? `https://${slug}.${domain}` : null;
  const production = httpsUrl(
    pick(payload, 'productionUrl', 'production_url', 'urls.production', 'site.productionUrl', 'liveUrl', 'url', 'site.url'),
  ) ?? base;
  return {
    slug,
    production,
    preview:
      httpsUrl(pick(payload, 'previewUrl', 'preview_url', 'urls.preview', 'site.previewUrl', 'preview.url')) ??
      (slug ? `https://${slug}-preview.${domain}` : null),
    editor:
      httpsUrl(pick(payload, 'editorUrl', 'editor_url', 'urls.editor', 'site.editorUrl', 'keystaticUrl')) ??
      (production ? `${production}/keystatic` : null),
    repo: httpsUrl(
      pick(payload, 'repoUrl', 'repo_url', 'repository.htmlUrl', 'repository.url', 'repo.url', 'repo.htmlUrl', 'site.repoUrl'),
    ),
    domain: pick(payload, 'customDomain', 'custom_domain', 'domain.name', 'site.customDomain'),
  };
}

const trimPayload = (payload: unknown) => {
  try {
    return JSON.stringify(payload).slice(0, 4000);
  } catch {
    return null;
  }
};

/* ——————————————————————— sign-in ——————————————————————— */

interface Account {
  user_id: string;
  email: string;
  auth_request_id: string;
  state: 'pending' | 'verified' | 'expired';
}

const isExpired = (error: unknown) =>
  error instanceof PlatformError && /AUTH_REQUEST_EXPIRED|expired|start-?auth again|sign-?in again/i.test(error.message);

/** Ask the platform for a sign-in for this user's verified address. */
async function startSignIn(env: Env, userId: string, email: string): Promise<void> {
  const res = await platformFetch(env, '/api/gpt/bootstrap/start-auth', { method: 'POST', body: { email } });
  const id = pick(res, 'authRequestId', 'auth_request_id', 'id');
  if (!id) throw new PlatformError('The platform started a sign-in but returned no authRequestId.');
  const t = now();
  await env.DB.prepare(
    `INSERT INTO platform_accounts (user_id, email, auth_request_id, state, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, auth_request_id = excluded.auth_request_id,
       state = 'pending', updated_at = excluded.updated_at`,
  )
    .bind(userId, email, id, t, t)
    .run();
}

/** The user's platform sign-in, checked against the platform when still pending. */
async function account(env: Env, userId: string): Promise<Account | null> {
  const row = await env.DB.prepare('SELECT user_id, email, auth_request_id, state FROM platform_accounts WHERE user_id = ?')
    .bind(userId)
    .first<Account>();
  if (!row || row.state !== 'pending') return row;
  try {
    const status = await platformFetch(env, '/api/gpt/bootstrap/auth-status', { query: { authRequestId: row.auth_request_id } });
    const s = (pick(status, 'status', 'state') ?? '').toLowerCase();
    const verified = s === 'verified' || (status as Record<string, unknown> | null)?.canCreateSite === true;
    if (!verified) return row;
    await env.DB.prepare(`UPDATE platform_accounts SET state = 'verified', updated_at = ? WHERE user_id = ?`).bind(now(), userId).run();
    return { ...row, state: 'verified' };
  } catch (error) {
    if (!isExpired(error)) throw error;
    await env.DB.prepare(`UPDATE platform_accounts SET state = 'expired', updated_at = ? WHERE user_id = ?`).bind(now(), userId).run();
    return { ...row, state: 'expired' };
  }
}

/* ——————————————————————— the state machine ——————————————————————— */

interface ProjectForSite {
  id: string;
  name: string;
  kind: ProjectKind;
  brief: string;
}

/** The draft the platform builds from: the interview, in its vocabulary. */
export function draftFromBrief(project: ProjectForSite) {
  const brief = parseBrief(project.brief);
  return {
    siteName: project.name,
    siteType: 'business',
    audience: `People looking for: ${brief.what}`.slice(0, 500),
    tone: 'Plain, warm and professional. Short sentences, no jargon.',
    goals: [brief.goal, brief.manual && `Today done by hand: ${brief.manual}`].filter(Boolean).join('\n').slice(0, 1000),
    differentiator: brief.what.slice(0, 500),
  };
}

async function save(env: Env, projectId: string, patch: Partial<SiteRow>): Promise<void> {
  const keys = Object.keys(patch) as (keyof SiteRow)[];
  if (!keys.length) return;
  await env.DB.prepare(`UPDATE project_sites SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE project_id = ?`)
    .bind(...keys.map((k) => patch[k] ?? null), now(), projectId)
    .run();
}

export async function getSite(env: Env, projectId: string): Promise<SiteRow | null> {
  return env.DB.prepare('SELECT * FROM project_sites WHERE project_id = ?').bind(projectId).first<SiteRow>();
}

/**
 * Start provisioning a project for this user. Idempotent: a project that
 * already has a site is returned as it is; a failed one starts over.
 */
export async function startSite(
  env: Env,
  user: { id: string; email: string },
  projectId: string,
): Promise<SiteRow> {
  const existing = await getSite(env, projectId);
  if (existing && existing.state !== 'failed') return advanceSite(env, projectId);
  const t = now();
  await env.DB.prepare(
    `INSERT INTO project_sites (project_id, user_id, state, created_at, updated_at) VALUES (?, ?, 'signin', ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET state = 'signin', site_id = NULL, operation_id = NULL, error = NULL,
       failure_alerted_at = NULL, user_id = excluded.user_id, updated_at = excluded.updated_at`,
  )
    .bind(projectId, user.id, t, t)
    .run();
  const acct = await env.DB.prepare('SELECT state FROM platform_accounts WHERE user_id = ?').bind(user.id).first<{ state: string }>();
  if (!acct || acct.state === 'expired') await startSignIn(env, user.id, user.email);
  return advanceSite(env, projectId);
}

/** Send a fresh sign-in link, e.g. when the first one expired or got lost. */
export async function resendSignIn(env: Env, user: { id: string; email: string }): Promise<void> {
  await startSignIn(env, user.id, user.email);
}

/**
 * Move one site one step forward, as far as the platform allows right now.
 * Never throws for a platform failure: the site records it instead.
 */
export async function advanceSite(env: Env, projectId: string): Promise<SiteRow> {
  let site = await getSite(env, projectId);
  if (!site) throw new Error('no site');
  try {
    for (let step = 0; step < 4 && site.state !== 'ready' && site.state !== 'failed'; step += 1) {
      const before = `${site.state}:${site.operation_id}:${site.site_id}`;
      await stepSite(env, site);
      site = (await getSite(env, projectId))!;
      if (`${site.state}:${site.operation_id}:${site.site_id}` === before) break; // waiting on the platform
    }
  } catch (error) {
    const message = (error as Error)?.message ?? 'unknown error';
    if (isExpired(error)) {
      // The sign-in lapsed mid-way: ask again, keep the progress.
      await env.DB.prepare(`UPDATE platform_accounts SET state = 'expired', updated_at = ? WHERE user_id = ?`).bind(now(), site.user_id).run();
      await save(env, projectId, { state: site.site_id ? site.state : 'signin', error: 'The sign-in expired. Send a new link.' });
    } else if (error instanceof PlatformError) {
      // A platform refusal is a real answer: stop and say so.
      await save(env, projectId, { state: 'failed', error: message.slice(0, 500) });
    } else {
      // A network blip or our own bug: keep the state, record why, try next time.
      await save(env, projectId, { error: message.slice(0, 500) });
    }
    site = (await getSite(env, projectId))!;
  }
  return site;
}

async function stepSite(env: Env, site: SiteRow): Promise<void> {
  const acct = await account(env, site.user_id);
  if (!acct || acct.state !== 'verified') {
    if (site.state !== 'signin' && !site.site_id) await save(env, site.project_id, { state: 'signin' });
    return; // nothing to do until the client opens the link
  }
  const auth = acct.auth_request_id;
  const { sitesDomain } = await getSettings(env);

  switch (site.state) {
    case 'signin': {
      if (site.site_id) {
        await save(env, site.project_id, { state: 'provisioning', error: null });
        return;
      }
      const project = await env.DB.prepare('SELECT id, name, kind, brief FROM projects WHERE id = ?')
        .bind(site.project_id)
        .first<ProjectForSite>();
      if (!project) throw new PlatformError('The project no longer exists.');
      const res = await platformFetch(env, '/api/gpt/bootstrap/create-site', {
        method: 'POST',
        body: { authRequestId: auth, ...draftFromBrief(project) },
      });
      await save(env, site.project_id, {
        state: 'creating',
        site_id: pick(res, 'siteId', 'site_id', 'site.id', 'id'),
        operation_id: pick(res, 'operationId', 'operation_id', 'operation.id'),
        last_payload: trimPayload(res),
        error: null,
      });
      return;
    }
    case 'creating': {
      let siteId = site.site_id;
      if (site.operation_id) {
        const op = await platformFetch(env, '/api/gpt/bootstrap/operation-status', {
          query: { authRequestId: auth, operationId: site.operation_id },
        });
        const outcome = operationOutcome(op);
        await save(env, site.project_id, { last_payload: trimPayload(op) });
        if (outcome.failed) throw new PlatformError(`Creating the draft failed: ${outcome.failed}`);
        if (!outcome.done) return;
        siteId = siteId ?? pick(op, 'siteId', 'site_id', 'result.siteId', 'result.site.id', 'site.id');
      }
      if (!siteId) throw new PlatformError('The platform created a draft but named no site id.');
      const res = await platformFetch(env, '/api/gpt/bootstrap/provision-site', {
        method: 'POST',
        body: { authRequestId: auth, siteId },
      });
      await save(env, site.project_id, {
        state: 'provisioning',
        site_id: siteId,
        operation_id: pick(res, 'operationId', 'operation_id', 'operation.id'),
        last_payload: trimPayload(res),
      });
      return;
    }
    case 'provisioning': {
      if (site.operation_id) {
        const op = await platformFetch(env, '/api/gpt/bootstrap/operation-status', {
          query: { authRequestId: auth, operationId: site.operation_id },
        });
        const outcome = operationOutcome(op);
        await save(env, site.project_id, { last_payload: trimPayload(op) });
        if (outcome.failed) throw new PlatformError(`Provisioning failed: ${outcome.failed}`);
        if (!outcome.done) return;
      }
      const state = await platformFetch(env, '/api/gpt/bootstrap/site-state', {
        query: { authRequestId: auth, siteId: site.site_id ?? '' },
      });
      const urls = siteUrls(state, sitesDomain);
      if (!urls.preview) {
        // Provisioned, but no address yet: keep waiting, show what came back.
        await save(env, site.project_id, { operation_id: null, last_payload: trimPayload(state) });
        return;
      }
      await save(env, site.project_id, {
        state: 'ready',
        operation_id: null,
        platform_slug: urls.slug,
        preview_url: urls.preview,
        editor_url: urls.editor,
        production_url: urls.production,
        repo_url: urls.repo,
        custom_domain: urls.domain,
        last_payload: trimPayload(state),
        error: null,
      });
      // The repo the platform made is the project's code from now on: nodes
      // clone it, and the setup's code check reads it.
      if (urls.repo) {
        await env.DB.prepare(`UPDATE projects SET repo = ?, repo_kind = 'repo' WHERE id = ? AND (repo IS NULL OR repo = '')`)
          .bind(urls.repo, site.project_id)
          .run();
      }
      return;
    }
  }
}

/** Every site still on its way, one step each. The cron's half of the machine. */
export async function advanceSites(env: Env): Promise<SiteRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT project_id FROM project_sites WHERE state IN ('signin', 'creating', 'provisioning') AND updated_at < ? LIMIT 20`,
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
    `SELECT s.project_id, s.error, p.name, p.slug FROM project_sites s JOIN projects p ON p.id = s.project_id
      WHERE s.state = 'failed' AND s.failure_alerted_at IS NULL`,
  ).all<{ project_id: string; error: string | null; name: string; slug: string }>();
  if (results?.length) {
    await env.DB.batch(
      results.map((r) => env.DB.prepare('UPDATE project_sites SET failure_alerted_at = ? WHERE project_id = ?').bind(now(), r.project_id)),
    );
  }
  return results ?? [];
}

/* ——————————————————————— preview and publish ——————————————————————— */

export interface PreviewFile {
  path: string;
  content: string;
}

const SAFE_PATH = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[\w.@+\-/ ]{1,300}$/;

/** Bound a run's files to what edit-preview will take, or say why not. */
export function cleanPreviewFiles(value: unknown): { files: PreviewFile[] } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) return { error: 'no files' };
  if (value.length > PREVIEW_LIMITS.files) return { error: `${value.length} files; the preview takes at most ${PREVIEW_LIMITS.files}` };
  const files: PreviewFile[] = [];
  let total = 0;
  for (const raw of value as Record<string, unknown>[]) {
    const path = typeof raw?.path === 'string' ? raw.path : '';
    const content = typeof raw?.content === 'string' ? raw.content : null;
    if (!SAFE_PATH.test(path) || content === null) return { error: `bad file entry ${JSON.stringify(path).slice(0, 80)}` };
    if (path.startsWith('.git/') || path === '.git') return { error: 'refusing a .git path' };
    const bytes = new TextEncoder().encode(content).length;
    if (bytes > PREVIEW_LIMITS.fileBytes) return { error: `${path} is larger than 512 KB` };
    total += bytes;
    files.push({ path, content });
  }
  if (total > PREVIEW_LIMITS.totalBytes) return { error: 'the files add up to more than 2 MB' };
  return { files };
}

async function siteAuth(env: Env, site: SiteRow): Promise<string> {
  if (site.state !== 'ready' || !site.site_id) throw new PlatformError('The site is not set up yet.');
  const acct = await account(env, site.user_id);
  if (!acct || acct.state !== 'verified') throw new PlatformError('AUTH_REQUEST_EXPIRED: the site owner must sign in again.');
  return acct.auth_request_id;
}

/** Write a run's files to the site's preview branch. Production is untouched. */
export async function pushToPreview(env: Env, projectId: string, files: PreviewFile[], message: string) {
  const site = await getSite(env, projectId);
  if (!site) throw new PlatformError('This project has no hosted site.');
  const auth = await siteAuth(env, site);
  const res = await platformFetch(env, '/api/gpt/bootstrap/edit-preview', {
    method: 'POST',
    body: { authRequestId: auth, siteId: site.site_id, files, commitMessage: message.slice(0, 200) },
  });
  await save(env, projectId, { preview_updated_at: now(), last_payload: trimPayload(res) });
  return { previewUrl: site.preview_url, result: res };
}

/** Promote the preview to production. The caller decides who may. */
export async function publishPreview(env: Env, projectId: string, message: string) {
  const site = await getSite(env, projectId);
  if (!site) throw new PlatformError('This project has no hosted site.');
  const auth = await siteAuth(env, site);
  const res = await platformFetch(env, '/api/gpt/bootstrap/approve-preview', {
    method: 'POST',
    body: { authRequestId: auth, siteId: site.site_id, commitMessage: message.slice(0, 200) },
  });
  await save(env, projectId, { last_payload: trimPayload(res) });
  return { productionUrl: site.production_url, result: res };
}
