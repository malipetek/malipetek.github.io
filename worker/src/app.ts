/*
 * malipetek.dev intercom worker — Flue edition.
 *
 * The assistant itself is a Flue agent (src/agents/intercom.ts): each visitor
 * session maps to one Durable Object conversation, so history persists and the
 * model can call `request_handoff` to end a turn with an editable note card.
 *
 * Public surface (unchanged for the static frontend):
 *   POST /chat    — Turnstile once per session → forward the new message into
 *                   the visitor's agent conversation → poll the snapshot until
 *                   the submission settles → emit our tiny SSE vocabulary.
 *   POST /handoff — store the note in Directus (if configured) and send it by
 *                   email via the Cloudflare Email Service `EMAIL` binding.
 *   GET  /health
 *
 * The /agents/* mount is internal-only: it requires the same signed session
 * the frontend carries, so nobody can drive the agent without a session.
 *
 * No secrets live in this repo: everything sensitive is a Worker secret.
 */
import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { Intercom } from './agents/intercom.ts';

interface Env {
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
}

type HonoEnv = { Bindings: Env };

const ALLOWED_ORIGINS = [
  'https://malipetek.dev',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
];

const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 2000;
const MAX_TOTAL_CHARS = 4000;
const MAX_EMAIL_CHARS = 254;
const MAX_SUMMARY_CHARS = 4000;
const SESSION_TTL_SECONDS = 30 * 60;
const CHAT_LIMIT = 20; // per IP per window
const CHAT_WINDOW_SECONDS = 5 * 60;
const HANDOFF_LIMIT = 5; // per IP per window
const HANDOFF_WINDOW_SECONDS = 60 * 60;
/** How long /chat waits for the agent turn to settle before giving up. */
const SETTLE_TIMEOUT_MS = 25000;
const SETTLE_POLL_MS = 500;

