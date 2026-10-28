/*
 * A client connects their own Cloudflare account, through Cloudflare's OAuth
 * and our client `malipetek` (docs/plans/hosting-and-connections.md, phase 4),
 * so a site can be hosted there and Cloudflare bills them directly.
 *
 *   GET    /portal/cloudflare            the client's grants + a signed connect link
 *   GET    /portal/cloudflare/callback   Cloudflare returns here (no session: the
 *                                        signed state says whose grant it is)
 *   DELETE /portal/cloudflare/:id        revoke at Cloudflare, forget here
 *
 * The consent screen lets the client choose which of their accounts to share
 * and shows the scopes; the grant is revocable from their Cloudflare profile as
 * well as here. Tokens are encrypted at rest and never leave this Worker:
 * `cloudflareAccess` is the one way to use one.
 */
import { Hono, type Context } from 'hono';
import { now, sessionUser, siteUrl } from './portal.ts';
import { corsHeaders, type Env, type HonoEnv } from './shared.ts';

export const cfconnect = new Hono<HonoEnv>();

/**
 * What our client is allowed to ask for (probed against /oauth2/auth: anything
 * else is `invalid_scope`). Workers + routes to deploy a site, DNS + zones to
 * put it on their domain, and the account/user reads the consent needs.
 */
export const CLOUDFLARE_SCOPES = [
  'account-settings.read',
  'memberships.read',
  'user-details.read',
  'workers-scripts.edit',
  'workers-routes.write',
  'zone.read',
  'dns.write',
];

const oauthBase = (env: Env) => (env.CLOUDFLARE_OAUTH_BASE ?? 'https://dash.cloudflare.com').replace(/\/+$/, '');
const apiBase = (env: Env) => (env.CLOUDFLARE_API_BASE ?? 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '');
const workerOrigin = (c: Context<HonoEnv>) => new URL(c.req.url).origin;
const callbackUrl = (c: Context<HonoEnv>) => `${workerOrigin(c)}/portal/cloudflare/callback`;
const STATE_SECONDS = 15 * 60;

const reply = (c: Context<HonoEnv>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(c.req.header('Origin') ?? null) },
  });

const enc = new TextEncoder();
const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));

/* ——————————————————————— signed state ——————————————————————— */

async function mac(env: Env, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET ?? ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(`cloudflare:${payload}`)));
}

/** Who asked, until when, plus a nonce: Cloudflare refuses a short state. */
async function signState(env: Env, userId: string): Promise<string> {
  const payload = `${userId}.${now() + STATE_SECONDS}.${b64url(crypto.getRandomValues(new Uint8Array(12)))}`;
  return `${b64url(enc.encode(payload))}.${await mac(env, payload)}`;
}

async function userFromState(env: Env, state: string): Promise<string | null> {
  const [encoded, sig] = state.split('.');
  if (!encoded || !sig) return null;
  let payload: string;
  try {
    payload = new TextDecoder().decode(fromB64url(encoded));
  } catch {
    return null;
  }
  const [userId, exp] = payload.split('.');
  if (!userId || !(Number(exp) >= now())) return null;
  const expected = await mac(env, payload);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? userId : null;
}

/* ——————————————————————— tokens at rest ——————————————————————— */

/** AES-GCM, with a key derived from SESSION_SECRET for this one purpose. */
async function tokenKey(env: Env): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET ?? ''), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('malipetek-cloudflare-connections'), info: enc.encode('token-at-rest') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function seal(env: Env, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const box = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(env), enc.encode(text));
  return `${b64url(iv)}.${b64url(box)}`;
}

async function open(env: Env, sealed: string): Promise<string> {
  const [iv, box] = sealed.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await tokenKey(env), fromB64url(box));
  return new TextDecoder().decode(plain);
}

/* ——————————————————————— Cloudflare calls ——————————————————————— */

type TokenReply = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };

/**
 * The token endpoint, with the client secret. Basic auth first; a client
 * registered for client_secret_post refuses that with invalid_client, so the
 * same request is tried once more with the secret in the body.
 */
async function tokenRequest(env: Env, params: Record<string, string>): Promise<TokenReply> {
  const id = env.CLOUDFLARE_OAUTH_CLIENT_ID ?? '';
  const secret = env.CLOUDFLARE_OAUTH_CLIENT_SECRET ?? '';
  const send = (post: boolean) =>
    fetch(`${oauthBase(env)}/oauth2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        ...(post ? {} : { authorization: `Basic ${btoa(`${id}:${secret}`)}` }),
      },
      body: new URLSearchParams(post ? { ...params, client_id: id, client_secret: secret } : params),
      signal: AbortSignal.timeout(15_000),
    });
  let res = await send(false);
  if (res.status === 401) res = await send(true);
  return ((await res.json().catch(() => null)) as TokenReply | null) ?? { error: `HTTP ${res.status}` };
}

/** The accounts this grant reaches, for the portal to name. */
async function grantedAccounts(env: Env, accessToken: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${apiBase(env)}/accounts?per_page=50`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as { result?: { id?: string; name?: string }[] } | null;
  return (body?.result ?? []).filter((a) => a.id).map((a) => ({ id: String(a.id), name: String(a.name ?? a.id).slice(0, 120) }));
}

type ConnectionRow = {
  id: number;
  user_id: string;
  accounts: string;
  scopes: string;
  access_enc: string;
  refresh_enc: string | null;
  expires_at: number | null;
  created_at: number;
  revoked_at: number | null;
};

/**
 * A usable access token for a connection, refreshed when it is about to lapse
 * and a refresh token exists. Null when the grant has lapsed for good: the
 * portal shows "reconnect".
 */
export async function cloudflareAccess(env: Env, connectionId: number): Promise<string | null> {
  const row = await env.DB.prepare('SELECT * FROM cloudflare_connections WHERE id = ? AND revoked_at IS NULL')
    .bind(connectionId)
    .first<ConnectionRow>();
  if (!row) return null;
  if (!row.expires_at || row.expires_at - 60 > now()) return open(env, row.access_enc);
  if (!row.refresh_enc) return null;
  const fresh = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: await open(env, row.refresh_enc) });
  if (!fresh.access_token) return null;
  await env.DB.prepare('UPDATE cloudflare_connections SET access_enc = ?, refresh_enc = coalesce(?, refresh_enc), expires_at = ?, updated_at = ? WHERE id = ?')
    .bind(
      await seal(env, fresh.access_token),
      fresh.refresh_token ? await seal(env, fresh.refresh_token) : null,
      fresh.expires_in ? now() + fresh.expires_in : null,
      now(),
      row.id,
    )
    .run();
  return fresh.access_token;
}

