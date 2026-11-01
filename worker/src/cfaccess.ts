/*
 * The client's Cloudflare grant: encrypted at rest, refreshed on use, and the
 * only way a site is deployed into their account.
 *
 * Kept apart from `cfconnect.ts` (which owns the OAuth routes) so `sites.ts`
 * can use a grant without importing the portal module the OAuth routes need.
 * That keeps the import graph acyclic:
 *
 *   portal.ts -> sites.ts -> cloudflare-sites.ts -> cfaccess.ts -> shared.ts
 */
import { now, type Env } from './shared.ts';

export type TokenReply = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

export const oauthBase = (env: Env) =>
  (env.CLOUDFLARE_OAUTH_BASE ?? 'https://dash.cloudflare.com').replace(/\/+$/, '');
export const apiBase = (env: Env) =>
  (env.CLOUDFLARE_API_BASE ?? 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '');

const enc = new TextEncoder();
const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));

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

export async function seal(env: Env, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const box = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(env), enc.encode(text));
  return `${b64url(iv)}.${b64url(box)}`;
}

export async function open(env: Env, sealed: string): Promise<string> {
  const [iv, box] = sealed.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await tokenKey(env), fromB64url(box));
  return new TextDecoder().decode(plain);
}

/**
 * The token endpoint, with the client secret. Basic auth first; a client
 * registered for client_secret_post refuses that with invalid_client, so the
 * same request is tried once more with the secret in the body.
 */
export async function tokenRequest(env: Env, params: Record<string, string>): Promise<TokenReply> {
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

export type ConnectionRow = {
  id: number;
  user_id: string;
  kind: string;
  label: string | null;
  accounts: string;
  scopes: string;
  access_enc: string;
  refresh_enc: string | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
  revoked_at: number | null;
};

export async function connectionRow(env: Env, connectionId: number): Promise<ConnectionRow | null> {
  return env.DB.prepare('SELECT * FROM cloudflare_connections WHERE id = ? AND revoked_at IS NULL')
    .bind(connectionId)
    .first<ConnectionRow>();
}

export interface GrantedAccount {
  id: string;
  name: string;
}

export function grantedAccounts(row: Pick<ConnectionRow, 'accounts'>): GrantedAccount[] {
  try {
    const parsed = JSON.parse(row.accounts || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a): a is GrantedAccount => Boolean(a) && typeof (a as GrantedAccount).id === 'string')
      .map((a) => ({ id: a.id, name: String(a.name ?? a.id).slice(0, 120) }));
  } catch {
    return [];
  }
}

/**
 * Check a pasted Cloudflare API token and list the accounts it reaches. The
 * token is a durable alternative to OAuth, whose grants expire after an hour
 * unless Cloudflare issues a refresh token (this client does not).
 */
export async function verifyApiToken(
  env: Env,
  token: string,
): Promise<{ accounts: GrantedAccount[] } | { error: string }> {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const verify = await fetch(`${apiBase(env)}/user/tokens/verify`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await verify.json().catch(() => null)) as
    | { success?: boolean; result?: { status?: string }; errors?: { message?: string }[] }
    | null;
  if (!verify.ok || !body?.success || body.result?.status !== 'active') {
    return { error: body?.errors?.[0]?.message ?? `Cloudflare answered ${verify.status}` };
  }
  const res = await fetch(`${apiBase(env)}/accounts?per_page=50`, { headers, signal: AbortSignal.timeout(15_000) });
  const data = (await res.json().catch(() => null)) as { result?: { id?: string; name?: string }[] } | null;
  const accounts = (data?.result ?? [])
    .filter((a) => a.id)
    .map((a) => ({ id: String(a.id), name: String(a.name ?? a.id).slice(0, 120) }));
  if (!accounts.length) return { error: 'the token reaches no Cloudflare account' };
  return { accounts };
}

/**
 * A usable access token for a connection, refreshed when it is about to lapse
 * and a refresh token exists. Null when the grant has lapsed for good: the
 * portal shows "reconnect".
 */
export async function cloudflareAccess(env: Env, connectionId: number): Promise<string | null> {
  const row = await connectionRow(env, connectionId);
  if (!row) return null;
  // An API token does not expire; there is nothing to refresh.
  if (row.kind === 'token') return open(env, row.access_enc);
  if (!row.expires_at || row.expires_at - 60 > now()) return open(env, row.access_enc);
  if (!row.refresh_enc) return null;
  const fresh = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: await open(env, row.refresh_enc) });
  if (!fresh.access_token) return null;
  await env.DB.prepare(
    'UPDATE cloudflare_connections SET access_enc = ?, refresh_enc = coalesce(?, refresh_enc), expires_at = ?, updated_at = ? WHERE id = ?',
  )
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