/* ——————————————————————— small utilities ——————————————————————— */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-session',
    'Access-Control-Expose-Headers': 'x-intercom-session',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(data: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), 'content-type': 'application/json; charset=utf-8' },
  });
}

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function sessionSecret(env: Env): string {
  return env.SESSION_SECRET || env.OPENROUTER_API_KEY || 'insecure-dev-secret';
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** A signed `ip|expiry` token so Turnstile only needs to run once per session. */
async function signSession(env: Env, ip: string): Promise<string> {
  const payload = `${ip}|${Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(sessionSecret(env)), encoder.encode(payload));
  return `${toBase64Url(encoder.encode(payload))}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verifySession(env: Env, token: string, ip: string): Promise<boolean> {
  const [payloadPart, signaturePart] = token.split('.');
  if (!payloadPart || !signaturePart) return false;

  const payload = decoder.decode(fromBase64Url(payloadPart));
  const [tokenIp, expiry] = payload.split('|');
  if (tokenIp !== ip) return false;
  if (!Number(expiry) || Number(expiry) < Math.floor(Date.now() / 1000)) return false;

  const expected = await crypto.subtle.sign('HMAC', await hmacKey(sessionSecret(env)), encoder.encode(payload));
  return toBase64Url(new Uint8Array(expected)) === signaturePart;
}

/** Conversation id: deterministic per IP, unguessable without the secret. */
async function conversationId(env: Env, ip: string): Promise<string> {
  const digest = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(sessionSecret(env)),
    encoder.encode(`convo|${ip}`),
  );
  return `v-${toBase64Url(new Uint8Array(digest)).slice(0, 32)}`;
}

/** Fixed-window counter in KV. Good enough; not a Durable Object. */
async function isRateLimited(
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

async function verifyTurnstile(env: Env, token: string | undefined, ip: string): Promise<boolean> {
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

/** Accept a valid session token, otherwise require a fresh Turnstile token. */
async function authorize(env: Env, request: Request, ip: string, turnstileToken: unknown): Promise<boolean> {
  const session = request.headers.get('x-session');
  if (session && (await verifySession(env, session, ip))) return true;
  return verifyTurnstile(env, typeof turnstileToken === 'string' ? turnstileToken : undefined, ip);
}

/* ——————————————————————— app ——————————————————————— */

const app = new Hono<HonoEnv>();

// The agent mount is internal-only: every /agents/* route requires the same
// signed session the public /chat and /handoff endpoints issue.
app.use('/agents/*', async (c, next) => {
  const session = c.req.header('x-session');
  if (session && (await verifySession(c.env, session, clientIp(c.req.raw)))) return next();
  return c.json({ error: 'unauthorized' }, 401);
});

app.route('/agents/intercom', createAgentRouter(Intercom) as unknown as Hono<HonoEnv>);

app.get('/health', (c) => json({ ok: true }, 200, c.req.header('Origin') ?? null));

/* ——————————————————————— /chat ——————————————————————— */

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function cleanMessages(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) return null;
  const messages: ChatMessage[] = [];
  let total = 0;
  for (const item of input) {
    if (!item || typeof item !== 'object') return null;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if (role !== 'user' && role !== 'assistant') return null;
    if (typeof content !== 'string' || content.length === 0 || content.length > MAX_MESSAGE_CHARS) return null;
    total += content.length;
    messages.push({ role, content });
  }
  return total > MAX_TOTAL_CHARS ? null : messages;
}

interface SnapshotMessage {
  role?: string;
  purpose?: string;
  parts?: Array<Record<string, unknown>>;
}

interface Snapshot {
  settlements?: Array<{ submissionId?: string; outcome?: string; error?: unknown }>;
  messages?: SnapshotMessage[];
}

type RequestCtx = Parameters<Hono<HonoEnv>['request']>[3];

/** Read the conversation snapshot until this submission settles or we time out. */
async function awaitSettlement(
  env: Env,
  ctx: RequestCtx,
  path: string,
  session: string,
  ip: string,
  submissionId: string,
): Promise<Snapshot | null> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let snapshot: Snapshot | null = null;
  while (Date.now() < deadline) {
    const res = await app.request(`${path}?view=history`, {
      headers: { 'x-session': session, 'cf-connecting-ip': ip },
    }, env, ctx);
    if (res.ok) {
      snapshot = (await res.json()) as Snapshot;
      if (snapshot.settlements?.some((s) => s.submissionId === submissionId)) return snapshot;
    }
    await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
  }
  return snapshot;
}

app.post('/chat', async (c) => {
  const origin = c.req.header('Origin') ?? null;
  const env = c.env;

  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: 'origin_not_allowed' }, 403, origin);
  }
  if (!env.OPENROUTER_API_KEY) return json({ error: 'backend_not_configured' }, 503, origin);

  let body: { messages?: unknown; turnstileToken?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return json({ error: 'bad_json' }, 400, origin);
  }

  const messages = cleanMessages(body.messages);
  if (!messages) return json({ error: 'bad_messages' }, 400, origin);

  const ip = clientIp(c.req.raw);
  if (await isRateLimited(env, ip, 'chat', CHAT_LIMIT, CHAT_WINDOW_SECONDS)) {
    return json({ error: 'rate_limited' }, 429, origin);
  }
  if (!(await authorize(env, c.req.raw, ip, body.turnstileToken))) {
    return json({ error: 'turnstile_failed' }, 403, origin);
  }

  // History already lives in the Durable Object — only the newest user turn
  // is forwarded. The session token is minted before the internal call so the
  // /agents/* guard accepts it.
  const session = await signSession(env, ip);
  const convoId = await conversationId(env, ip);
  const agentPath = `/agents/intercom/${convoId}`;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')!;

  // The internal subrequest doesn't inherit headers — forward the real IP so
  // the /agents/* guard sees the same ip the session token is bound to.
  const admission = await app.request(agentPath, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-session': session,
      'cf-connecting-ip': ip,
    },
    body: JSON.stringify({ kind: 'user', body: lastUser.content }),
  }, env, c.executionCtx);

  const admissionText = await admission.text();
  if (admission.status !== 202) {
    console.error('agent_rejected', admission.status, admissionText);
    return json({ error: 'agent_rejected' }, 502, origin);
  }
  const { submissionId } = JSON.parse(admissionText) as { submissionId: string };

  const snapshot = await awaitSettlement(env, c.executionCtx, agentPath, session, ip, submissionId);

  // Pull the reply out of the settled snapshot: the last assistant message's
  // text parts, plus a request_handoff tool call if the agent made one.
  let text = '';
  let handoff: string | null = null;
  const settlement = snapshot?.settlements?.find((s) => s.submissionId === submissionId);
  const settled = Boolean(settlement);
  // An upstream rate limit (e.g. OpenRouter's shared free pool) reads better
  // as "try again in a minute" than a generic error.
  const upstreamLimited =
    settlement?.outcome === 'failed' &&
    /429|rate.?limit/i.test(JSON.stringify(settlement.error ?? ''));
  if (settled) {
    const lastAssistant = [...(snapshot?.messages ?? [])]
      .reverse()
      .find((m) => m.role === 'assistant');
    for (const part of lastAssistant?.parts ?? []) {
      if (part.type === 'text' && typeof part.text === 'string') text += part.text;
      if (part.type === 'dynamic-tool' && part.toolName === 'request_handoff') {
        const input = part.input as { summary?: unknown } | undefined;
        if (typeof input?.summary === 'string') handoff = input.summary.slice(0, MAX_SUMMARY_CHARS);
      }
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      if (upstreamLimited) {
        send({ type: 'end', kind: 'rate', handoff: null });
      } else if (!settled || (!text && !handoff)) {
        send({ type: 'end', kind: 'error', handoff: null });
      } else {
        // Emit the settled reply in a few word-groups so the UI still reads
        // as typed rather than a wall of text appearing at once.
        const words = text.match(/\S+\s*/g) ?? [];
        for (let i = 0; i < words.length; i += 8) {
          send({ type: 'chunk', text: words.slice(i, i + 8).join('') });
        }
        send({ type: 'end', kind: handoff ? 'handoff' : 'answer', handoff });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders(origin),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-intercom-session': session,
    },
  });
});

