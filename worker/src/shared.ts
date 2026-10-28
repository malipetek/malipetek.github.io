/*
 * Plumbing shared by the intercom routes (app.ts) and the client portal
 * (portal.ts): env shape, CORS, JSON responses, KV rate limiting, Turnstile.
 */

export interface Env {
  /** Secret. OpenRouter API key, consumed by the Flue `openrouter` provider. */
  OPENROUTER_API_KEY?: string;
  /** Secret. Turnstile secret. If unset, verification is skipped (local dev). */
  TURNSTILE_SECRET_KEY?: string;
  /** Var/secret. Directus base URL. */
  DIRECTUS_URL?: string;
  /** Secret. Directus token. */
  DIRECTUS_TOKEN?: string;
  /** Var. From address for handoff emails (must be on an onboarded domain). */
  CONTACT_FROM_EMAIL?: string;
  /** Secret. Signs short-lived chat session tokens. */
  SESSION_SECRET?: string;
  /** Cloudflare Email Service send binding. */
  EMAIL?: SendEmail;
  /** KV namespace for per-IP rate limiting. */
  RATE_LIMIT: KVNamespace;
  /** D1 — client portal: users, sessions, projects, tickets, messages. */
  DB: D1Database;
  /** D1 — public agentic coding knowledgebase (entries, FTS, api_keys). */
  KB_DB: D1Database;
  /** Unpinned Email Service binding: magic links and ticket updates to clients. */
  MAILER?: SendEmail;
  /** Var. From address for portal mail (must be on an onboarded domain). */
  PORTAL_FROM_EMAIL?: string;
  /** Var. The one address that signs in with the admin role. */
  ADMIN_EMAIL?: string;
  /** Secret. Reviewer demo sign-in: the only email /auth/demo accepts. */
  DEMO_EMAIL?: string;
  /** Secret. The code /auth/demo requires alongside DEMO_EMAIL. */
  DEMO_LOGIN_CODE?: string;
  /** Var. Public site origin, used to build magic links. */
  SITE_URL?: string;
  /** Var. Email Routing address (with subaddressing) that feeds src/inbound.ts. */
  REPLY_ADDRESS?: string;
  /** Unpinned Email Service binding for outreach (src/marketing.ts). Unbound = no sends. */
  MARKETING?: SendEmail;
  /** Var. From address for outreach mail (must be on an onboarded domain). */
  MARKETING_FROM_EMAIL?: string;
  /** Secret. Bearer for the local publisher poll (src/marketing.ts). Unset disables it. */
  MARKETING_TOKEN?: string;
  /** Secret. Shared with the local runner on Ali's machine; unset disables /runner/*. */
  RUNNER_TOKEN?: string;
  /** R2 — ticket attachments (src/files.ts). Unbound = uploads are refused. */
  FILES?: R2Bucket;
  /** R2 — hosted site deploys (src/sites.ts). Unbound = no site setup or deploys. */
  SITES?: R2Bucket;
  /** Secrets — the malipetek-dev GitHub App (src/github.ts). */
  GITHUB_APP_ID?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  /** Secrets — the `malipetek` Cloudflare OAuth client (src/cfconnect.ts). */
  CLOUDFLARE_OAUTH_CLIENT_ID?: string;
  CLOUDFLARE_OAUTH_CLIENT_SECRET?: string;
  /** Var, tests only: where the Cloudflare OAuth and API calls go. */
  CLOUDFLARE_OAUTH_BASE?: string;
  CLOUDFLARE_API_BASE?: string;
  /** Var, local dev only. "1" returns the magic link in the /auth/request response. */
  DEV_RETURN_LINK?: string;
}

export type HonoEnv = { Bindings: Env };

export const ALLOWED_ORIGINS = [
  'https://malipetek.dev',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
];

export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

/**
 * Seconds since the epoch — the unit every portal table stores. It lives here
 * rather than in portal.ts so the run-tracking module can use it without
 * importing the portal, which imports the run-tracking module.
 */
export const now = () => Math.floor(Date.now() / 1000);

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-session, authorization',
    'Access-Control-Expose-Headers': 'x-intercom-session',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function json(data: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), 'content-type': 'application/json; charset=utf-8' },
  });
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** Fixed-window counter in KV. Good enough; not a Durable Object. */
export async function isRateLimited(
  env: Env,
  ip: string,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `rl:${bucket}:${ip}:${window}`;
  const current = Number((await env.RATE_LIMIT.get(key)) ?? 0);
  if (current >= limit) return true;
  await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: windowSeconds + 10 });
  return false;
}

export async function verifyTurnstile(env: Env, token: string | undefined, ip: string): Promise<boolean> {
  // Without a configured secret (local dev), do not block.
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  if (ip && ip !== '0.0.0.0') form.append('remoteip', ip);

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}

