/*
 * The GitHub App's plumbing: an app JWT, short-lived installation tokens, and
 * the two questions other modules ask — "which installation reaches this
 * project?" and "does its repo exist, or should it be created?".
 *
 * Kept apart from `github.ts` (the HTTP routes) so `portal.ts` can create a
 * client's repo without importing the module that imports the portal.
 */
import { now, type Env } from './shared.ts';

export const GH_API = 'https://api.github.com';
export const APP_SLUG = 'malipetek-dev';
const TOKEN_MARGIN_SECONDS = 120; // treat a token as dead this early

/* ——————————————————————— app JWT ——————————————————————— */

let cachedJwt: { token: string; expiresAt: number } | null = null;

const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const pemToDer = (pem: string) =>
  Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----|\s/g, '')), (ch) => ch.charCodeAt(0));

/** A 10-minute RS256 JWT for the app itself; cached until nearly dead. */
export async function appJwt(env: Env): Promise<string> {
  const t = now();
  if (cachedJwt && cachedJwt.expiresAt > t + TOKEN_MARGIN_SECONDS) return cachedJwt.token;
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) throw new Error('github_app_unconfigured');
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(env.GITHUB_APP_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: env.GITHUB_APP_ID, iat: t - 60, exp: t + 540 }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  cachedJwt = { token: `${header}.${payload}.${b64url(sig)}`, expiresAt: t + 540 };
  return cachedJwt.token;
}

export const ghHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'malipetek-dev/1.0',
});

/** A one-hour installation token for the project's repo, never stored. */
export async function installationToken(
  env: Env,
  installationId: number,
  repositories?: string[],
  extra?: Record<string, string>,
) {
  const res = await fetch(`${GH_API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: ghHeaders(await appJwt(env)),
    body: JSON.stringify({
      permissions: { contents: 'write', pull_requests: 'write', ...extra },
      ...(repositories?.length ? { repositories } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => null)) as { token?: string; expires_at?: string; message?: string } | null;
  if (!res.ok || !data?.token) throw new Error(data?.message ?? `github token refused (${res.status})`);
  return { token: data.token, expiresAt: Math.floor(Date.parse(data.expires_at ?? '') / 1000) || now() + 3600 };
}

export interface InstallationRow {
  id: number;
  user_id: string | null;
  github_login: string | null;
  account_login: string;
  account_type: string;
  repository_selection: string;
}

/** The installation a project is reached through, when it is GitHub-connected. */
export async function projectInstallation(env: Env, projectId: string) {
  return env.DB.prepare(
    `SELECT i.* FROM github_installations i JOIN projects p ON p.github_installation_id = i.id
      WHERE p.id = ?`,
  )
    .bind(projectId)
    .first<InstallationRow>();
}

/** `owner/name` out of a GitHub repo URL, or null for anything else. */
export function repoParts(url: string | null) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url ?? '');
  return match ? { owner: match[1], name: match[2] } : null;
}

/**
 * A client names a repo they own, then connects GitHub — and the repo may still
 * not exist (a fresh account, a rename, a typo in the URL). With the
 * installation token we can create it in their account, private and with a
 * first commit, so the node has something to clone instead of retrying a 404
 * every ten minutes.
 *
 * Returns what happened, and never throws for the "not connected" case.
 */
export async function ensureRepo(env: Env, projectId: string): Promise<'exists' | 'created' | 'unconfigured'> {
  const project = await env.DB.prepare(
    'SELECT id, slug, repo, github_installation_id FROM projects WHERE id = ?',
  )
    .bind(projectId)
    .first<{ id: string; slug: string; repo: string | null; github_installation_id: number | null }>();
  const parts = repoParts(project?.repo ?? null);
  if (!project || !parts || !project.github_installation_id) return 'unconfigured';

  // The lookup only needs contents; asking for administration here would fail
  // the token for an app that was never granted it, and break ordinary runs.
  const { token } = await installationToken(env, project.github_installation_id);
  const known = await fetch(`${GH_API}/repos/${parts.owner}/${parts.name}`, {
    headers: ghHeaders(token),
    signal: AbortSignal.timeout(10_000),
  });
  if (known.ok) return 'exists';
  if (known.status !== 404) throw new Error(`github lookup failed (${known.status})`);

  // Creating one needs Administration: write on the app. If it is not granted
  // this throws with GitHub's own words, which land in repo_error for Ali.
  const { token: admin } = await installationToken(env, project.github_installation_id, undefined, {
    administration: 'write',
  });

  const installation = await env.DB.prepare('SELECT account_type FROM github_installations WHERE id = ?')
    .bind(project.github_installation_id)
    .first<{ account_type: string }>();
  const where = installation?.account_type === 'Organization'
    ? `${GH_API}/orgs/${parts.owner}/repos`
    : `${GH_API}/user/repos`;
  const created = await fetch(where, {
    method: 'POST',
    headers: ghHeaders(admin),
    body: JSON.stringify({ name: parts.name, private: true, auto_init: true }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!created.ok) {
    const data = (await created.json().catch(() => null)) as { message?: string } | null;
    throw new Error(data?.message ?? `github create failed (${created.status})`);
  }
  return 'created';
}

/**
 * Point a project at a repo in one of the client's installations and create it
 * when missing. The repo is private, named after the project slug, and the
 * first commit means a node can clone it immediately.
 */
export async function useClientRepo(
  env: Env,
  project: { id: string; slug: string },
  installation: { id: number; account_login: string },
): Promise<{ repo: string; outcome: 'exists' | 'created' | 'unconfigured' }> {
  const repo = `https://github.com/${installation.account_login}/${project.slug}`;
  await env.DB.prepare(
    `UPDATE projects SET repo = ?, repo_kind = 'repo', repo_wanted = 0, repo_error = NULL,
       github_installation_id = ? WHERE id = ?`,
  )
    .bind(repo, installation.id, project.id)
    .run();
  const outcome = await ensureRepo(env, project.id);
  return { repo, outcome };
}
