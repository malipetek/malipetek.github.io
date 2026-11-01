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
import { corsHeaders, isStudioRepo, type Env, type HonoEnv } from './shared.ts';
import type { Context } from 'hono';
import { APP_SLUG, GH_API, appJwt, ensureRepo, ghHeaders, installationToken, projectInstallation, useClientRepo } from './ghapp.ts';

/** Browser-facing replies need CORS headers, like portal.ts reply(). */
const reply = (c: Context<HonoEnv>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(c.req.header('Origin') ?? null) },
  });

export const github = new Hono<HonoEnv>();

const b64url = (data: string | ArrayBuffer | Uint8Array) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};


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
async function stateMac(env: Env, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET ?? ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

async function signState(env: Env, userId: string): Promise<string> {
  const payload = `${userId}.${now() + 3600}`;
  return `${b64url(payload)}.${await stateMac(env, payload)}`;
}

async function userFromState(env: Env, state: string): Promise<string | null> {
  const [payload, mac] = state.split('.');
  if (!payload || !mac) return null;
  const decoded = String.fromCharCode(...Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)));
  const [userId, exp] = decoded.split('.');
  if (!userId || !Number.isFinite(Number(exp)) || Number(exp) < now()) return null;
  const expected = await stateMac(env, decoded);
  if (expected.length !== mac.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
  return diff === 0 ? userId : null;
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
  await linkProjects(c.env, user.id);
  return c.redirect(`${siteUrl}/portal/?github=connected`);
});

/**
 * Point a client's projects at their GitHub connection when the project's repo
 * lives under the GitHub account they connected — the usual case: they named
 * their own private repo at onboarding, nodes could not clone it, and then
 * they connected GitHub. Never re-points a project already linked. A
 * connection limited to other repos fails at clone time and says so.
 */
export async function linkProjects(env: Env, userId: string) {
  await env.DB.prepare(
    `UPDATE projects SET
        github_installation_id = (
          SELECT i.id FROM github_installations i
           WHERE i.user_id = ?1 AND i.account_login <> ''
             AND lower(projects.repo) LIKE 'https://github.com/' || lower(i.account_login) || '/%'
           LIMIT 1),
        repo_error = NULL
      WHERE github_installation_id IS NULL AND repo IS NOT NULL
        AND id IN (SELECT project_id FROM user_projects WHERE user_id = ?1)
        AND EXISTS (SELECT 1 FROM github_installations i
                     WHERE i.user_id = ?1 AND i.account_login <> ''
                       AND lower(projects.repo) LIKE 'https://github.com/' || lower(i.account_login) || '/%')`,
  )
    .bind(userId)
    .run();

  // A client who names a repo the app cannot see usually has not made it yet.
  // Now that they have connected, make it in their account.
  // Only with the app configured: without it nothing can be looked up or made,
  // and writing an error would replace a working repo status with a failure.
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return;
  const { results } = await env.DB.prepare(
    `SELECT id FROM projects
      WHERE repo IS NOT NULL AND github_installation_id IS NOT NULL AND repo_error IS NULL
        AND id IN (SELECT project_id FROM user_projects WHERE user_id = ?)`,
  )
    .bind(userId)
    .all<{ id: string }>();
  for (const project of results ?? []) {
    try {
      await ensureRepo(env, project.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // "Not configured" is not a project fault; leave the status alone.
      if (message.includes('unconfigured')) continue;
      await env.DB.prepare('UPDATE projects SET repo_error = ? WHERE id = ?')
        .bind(`github: ${message}`.slice(0, 300), project.id)
        .run();
    }
  }
}

/* ——————————————————————— portal: connection state + attach ——————————————————————— */

/** The client's GitHub connection: nothing, or the installation(s) they hold. */
github.get('/portal/github', async (c) => {
  const user = await bearerUser(c.env, c);
  if (!user) return reply(c, { error: 'unauthorized' }, 401);
  // The webhook can register the installation after the callback ran: link here too.
  await linkProjects(c.env, user.id);
  const { results } = await c.env.DB.prepare(
    'SELECT id, account_login, repository_selection FROM github_installations WHERE user_id = ? ORDER BY account_login',
  )
    .bind(user.id)
    .all<{ id: number; account_login: string; repository_selection: string }>();
  return reply(c, {
    installations: results ?? [],
    // A client who named a repo they own: until the app is installed on that
    // account, nodes see a 404 and no work starts. Say it where the button is.
    // Repos in the studio's own account are read with the nodes' credential.
    unconnected: (
      await c.env.DB.prepare(
        `SELECT p.slug, p.name, p.repo FROM projects p JOIN user_projects up ON up.project_id = p.id
          WHERE up.user_id = ? AND p.repo IS NOT NULL AND p.repo <> '' AND p.github_installation_id IS NULL
          ORDER BY p.name`,
      )
        .bind(user.id)
        .all<{ slug: string; name: string; repo: string }>()
    ).results?.filter((p) => !isStudioRepo(c.env, p.repo)) ?? [],
    installUrl: `https://github.com/apps/${APP_SLUG}/installations/new?state=${encodeURIComponent(await signState(c.env, user.id))}`,
  });
});

/**
 * Disconnect an installation from the client's account. Repos on projects are
 * cleared back to needing a repo choice; GitHub uninstall (which reaches the
 * webhook and removes the row) stays on github.com.
 */
github.delete('/portal/github/:id', async (c) => {
  const user = await bearerUser(c.env, c);
  if (!user) return reply(c, { error: 'unauthorized' }, 401);
  const id = Number(c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE projects SET github_installation_id = NULL WHERE github_installation_id = ?').bind(id),
    c.env.DB.prepare('UPDATE github_installations SET user_id = NULL, updated_at = ? WHERE id = ? AND user_id = ?').bind(now(), id, user.id),
  ]);
  return reply(c, { ok: true });
});

