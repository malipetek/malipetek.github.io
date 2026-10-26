/*
 * OAuth 2.1 for MCP clients that will not take a pasted key — ChatGPT's
 * connectors above all. Everything a client gets at the end is an ordinary
 * agent token (portal.ts), so the walls are the ones the tests already hold:
 * client routes only, never /admin, revocable from the portal.
 *
 *   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728: where to sign in
 *   GET  /.well-known/oauth-authorization-server       RFC 8414 metadata
 *   POST /oauth/register                               RFC 7591 dynamic registration
 *   GET  /oauth/client?client_id&redirect_uri          for the consent page
 *   POST /oauth/approve   (browser session)            consent → one-time code
 *   POST /oauth/token                                  code + PKCE → access token
 *
 * The consent page is /portal/authorize on the site, where the client's
 * session already lives. The issuer is the site's origin, and the site proxies
 * the /.well-known/oauth-* documents here (src/pages/.well-known). The token
 * and registration endpoints are this Worker's own origin, named in the
 * metadata: the site runs Astro's CSRF guard, which refuses form-encoded POSTs
 * from elsewhere — and an OAuth token request is exactly that.
 *
 * Rules: PKCE S256 is required; a redirect URI must match a registered one
 * exactly; codes are single-use, ten minutes, and bound to client, redirect URI,
 * user and challenge. Registering grants nothing on its own.
 */
import { Hono, type Context } from 'hono';
import { MAX_AGENT_TOKENS, mintAgentToken, randomToken, sessionUser, sha256, siteUrl } from './portal.ts';
import { ALLOWED_ORIGINS, corsHeaders, isRateLimited, clientIp, now, type Env, type HonoEnv } from './shared.ts';

type Ctx = Context<HonoEnv>;

const CODE_TTL_SECONDS = 600;
const MAX_REDIRECTS = 5;
const SCOPE = 'portal';

const issuer = (env: Env) => siteUrl(env);
const resource = (env: Env) => `${siteUrl(env)}/mcp`;

/** Public endpoints: any origin, no credentials. */
const open = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'cache-control': 'no-store',
      ...extra,
    },
  });

/** Endpoints the consent page calls with the client's session: portal origins only. */
const portalReply = (c: Ctx, data: unknown, status = 200) => {
  const origin = c.req.header('Origin') ?? null;
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(origin) },
  });
};

/** https anywhere, or http on a loopback host (desktop clients). Nothing else. */
export function cleanRedirect(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    if (url.hash) return null;
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return value;
  } catch {
    /* not a URL */
  }
  return null;
}