/* ——————————————————————— /handoff ——————————————————————— */

interface HandoffBody {
  email?: unknown;
  message?: unknown;
  summary?: unknown;
  source?: unknown;
  turnstileToken?: unknown;
}

async function storeInDirectus(env: Env, record: Record<string, unknown>): Promise<boolean> {
  if (!env.DIRECTUS_URL || !env.DIRECTUS_TOKEN) {
    console.warn('directus_not_configured', JSON.stringify(record));
    return false;
  }
  try {
    const response = await fetch(`${env.DIRECTUS_URL.replace(/\/$/, '')}/items/contact_messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.DIRECTUS_TOKEN}`,
      },
      body: JSON.stringify(record),
    });
    if (!response.ok) console.error('directus_failed', response.status, await response.text());
    return response.ok;
  } catch (error) {
    console.error('directus_error', error);
    return false;
  }
}

/** Cloudflare Email Service. Needs the send_email binding plus an onboarded domain. */
async function emailViaEmailService(
  env: Env,
  email: string,
  message: string,
  summary: string,
  source: string,
): Promise<boolean> {
  if (!env.EMAIL) return false;
  try {
    await env.EMAIL.send({
      from: env.CONTACT_FROM_EMAIL || 'intercom@malipetek.dev',
      to: 'malipetek@gmail.com', // pinned by the binding's destination_address
      subject: `${source === 'contact' ? 'Contact form' : 'Intercom note'} from ${email}`,
      text: `From: ${email}\n\n${message || summary}\n\n---\n${summary}`,
    });
    return true;
  } catch (error) {
    console.error('email_send_failed', error);
    return false;
  }
}

app.post('/handoff', async (c) => {
  const origin = c.req.header('Origin') ?? null;
  const env = c.env;

  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: 'origin_not_allowed' }, 403, origin);
  }

  let body: HandoffBody;
  try {
    body = (await c.req.json()) as HandoffBody;
  } catch {
    return json({ error: 'bad_json' }, 400, origin);
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';

  if (!email || email.length > MAX_EMAIL_CHARS || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'bad_email' }, 400, origin);
  }
  if (message.length > MAX_SUMMARY_CHARS || summary.length > MAX_SUMMARY_CHARS) {
    return json({ error: 'too_long' }, 400, origin);
  }
  if (!message && !summary) return json({ error: 'empty' }, 400, origin);

  const ip = clientIp(c.req.raw);
  if (await isRateLimited(env, ip, 'handoff', HANDOFF_LIMIT, HANDOFF_WINDOW_SECONDS)) {
    return json({ error: 'rate_limited' }, 429, origin);
  }
  if (!(await authorize(env, c.req.raw, ip, body.turnstileToken))) {
    return json({ error: 'turnstile_failed' }, 403, origin);
  }

  const source = body.source === 'contact' ? 'contact' : 'intercom';
  const record = { email, message: message || summary, summary, source };
  const stored = await storeInDirectus(env, record);
  const emailed = await emailViaEmailService(env, email, message, summary, source);

  if (!stored && !emailed) return json({ error: 'delivery_failed' }, 502, origin);
  return json({ ok: true, stored, emailed }, 200, origin);
});

/* ——————————————————————— CORS shell ——————————————————————— */

app.options('*', (c) => {
  const origin = c.req.header('Origin') ?? null;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
});

export default app;
