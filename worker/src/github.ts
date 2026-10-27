/*
 * The GitHub App half of "where your code lives".
 *
 *   POST /hooks/github            GitHub webhook: installation created/deleted.
 *   GET  /auth/github/callback    OAuth-during-install return: link the
 *                                 installation to the signed-in client.
 *   GET  /portal/github           the client's connection: installed? where?
 *   POST /portal/projects/:id/github  point a project's repo at an installation.
 *   POST /node/git-token          a node's short-lived token for one project.
 *
 * One app (malipetek-dev), granular permissions: contents + pull requests.
 * Tokens are minted per call, scoped to the installation's repos, and live an
 * hour — a node cloning a client's repo holds nothing of theirs overnight.
 */
import { Hono } from 'hono';
import { now, sessionUser } from './portal.ts';
import type { Env, HonoEnv } from './shared.ts';

export const github = new Hono<HonoEnv>();

const GH_API = 'https://api.github.com';
const APP_SLUG = 'malipetek-dev';
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
async function appJwt(env: Env): Promise<string> {
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

const ghHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'malipetek-dev/1.0',
});

/** A one-hour installation token for the project's repo, never stored. */
export async function installationToken(env: Env, installationId: number, repositories?: string[]) {
  const res = await fetch(`${GH_API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: ghHeaders(await appJwt(env)),
    body: JSON.stringify({
      permissions: { contents: 'write', pull_requests: 'write' },
      ...(repositories?.length ? { repositories } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => null)) as { token?: string; expires_at?: string; message?: string } | null;
  if (!res.ok || !data?.token) throw new Error(data?.message ?? `github token refused (${res.status})`);
  return { token: data.token, expiresAt: Math.floor(Date.parse(data.expires_at ?? '') / 1000) || now() + 3600 };
}

interface InstallationRow {
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

/* ——————————————————————— the webhook ——————————————————————— */

async function verifySignature(secret: string, body: string, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = `sha256=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

github.post('/hooks/github', async (c) => {
  const secret = c.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: 'unconfigured' }, 503);
  const body = await c.req.text();
  const signature = c.req.header('x-hub-signature-256') ?? '';
  if (!(await verifySignature(secret, body, signature))) return c.json({ error: 'bad_signature' }, 401);
  const event = c.req.header('x-github-event') ?? '';
  const payload = JSON.parse(body) as {
    action?: string;
    installation?: { id?: number; account?: { login?: string; type?: string }; repository_selection?: string };
  };
  const inst = payload.installation;
  if (event === 'installation' && inst?.id) {
    if (payload.action === 'deleted') {
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE projects SET github_installation_id = NULL WHERE github_installation_id = ?').bind(inst.id),
        c.env.DB.prepare('DELETE FROM github_installations WHERE id = ?').bind(inst.id),
      ]);
    } else {
      const t = now();
      await c.env.DB.prepare(
        `INSERT INTO github_installations (id, account_login, account_type, repository_selection, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET account_login = excluded.account_login,
           account_type = excluded.account_type, repository_selection = excluded.repository_selection,
           updated_at = excluded.updated_at`,
      )
        .bind(inst.id, inst.account?.login ?? '', inst.account?.type ?? 'User', inst.repository_selection ?? 'all', t, t)
        .run();
    }
  }
  // installation_repositories events: the token mint is scoped at call time,
  // so per-repo changes need nothing stored.
  return c.json({ ok: true });
});

/* ——————————————————————— the install state ——————————————————————— */

/**
 * The portal session lives in a bearer token, not a cookie, so the install
 * link carries a signed state instead: who asked, and when it expires.
 * GitHub returns it on the callback, which is how the installation binds to
 * the right account without any cookie.
 */
async function signState(env: Env, userId: string): Promise<string> {
  const payload = `${userId}.${now() + 3600}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET ?? ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${b64url(payload)}.${b64url(mac)}`;
}

async function userFromState(env: Env, state: string): Promise<string | null> {
  const [payload, mac] = state.split('.');
  const decoded = String.fromCharCode(...Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)));
  const expected = await signState(env, decoded.split('.').slice(0, -1).join('.'));
  const [userId, exp] = decoded.split('.');
  if (!userId || Number(exp) < now() || `${payload}.${mac}` !== expected) return null;
  return userId;
}

/** The bearer session, for the portal routes in this module. */
async function bearerUser(env: Env, c: { req: { header: (n: string) => string | undefined } }) {
  const token = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return token ? sessionUser(env, token) : null;
}

/* ——————————————————————— the OAuth-during-install callback ——————————————————————— */

/**
 * GitHub sends the installer here with ?code=&installation_id=&state=. The
 * signed state says whose account this belongs to; the code exchange just
 * proves the GitHub person behind it.
 */