const toBase64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** RFC 7636 S256: BASE64URL(SHA-256(ASCII(verifier))). */
export async function pkceChallenge(verifier: string): Promise<string> {
  return toBase64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

interface ClientRow {
  client_id: string;
  client_name: string;
  redirect_uris: string;
}

async function getClient(env: Env, clientId: unknown): Promise<(ClientRow & { redirects: string[] }) | null> {
  if (typeof clientId !== 'string' || clientId.length > 100) return null;
  const row = await env.DB.prepare('SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?')
    .bind(clientId)
    .first<ClientRow>();
  if (!row) return null;
  let redirects: string[] = [];
  try {
    redirects = JSON.parse(row.redirect_uris);
  } catch {
    /* a bad row has no redirects */
  }
  return { ...row, redirects };
}

export const oauth = new Hono<HonoEnv>();

oauth.options('/.well-known/*', () => open(null, 204));
oauth.options('/oauth/register', () => open(null, 204));
oauth.options('/oauth/token', () => open(null, 204));
oauth.options('/oauth/client', (c) => new Response(null, { status: 204, headers: corsHeaders(c.req.header('Origin') ?? null) }));
oauth.options('/oauth/approve', (c) => new Response(null, { status: 204, headers: corsHeaders(c.req.header('Origin') ?? null) }));

/* —— discovery —— */

const protectedResource = (c: Ctx) =>
  open({
    resource: resource(c.env),
    authorization_servers: [issuer(c.env)],
    bearer_methods_supported: ['header'],
    scopes_supported: [SCOPE],
    resource_name: 'malipetek.dev',
    resource_documentation: `${siteUrl(c.env)}/portal`,
  });
oauth.get('/.well-known/oauth-protected-resource', protectedResource);
oauth.get('/.well-known/oauth-protected-resource/mcp', protectedResource);

const serverMetadata = (c: Ctx) => {
  const base = issuer(c.env);
  // This Worker's public origin; through the site's proxy it is still ours.
  const worker = new URL(c.req.url).origin;
  return open({
    issuer: base,
    authorization_endpoint: `${base}/portal/authorize`,
    token_endpoint: `${worker}/oauth/token`,
    registration_endpoint: `${worker}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
  });
};
oauth.get('/.well-known/oauth-authorization-server', serverMetadata);
oauth.get('/.well-known/oauth-authorization-server/mcp', serverMetadata);
oauth.get('/.well-known/openid-configuration', serverMetadata);

/* —— registration —— */

oauth.post('/oauth/register', async (c) => {
  if (await isRateLimited(c.env, clientIp(c.req.raw), 'oauth-register', 30, 24 * 60 * 60)) {
    return open({ error: 'rate_limited' }, 429);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(cleanRedirect) : [];
  if (!uris.length || uris.length > MAX_REDIRECTS || uris.some((u) => u === null)) {
    return open({ error: 'invalid_redirect_uri', error_description: 'redirect_uris: 1–5 https URLs (http only on localhost).' }, 400);
  }
  const method = body?.token_endpoint_auth_method ?? 'none';
  if (method !== 'none') {
    return open({ error: 'invalid_client_metadata', error_description: 'Only public clients (token_endpoint_auth_method "none", with PKCE).' }, 400);
  }
  const name = typeof body?.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : 'An MCP client';
  const clientId = `mcp_${randomToken().slice(0, 24)}`;
  const t = now();
  await c.env.DB.prepare('INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)')
    .bind(clientId, name, JSON.stringify(uris), t)
    .run();
  return open(
    {
      client_id: clientId,
      client_id_issued_at: t,
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      scope: SCOPE,
    },
    201,
  );
});

/* —— consent (called by /portal/authorize with the client's session) —— */

/** Who is asking, and is this redirect one they registered. Nothing secret. */
oauth.get('/oauth/client', async (c) => {
  const client = await getClient(c.env, c.req.query('client_id'));
  if (!client) return portalReply(c, { error: 'unknown_client' }, 400);
  const redirect = c.req.query('redirect_uri') ?? '';
  if (!client.redirects.includes(redirect)) return portalReply(c, { error: 'bad_redirect' }, 400);
  return portalReply(c, { name: client.client_name, redirectHost: new URL(redirect).host });
});

oauth.post('/oauth/approve', async (c) => {
  const env = c.env;
  const origin = c.req.header('Origin');
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return portalReply(c, { error: 'origin_not_allowed' }, 403);
  // A browser session only: an agent token must never grant another agent access.
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = token && !token.startsWith('cat_') ? await sessionUser(env, token) : null;
  if (!user) return portalReply(c, { error: 'unauthorized' }, 401);
  if (user.role !== 'client') return portalReply(c, { error: 'clients_only' }, 400);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const client = await getClient(env, body?.client_id);
  if (!client) return portalReply(c, { error: 'unknown_client' }, 400);
  const redirect = typeof body?.redirect_uri === 'string' ? body.redirect_uri : '';
  if (!client.redirects.includes(redirect)) return portalReply(c, { error: 'bad_redirect' }, 400);
  const challenge = typeof body?.code_challenge === 'string' ? body.code_challenge : '';
  if (body?.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    return portalReply(c, { error: 'pkce_required' }, 400);
  }

  // Say it here, where the person can act on it — not later at /oauth/token,
  // where the app would only show a bare invalid_grant. This app's own old
  // token does not count: reconnecting replaces it.
  const others = await env.DB.prepare(
    `SELECT count(*) AS n FROM agent_tokens
      WHERE user_id = ? AND revoked_at IS NULL AND (oauth_client_id IS NULL OR oauth_client_id <> ?)`,
  )
    .bind(user.id, client.client_id)
    .first<{ n: number }>();
  if ((others?.n ?? 0) >= MAX_AGENT_TOKENS) return portalReply(c, { error: 'too_many_tokens' }, 409);

  const code = randomToken();
  const t = now();
  await env.DB.prepare(
    `INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(await sha256(code), client.client_id, user.id, redirect, challenge, t + CODE_TTL_SECONDS, t)
    .run();
  const back = new URL(redirect);
  back.searchParams.set('code', code);
  if (typeof body?.state === 'string' && body.state.length <= 500) back.searchParams.set('state', body.state);
  back.searchParams.set('iss', issuer(env)); // RFC 9207: say which server answered
  return portalReply(c, { redirect: back.toString() });
});

/* —— token —— */

const tokenError = (error: string, description: string) => open({ error, error_description: description }, 400);

oauth.post('/oauth/token', async (c) => {
  const env = c.env;
  const type = c.req.header('content-type') ?? '';
  const form: Record<string, string> = {};
  if (type.includes('application/json')) {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(body)) if (typeof v === 'string') form[k] = v;
  } else {
    const params = new URLSearchParams(await c.req.text());
    for (const [k, v] of params) form[k] = v;
  }
  if (form.grant_type !== 'authorization_code') {
    return open({ error: 'unsupported_grant_type', error_description: 'Only authorization_code.' }, 400);
  }
  if (!form.code || !form.code_verifier || !form.client_id || !form.redirect_uri) {
    return tokenError('invalid_request', 'code, code_verifier, client_id and redirect_uri are required.');
  }
  // Claim the code once, whatever happens next: a replayed code is dead.
  const row = await env.DB.prepare(
    `UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
     RETURNING client_id, user_id, redirect_uri, code_challenge`,
  )
    .bind(now(), await sha256(form.code), now())
    .first<{ client_id: string; user_id: string; redirect_uri: string; code_challenge: string }>();
  if (!row) return tokenError('invalid_grant', 'The code is unknown, used or expired.');
  if (row.client_id !== form.client_id || row.redirect_uri !== form.redirect_uri) {
    return tokenError('invalid_grant', 'The code was issued to another client or redirect URI.');
  }
  if ((await pkceChallenge(form.code_verifier)) !== row.code_challenge) {
    return tokenError('invalid_grant', 'code_verifier does not match the code_challenge.');
  }
  const client = await getClient(env, row.client_id);
  const made = await mintAgentToken(env, row.user_id, (client?.client_name ?? 'An MCP client').slice(0, 60), row.client_id);
  if (!made.ok) {
    return tokenError('invalid_grant', made.error === 'too_many_tokens' ? 'This account has five connected assistants; revoke one in the portal.' : made.error);
  }
  return open({ access_token: made.token, token_type: 'Bearer', scope: SCOPE });
});