/* ——————————————————————— routes ——————————————————————— */

/** The bearer session. An agent token is not a session, so assistants cannot manage this. */
async function browserUser(env: Env, c: Context<HonoEnv>) {
  const token = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return token ? sessionUser(env, token) : null;
}

cfconnect.get('/portal/cloudflare', async (c) => {
  const env = c.env;
  const user = await browserUser(env, c);
  if (!user) return reply(c, { error: 'unauthorized' }, 401);
  const { results } = await env.DB.prepare(
    `SELECT id, accounts, scopes, expires_at, refresh_enc IS NOT NULL AS renewable, created_at
       FROM cloudflare_connections WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`,
  )
    .bind(user.id)
    .all<{ id: number; accounts: string; scopes: string; expires_at: number | null; renewable: number; created_at: number }>();
  const configured = Boolean(env.CLOUDFLARE_OAUTH_CLIENT_ID && env.CLOUDFLARE_OAUTH_CLIENT_SECRET);
  const connectUrl =
    configured && user.role === 'client'
      ? `${oauthBase(env)}/oauth2/auth?${new URLSearchParams({
          response_type: 'code',
          client_id: env.CLOUDFLARE_OAUTH_CLIENT_ID!,
          redirect_uri: callbackUrl(c),
          scope: CLOUDFLARE_SCOPES.join(' '),
          state: await signState(env, user.id),
        })}`
      : null;
  return reply(c, {
    connections: (results ?? []).map((r) => ({
      id: r.id,
      accounts: JSON.parse(r.accounts || '[]'),
      scopes: r.scopes ? r.scopes.split(' ') : [],
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      // No refresh token and past its time: it cannot be used again.
      lapsed: !r.renewable && r.expires_at !== null && r.expires_at < now(),
    })),
    connectUrl,
  });
});

/** Cloudflare's redirect after consent (or refusal). Always lands back on the portal's Connections page. */
cfconnect.get('/portal/cloudflare/callback', async (c) => {
  const env = c.env;
  const back = (outcome: string) => c.redirect(`${siteUrl(env)}/portal/?cloudflare=${outcome}#/connections`);
  if (c.req.query('error')) return back(c.req.query('error') === 'access_denied' ? 'declined' : 'failed');
  const userId = await userFromState(env, c.req.query('state') ?? '');
  const user = userId
    ? await env.DB.prepare(`SELECT id FROM users WHERE id = ? AND role = 'client'`).bind(userId).first<{ id: string }>()
    : null;
  if (!user) return back('signin');
  const code = c.req.query('code') ?? '';
  if (!code) return back('failed');

  const token = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: callbackUrl(c) });
  if (!token.access_token) return back('failed');
  const accounts = await grantedAccounts(env, token.access_token).catch(() => []);
  const t = now();
  await env.DB.prepare(
    `INSERT INTO cloudflare_connections (user_id, accounts, scopes, access_enc, refresh_enc, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      user.id,
      JSON.stringify(accounts),
      (token.scope ?? CLOUDFLARE_SCOPES.join(' ')).slice(0, 1000),
      await seal(env, token.access_token),
      token.refresh_token ? await seal(env, token.refresh_token) : null,
      token.expires_in ? t + token.expires_in : null,
      t,
      t,
    )
    .run();
  return back('connected');
});

/** Disconnect: revoke the grant at Cloudflare (best effort), and forget the tokens here. */
cfconnect.delete('/portal/cloudflare/:id', async (c) => {
  const env = c.env;
  const user = await browserUser(env, c);
  if (!user) return reply(c, { error: 'unauthorized' }, 401);
  const row = await env.DB.prepare('SELECT * FROM cloudflare_connections WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(Number(c.req.param('id')), user.id)
    .first<ConnectionRow>();
  if (!row) return reply(c, { error: 'not_found' }, 404);
  try {
    const token = await open(env, row.refresh_enc ?? row.access_enc);
    await fetch(`${oauthBase(env)}/oauth2/revoke`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${env.CLOUDFLARE_OAUTH_CLIENT_ID ?? ''}:${env.CLOUDFLARE_OAUTH_CLIENT_SECRET ?? ''}`)}`,
      },
      body: new URLSearchParams({ token, token_type_hint: row.refresh_enc ? 'refresh_token' : 'access_token' }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* forgetting it here still cuts our access; the client can also revoke on Cloudflare */
  }
  await env.DB.prepare(`UPDATE cloudflare_connections SET revoked_at = ?, access_enc = '', refresh_enc = NULL, updated_at = ? WHERE id = ?`)
    .bind(now(), now(), row.id)
    .run();
  return reply(c, { ok: true });
});