/**
 * Point a project's repo at one of the client's installations. The repo URL
 * must be a GitHub URL; nodes mint their own per-task tokens to reach it.
 */
github.post('/portal/projects/:id/github', async (c) => {
  const user = await bearerUser(c.env, c);
  if (!user) return reply(c, { error: 'unauthorized' }, 401);
  const project = await c.env.DB.prepare(
    `SELECT p.id FROM projects p JOIN user_projects up ON up.project_id = p.id WHERE p.id = ? AND up.user_id = ?`,
  )
    .bind(c.req.param('id'), user.id)
    .first<{ id: string }>();
  if (!project) return reply(c, { error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => null)) as { repo?: unknown; installationId?: unknown } | null;
  const repo = typeof body?.repo === 'string' ? body.repo.trim() : '';
  const installationId = Number(body?.installationId);
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/i.test(repo) || /@/.test(repo.split('github.com/')[1].split('/')[0])) {
    return reply(c, { error: 'bad_repo' }, 400);
  }
  const installation = await c.env.DB.prepare('SELECT id FROM github_installations WHERE id = ? AND user_id = ?')
    .bind(installationId, user.id)
    .first<{ id: number }>();
  if (!installation) return reply(c, { error: 'bad_installation' }, 400);
  await c.env.DB.prepare(`UPDATE projects SET repo = ?, repo_kind = 'repo', github_installation_id = ? WHERE id = ?`)
    .bind(repo.replace(/\.git\/?$/, ''), installationId, project.id)
    .run();
  return reply(c, { ok: true });
});

/* ——————————————————————— portal: a project's repo, chosen by the client ——————————————————————— */