github.get('/auth/github/callback', async (c) => {
  const siteUrl = c.env.SITE_URL ?? 'https://malipetek.dev';
  const userId = await userFromState(c.env, c.req.query('state') ?? '');
  const user = userId ? await c.env.DB.prepare(`SELECT id, role FROM users WHERE id = ? AND role = 'client'`).bind(userId).first<{ id: string; role: string }>() : null;
  if (!user) return c.redirect(`${siteUrl}/portal/?github=signin`);
  const code = c.req.query('code') ?? '';
  const installationId = Number(c.req.query('installation_id'));
  if (!code || !Number.isInteger(installationId) || installationId <= 0) return c.redirect(`${siteUrl}/portal/?github=bad`);

  const exchange = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: c.env.GITHUB_APP_CLIENT_ID, client_secret: c.env.GITHUB_APP_CLIENT_SECRET, code }),
    signal: AbortSignal.timeout(10_000),
  });
  const exchanged = (await exchange.json().catch(() => null)) as { access_token?: string } | null;
  if (!exchanged?.access_token) return c.redirect(`${siteUrl}/portal/?github=failed`);
  const me = await fetch(`${GH_API}/user`, { headers: ghHeaders(exchanged.access_token), signal: AbortSignal.timeout(10_000) });
  const ghUser = (await me.json().catch(() => null)) as { login?: string } | null;

  const t = now();
  // The webhook usually lands first; upsert so a callback-first arrival works too.
  let account: { account?: { login?: string; type?: string } } | null = null;
  try {
    const res = await fetch(`${GH_API}/app/installations/${installationId}`, {
      headers: ghHeaders(await appJwt(c.env)),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) account = (await res.json()) as { account?: { login?: string; type?: string } };
  } catch {
    /* account name is cosmetic */
  }
  await c.env.DB.prepare(
    `INSERT INTO github_installations (id, user_id, github_login, account_login, account_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id,
       github_login = excluded.github_login, updated_at = excluded.updated_at`,
  )
    .bind(installationId, user.id, ghUser?.login ?? null, account?.account?.login ?? ghUser?.login ?? '', account?.account?.type ?? 'User', t, t)
    .run();
  return c.redirect(`${siteUrl}/portal/?github=connected`);
});

/* ——————————————————————— portal: connection state + attach ——————————————————————— */

/** The client's GitHub connection: nothing, or the installation(s) they hold. */
github.get('/portal/github', async (c) => {
  const user = await bearerUser(c.env, c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const { results } = await c.env.DB.prepare(
    'SELECT id, account_login, repository_selection FROM github_installations WHERE user_id = ? ORDER BY account_login',
  )
    .bind(user.id)
    .all<{ id: number; account_login: string; repository_selection: string }>();
  return c.json({
    installations: results ?? [],
    installUrl: `https://github.com/apps/${APP_SLUG}/installations/new?state=${encodeURIComponent(await signState(c.env, user.id))}`,
  });
});

/**
 * Point a project's repo at one of the client's installations. The repo URL
 * must be a GitHub URL; nodes mint their own per-task tokens to reach it.
 */
github.post('/portal/projects/:id/github', async (c) => {
  const user = await bearerUser(c.env, c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const project = await c.env.DB.prepare(
    `SELECT p.id FROM projects p JOIN user_projects up ON up.project_id = p.id WHERE p.id = ? AND up.user_id = ?`,
  )
    .bind(c.req.param('id'), user.id)
    .first<{ id: string }>();
  if (!project) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => null)) as { repo?: unknown; installationId?: unknown } | null;
  const repo = typeof body?.repo === 'string' ? body.repo.trim() : '';
  const installationId = Number(body?.installationId);
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/i.test(repo) || /@/.test(repo.split('github.com/')[1].split('/')[0])) {
    return c.json({ error: 'bad_repo' }, 400);
  }
  const installation = await c.env.DB.prepare('SELECT id FROM github_installations WHERE id = ? AND user_id = ?')
    .bind(installationId, user.id)
    .first<{ id: number }>();
  if (!installation) return c.json({ error: 'bad_installation' }, 400);
  await c.env.DB.prepare(`UPDATE projects SET repo = ?, repo_kind = 'repo', github_installation_id = ? WHERE id = ?`)
    .bind(repo.replace(/\.git\/?$/, ''), installationId, project.id)
    .run();
  return c.json({ ok: true });
});

/* ——————————————————————— node: a token per task ——————————————————————— */

/** A node's clone/push token for a GitHub-connected project. One hour, contents+PR scope. */
github.post('/node/git-token', async (c) => {
  const auth = c.req.header('authorization') ?? '';
  if (!c.env.RUNNER_TOKEN || auth !== `Bearer ${c.env.RUNNER_TOKEN}`) return c.json({ error: 'unauthorized' }, 401);
  const body = (await c.req.json().catch(() => null)) as { slug?: unknown } | null;
  const slug = typeof body?.slug === 'string' ? body.slug : '';
  const project = await c.env.DB.prepare('SELECT id, repo, github_installation_id FROM projects WHERE slug = ?')
    .bind(slug)
    .first<{ id: string; repo: string | null; github_installation_id: number | null }>();
  if (!project?.github_installation_id || !project.repo) return c.json({ error: 'not_github' }, 404);
  const repoName = project.repo.split('github.com/').pop()?.replace(/\.git$/, '').split('/') ?? [];
  try {
    const out = await installationToken(c.env, project.github_installation_id, repoName.length === 2 ? [repoName[1]] : undefined);
    return c.json({ ok: true, token: out.token, expiresAt: out.expiresAt, repo: project.repo });
  } catch (error) {
    return c.json({ error: 'github', message: (error as Error).message }, 502);
  }
});