/** The project, when the caller is linked to it. */
async function ownProject(env: Env, projectId: string, userId: string) {
  return env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.repo, p.repo_kind, p.repo_wanted, p.repo_error, p.github_installation_id
       FROM projects p JOIN user_projects up ON up.project_id = p.id
      WHERE p.id = ? AND up.user_id = ?`,
  )
    .bind(projectId, userId)
    .first<{
      id: string;
      slug: string;
      name: string;
      repo: string | null;
      repo_kind: string;
      repo_wanted: number;
      repo_error: string | null;
      github_installation_id: number | null;
    }>();
}

/** Where this project's code lives, as the site page asks it. */
github.get('/portal/projects/:id/repo', async (c) => {
  const user = await bearerUser(c.env, c);
  if (!user) return reply(c, { error: 'unauthorized' }, 401);
  const project = await ownProject(c.env, c.req.param('id'), user.id);
  if (!project) return reply(c, { error: 'not_found' }, 404);
  const installation = project.github_installation_id
    ? await c.env.DB.prepare('SELECT id, account_login FROM github_installations WHERE id = ?')
        .bind(project.github_installation_id)
        .first<{ id: number; account_login: string }>()
    : null;
  const { results } = await c.env.DB.prepare(
    'SELECT id, account_login FROM github_installations WHERE user_id = ? ORDER BY account_login',
  )
    .bind(user.id)
    .all<{ id: number; account_login: string }>();
  return reply(c, {
    repo: project.repo,
    repoKind: project.repo_kind,
    repoWanted: Boolean(project.repo_wanted),
    error: project.repo_error,
    installation,
    installations: results ?? [],
  });
});

/**
 * Choose where the code lives:
 *   { create: 'github', installationId? }  a private repo in their account (created if missing)
 *   { create: 'ours' }                      a node creates one in our org
 *   { repo: 'https://github.com/...' }      one they already have
 *
 * This is the button that did not exist: before it, a connected client could
 * not ask us to use their account, and onboarding never offered the choice.
 */
github.post('/portal/projects/:id/repo', async (c) => {
  const user = await bearerUser(c.env, c);
  if (!user) return reply(c, { error: 'unauthorized' }, 401);
  const project = await ownProject(c.env, c.req.param('id'), user.id);
  if (!project) return reply(c, { error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => null)) as { repo?: unknown; create?: unknown; installationId?: unknown } | null;

  if (body?.create === 'ours') {
    await c.env.DB.prepare(
      `UPDATE projects SET repo = NULL, repo_kind = 'none', repo_wanted = 1, repo_error = NULL,
         github_installation_id = NULL WHERE id = ?`,
    )
      .bind(project.id)
      .run();
    return reply(c, { ok: true, repo: null, wanted: true });
  }

  if (body?.create === 'github') {
    const wanted = Number(body.installationId);
    const installation = Number.isInteger(wanted) && wanted > 0
      ? await c.env.DB.prepare('SELECT id, account_login FROM github_installations WHERE id = ? AND user_id = ?')
          .bind(wanted, user.id)
          .first<{ id: number; account_login: string }>()
      : await c.env.DB.prepare('SELECT id, account_login FROM github_installations WHERE user_id = ? ORDER BY account_login LIMIT 1')
          .bind(user.id)
          .first<{ id: number; account_login: string }>();
    if (!installation) return reply(c, { error: 'no_github' }, 400);
    try {
      const out = await useClientRepo(c.env, project, installation);
      return reply(c, { ok: true, repo: out.repo, outcome: out.outcome, installation: { id: installation.id, account_login: installation.account_login } });
    } catch (error) {
      const message = (error as Error)?.message ?? 'Could not create the repo.';
      await c.env.DB.prepare('UPDATE projects SET repo_error = ? WHERE id = ?')
        .bind(`github: ${message}`.slice(0, 300), project.id)
        .run();
      return reply(c, { error: 'github', message }, 502);
    }
  }

  const repo = typeof body?.repo === 'string' ? body.repo.trim().replace(/\.git\/?$/, '') : '';
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/i.test(repo)) return reply(c, { error: 'bad_repo' }, 400);
  const owner = repo.split('github.com/')[1]?.split('/')[0] ?? '';
  const installation = await c.env.DB.prepare(
    'SELECT id, account_login FROM github_installations WHERE user_id = ? AND lower(account_login) = lower(?)',
  )
    .bind(user.id, owner)
    .first<{ id: number; account_login: string }>();
  await c.env.DB.prepare(
    `UPDATE projects SET repo = ?, repo_kind = 'repo', repo_wanted = 0, repo_error = NULL,
       github_installation_id = ? WHERE id = ?`,
  )
    .bind(repo, installation?.id ?? null, project.id)
    .run();
  if (installation) {
    try {
      await ensureRepo(c.env, project.id);
    } catch (error) {
      const message = (error as Error)?.message ?? 'Could not reach the repo.';
      await c.env.DB.prepare('UPDATE projects SET repo_error = ? WHERE id = ?')
        .bind(`github: ${message}`.slice(0, 300), project.id)
        .run();
    }
  }
  return reply(c, { ok: true, repo, installation: installation ?? null });
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
