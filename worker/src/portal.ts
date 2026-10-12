/*
 * Client portal — D1-backed accounts and tickets.
 *
 *   POST /auth/request   { email, turnstileToken }  → emails a magic link
 *   POST /auth/verify    { token }                   → { session, user }
 *   POST /auth/logout
 *
 *   Signed in (Authorization: Bearer <session>):
 *   GET  /portal/me                       user + linked projects
 *   GET  /portal/tickets                  own tickets
 *   POST /portal/tickets                  { title, body, projectId? }
 *   GET  /portal/tickets/:id              ticket + public messages
 *   POST /portal/tickets/:id/messages     { body }
 *
 *   Admin role only (ADMIN_EMAIL signs in as admin):
 *   GET   /admin/tickets?status=
 *   GET   /admin/tickets/:id              includes internal notes
 *   PATCH /admin/tickets/:id              { status?, projectId? }
 *   POST  /admin/tickets/:id/messages     { body, internal? }
 *   GET   /admin/clients
 *   GET   /admin/projects   POST /admin/projects { name, slug }
 *   PUT / DELETE /admin/clients/:userId/projects/:projectId
 *
 * Approval is a status change only Ali can make; nothing in this file runs
 * work on a ticket. Sessions are opaque random tokens; only their SHA-256
 * lives in D1, same for magic-link tokens.
 */
import { Hono, type Context } from 'hono';
import { ATTENTION_KEYS, DEFAULT_ATTENTION, priceLine, priceOf } from '../../src/lib/pricing.js';
import { claimTicketById, finishRun, normalizeReport, openRuns, recentRuns, ticketRuns } from './runs.ts';
import {
  ALLOWED_ORIGINS,
  clientIp,
  corsHeaders,
  encoder,
  isRateLimited,
  json,
  now,
  toBase64Url,
  verifyTurnstile,
  type Env,
  type HonoEnv,
} from './shared.ts';

export { now };

const LINK_TTL_SECONDS = 15 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_EMAIL_CHARS = 254;
export const MAX_TITLE_CHARS = 140;
export const MAX_BODY_CHARS = 8000;
const MAX_NAME_CHARS = 80;
const AUTH_IP_LIMIT = 5; // magic-link requests per IP per window
const AUTH_EMAIL_LIMIT = 3; // per address per window
const AUTH_WINDOW_SECONDS = 15 * 60;
const TICKET_LIMIT = 10; // new tickets per user per window
const TICKET_WINDOW_SECONDS = 60 * 60;

const STATUSES = ['new', 'approved', 'in_progress', 'review', 'done', 'declined'] as const;
type Status = (typeof STATUSES)[number];

const STATUS_LABEL: Record<Status, string> = {
  new: 'Waiting for Ali',
  approved: 'Approved',
  in_progress: 'In progress',
  review: 'In review',
  done: 'Done',
  declined: 'Declined',
};

interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'client' | 'admin';
}

type PortalEnv = HonoEnv & { Variables: { user: User } };
type Ctx = Context<PortalEnv>;

/* ——————————————————————— helpers ——————————————————————— */

function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email && email.length <= MAX_EMAIL_CHARS && EMAIL_RE.test(email) ? email : null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

async function readJson<T>(c: Ctx): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

const origin = (c: Ctx) => c.req.header('Origin') ?? null;
const reply = (c: Ctx, data: unknown, status = 200) => json(data, status, origin(c));

export function siteUrl(env: Env): string {
  return (env.SITE_URL || 'https://malipetek.dev').replace(/\/+$/, '');
}

/* ——————————————————————— mail ——————————————————————— */

/*
 * Ticket mail threads by Reply-To. Each outbound ticket email carries
 * reply+<ticket>.<c|a>.<sig>@<domain>: `c` replies post as the client, `a` as
 * Ali. The sig is an HMAC over ticket+role, lowercase hex because some mail
 * paths lowercase the local part. src/inbound.ts verifies it — plus the sender
 * address — before anything lands in the thread.
 */

/** First line of every ticket email; inbound parsing cuts the quote here. */
export const REPLY_MARKER = '##- Reply above this line -##';

export type ReplyRole = 'c' | 'a';

function replySecret(env: Env): string {
  return env.SESSION_SECRET || env.OPENROUTER_API_KEY || 'insecure-dev-secret';
}

export async function replySig(env: Env, ticketId: number, role: ReplyRole): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(replySecret(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`reply|${ticketId}|${role}`));
  return [...new Uint8Array(mac).slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function replyDomain(env: Env): string {
  return (env.REPLY_ADDRESS || 'reply@malipetek.dev').split('@')[1];
}

export async function replyAddress(env: Env, ticketId: number, role: ReplyRole): Promise<string> {
  const [local, domain] = (env.REPLY_ADDRESS || 'reply@malipetek.dev').split('@');
  return `${local}+${ticketId}.${role}.${await replySig(env, ticketId, role)}@${domain}`;
}

/** Wrap a ticket email body: marker on top, a plain footer below. */
function ticketMail(body: string, footer: string): string {
  return `${REPLY_MARKER}\n\n${body}\n\n-- \n${footer}`;
}

interface Mail {
  subject: string;
  text: string;
  replyTo?: string;
}

/** Mail to a client (unpinned MAILER binding). Failures are logged, not thrown. */
export async function mailClient(env: Env, to: string, mail: Mail): Promise<boolean> {
  if (!env.MAILER) {
    console.warn('mailer_not_configured', to, mail.subject);
    return false;
  }
  try {
    await env.MAILER.send({
      from: { email: env.PORTAL_FROM_EMAIL || 'portal@malipetek.dev', name: 'malipetek.dev' },
      to,
      ...mail,
    });
    return true;
  } catch (error) {
    console.error('mail_client_failed', error);
    return false;
  }
}

/** Mail to Ali (the pinned EMAIL binding — it can only ever reach his inbox). */
export async function mailAli(env: Env, mail: Mail): Promise<void> {
  if (!env.EMAIL) {
    console.warn('email_not_configured', mail.subject);
    return;
  }
  try {
    await env.EMAIL.send({
      from: env.PORTAL_FROM_EMAIL || env.CONTACT_FROM_EMAIL || 'portal@malipetek.dev',
      to: 'malipetek@gmail.com', // pinned by the binding's destination_address
      ...mail,
    });
  } catch (error) {
    console.error('mail_ali_failed', error);
  }
}

/*
 * The four ticket notifications, shared by the HTTP routes and inbound mail.
 * Each one sets Reply-To so answering from an inbox lands in the thread.
 */
type TicketRef = { id: number; title: string; client_email: string };

export async function notifyAliOfClientMessage(env: Env, t: TicketRef, text: string, isNew: boolean) {
  await mailAli(env, {
    subject: `[#${t.id}] ${isNew ? `New ticket from ${t.client_email}` : `${t.client_email} replied`}: ${t.title}`,
    text: ticketMail(
      text,
      `Replying to this email answers ${t.client_email} — they will see it.\n` +
        `${isNew ? 'Review and approve' : 'Open'}: ${siteUrl(env)}/portal/admin#ticket=${t.id}`,
    ),
    replyTo: await replyAddress(env, t.id, 'a'),
  });
}

export async function notifyClientOfReply(env: Env, t: TicketRef, text: string) {
  await mailClient(env, t.client_email, {
    subject: `[#${t.id}] Ali replied: ${t.title}`,
    text: ticketMail(text, `Reply to this email, or open the thread: ${siteUrl(env)}/portal/ticket#id=${t.id}`),
    replyTo: await replyAddress(env, t.id, 'c'),
  });
}

async function notifyClientOfStatus(env: Env, t: TicketRef, status: Status, bill?: string) {
  await mailClient(env, t.client_email, {
    subject: `[#${t.id}] ${STATUS_LABEL[status]}: ${t.title}`,
    text: ticketMail(
      `Your request “${t.title}” is now: ${STATUS_LABEL[status]}.${bill ? `\n\nTotal: ${bill}` : ''}`,
      `Reply to this email, or open the thread: ${siteUrl(env)}/portal/ticket#id=${t.id}`,
    ),
    replyTo: await replyAddress(env, t.id, 'c'),
  });
}

export async function confirmTicketToClient(env: Env, t: TicketRef) {
  await mailClient(env, t.client_email, {
    subject: `[#${t.id}] Got it: ${t.title}`,
    text: ticketMail(
      `Your request is in. Ali reads every one himself before anything happens, ` +
        `and you'll get an email here when he replies or the status changes.`,
      `Reply to this email to add details, or open the thread: ${siteUrl(env)}/portal/ticket#id=${t.id}`,
    ),
    replyTo: await replyAddress(env, t.id, 'c'),
  });
}

/* ——————————————————————— queries ——————————————————————— */

export async function sessionUser(env: Env, token: string): Promise<User | null> {
  return env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), now())
    .first<User>();
}

async function userProjects(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.slug, p.name
       FROM user_projects up JOIN projects p ON p.id = up.project_id
      WHERE up.user_id = ? ORDER BY p.name`,
  )
    .bind(userId)
    .all<{ id: string; slug: string; name: string }>();
  return results;
}

async function ticketMessages(env: Env, ticketId: number, includeInternal: boolean) {
  const { results } = await env.DB.prepare(
    `SELECT id, author, body, internal, created_at
       FROM ticket_messages
      WHERE ticket_id = ? ${includeInternal ? '' : 'AND internal = 0'}
      ORDER BY id`,
  )
    .bind(ticketId)
    .all();
  return results;
}

const TICKET_COLUMNS = `t.id, t.title, t.status, t.created_at, t.updated_at,
  t.project_id, p.name AS project_name, p.slug AS project_slug,
  t.attention, t.human_seconds, t.ai_micro_usd, t.budget_cents, t.price_cents`;

/* —— pricing (src/lib/pricing.js): measured time × rate + AI at cost —— */

const MAX_BUDGET_CENTS = 10_000_00;
const MAX_TIME_STEP_SECONDS = 15 * 60; // one heartbeat from the admin view can't add more
const MAX_HUMAN_SECONDS = 400 * 3600;

type Meter = { human_seconds: number; ai_micro_usd: number };
const meter = (t: Meter) => ({ humanSeconds: t.human_seconds, aiMicroUsd: t.ai_micro_usd });

function cleanAttention(value: unknown): string | null {
  return typeof value === 'string' && ATTENTION_KEYS.includes(value) ? value : null;
}

/** A client's optional ceiling, in whole cents. null clears it; undefined = not sent. */
function cleanBudget(value: unknown): number | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_BUDGET_CENTS ? value : false;
}

/* ——————————————————————— app ——————————————————————— */

export const portal = new Hono<PortalEnv>();

// Every portal route is browser-facing: refuse foreign origins up front.
portal.use('*', async (c, next) => {
  const o = origin(c);
  const path = new URL(c.req.url).pathname;
  // This app is mounted at '/', so this middleware sees every request. The
  // origin allow-list and the preflight shortcut are only correct for the
  // portal's own token-bearing routes: /kb is a public API (wildcard CORS) and
  // /mcp validates Origin itself as the MCP spec's rebinding guard requires.
  const isPortalPath =
    path.startsWith('/auth/') || path.startsWith('/portal/') || path.startsWith('/admin/');

  if (isPortalPath) {
    if (o && !ALLOWED_ORIGINS.includes(o)) return reply(c, { error: 'origin_not_allowed' }, 403);

    // Preflight must be answered before the auth guards below. A 401 to OPTIONS
    // is a CORS failure, not an auth failure: the browser then refuses the real
    // request, so every signed-in page silently breaks and looks like a dead
    // session.
    if (c.req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(o) });
    }
  }

  return next();
});

/* —— auth —— */

portal.post('/auth/request', async (c) => {
  const env = c.env;
  const body = await readJson<{ email?: unknown; turnstileToken?: unknown }>(c);
  const email = cleanEmail(body?.email);
  if (!email) return reply(c, { error: 'bad_email' }, 400);

  const ip = clientIp(c.req.raw);
  if (
    (await isRateLimited(env, ip, 'auth-ip', AUTH_IP_LIMIT, AUTH_WINDOW_SECONDS)) ||
    (await isRateLimited(env, email, 'auth-email', AUTH_EMAIL_LIMIT, AUTH_WINDOW_SECONDS))
  ) {
    return reply(c, { error: 'rate_limited' }, 429);
  }
  const turnstileToken = typeof body?.turnstileToken === 'string' ? body.turnstileToken : undefined;
  if (!(await verifyTurnstile(env, turnstileToken, ip))) {
    return reply(c, { error: 'turnstile_failed' }, 403);
  }

  const token = randomToken();
  await env.DB.prepare('INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), email, now() + LINK_TTL_SECONDS)
    .run();

  // Fragment, not query: the token never reaches a server log or a Referer.
  const link = `${siteUrl(env)}/portal/verify#token=${token}`;
  const sent = await mailClient(env, email, {
    subject: 'Your sign-in link for malipetek.dev',
    text:
      `Here's your sign-in link for Ali's client portal:\n\n${link}\n\n` +
      `It works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`,
  });

  // Same answer whether or not the address has an account — no enumeration.
  if (env.DEV_RETURN_LINK === '1') return reply(c, { ok: true, sent, devLink: link });
  if (!sent) return reply(c, { error: 'mail_failed' }, 502);
  return reply(c, { ok: true });
});

portal.post('/auth/verify', async (c) => {
  const env = c.env;
  const body = await readJson<{ token?: unknown }>(c);
  const token = typeof body?.token === 'string' ? body.token : '';
  if (!token || token.length > 100) return reply(c, { error: 'bad_token' }, 400);

  // Single use: claim the token atomically, then read who it was for.
  const hash = await sha256(token);
  const claimed = await env.DB.prepare(
    `UPDATE login_tokens SET used_at = ?
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
      RETURNING email`,
  )
    .bind(now(), hash, now())
    .first<{ email: string }>();
  if (!claimed) return reply(c, { error: 'link_expired' }, 401);

  const email = claimed.email;
  const role = email === (env.ADMIN_EMAIL || '').toLowerCase() ? 'admin' : 'client';
  await env.DB.prepare(
    `INSERT INTO users (id, email, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET role = excluded.role`,
  )
    .bind(crypto.randomUUID(), email, role, now())
    .run();
  const user = await env.DB.prepare('SELECT id, email, name, role FROM users WHERE email = ?')
    .bind(email)
    .first<User>();
  if (!user) return reply(c, { error: 'user_missing' }, 500);

  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(session), user.id, now() + SESSION_TTL_SECONDS, now()),
    // Housekeeping while we're here.
    env.DB.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now() - 86400),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()),
  ]);

  return reply(c, { session, user });
});

/* —— session guard —— */

const requireUser = async (c: Ctx, next: () => Promise<void>) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = token ? await sessionUser(c.env, token) : null;
  if (!user) return reply(c, { error: 'unauthorized' }, 401);
  c.set('user', user);
  return next();
};

const requireAdmin = async (c: Ctx, next: () => Promise<void>) => {
  if (c.get('user').role !== 'admin') return reply(c, { error: 'forbidden' }, 403);
  return next();
};

portal.use('/auth/logout', requireUser);
portal.use('/portal/*', requireUser);
portal.use('/admin/*', requireUser, requireAdmin);

portal.post('/auth/logout', async (c) => {
  const token = (c.req.header('authorization') ?? '').slice(7);
  await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return reply(c, { ok: true });
});

/* —— client —— */

portal.get('/portal/me', async (c) => {
  const user = c.get('user');
  return reply(c, { user, projects: await userProjects(c.env, user.id) });
});

portal.patch('/portal/me', async (c) => {
  const body = await readJson<{ name?: unknown }>(c);
  const name = body?.name === '' ? null : cleanText(body?.name, MAX_NAME_CHARS);
  if (name === null && body?.name !== '') return reply(c, { error: 'bad_name' }, 400);
  await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, c.get('user').id).run();
  return reply(c, { ok: true });
});

portal.get('/portal/tickets', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${TICKET_COLUMNS}
       FROM tickets t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.user_id = ? ORDER BY t.updated_at DESC`,
  )
    .bind(c.get('user').id)
    .all();
  return reply(c, { tickets: results });
});

portal.post('/portal/tickets', async (c) => {
  const env = c.env;
  const user = c.get('user');
  const body = await readJson<{ title?: unknown; body?: unknown; projectId?: unknown; attention?: unknown; budgetCents?: unknown }>(c);
  const title = cleanText(body?.title, MAX_TITLE_CHARS);
  const text = cleanText(body?.body, MAX_BODY_CHARS);
  if (!title || !text) return reply(c, { error: 'bad_ticket' }, 400);
  const attention = body?.attention === undefined ? DEFAULT_ATTENTION : cleanAttention(body.attention);
  const budget = cleanBudget(body?.budgetCents);
  if (!attention || budget === false) return reply(c, { error: 'bad_ticket' }, 400);

  // A client can only file against a project Ali linked them to.
  let projectId: string | null = null;
  if (typeof body?.projectId === 'string' && body.projectId) {
    const linked = await env.DB.prepare('SELECT 1 FROM user_projects WHERE user_id = ? AND project_id = ?')
      .bind(user.id, body.projectId)
      .first();
    if (!linked) return reply(c, { error: 'bad_project' }, 400);
    projectId = body.projectId;
  }

  if (await isRateLimited(env, user.id, 'ticket', TICKET_LIMIT, TICKET_WINDOW_SECONDS)) {
    return reply(c, { error: 'rate_limited' }, 429);
  }

  const t = now();
  const ticket = await env.DB.prepare(
    `INSERT INTO tickets (user_id, project_id, title, status, attention, budget_cents, created_at, updated_at)
     VALUES (?, ?, ?, 'new', ?, ?, ?, ?) RETURNING id`,
  )
    .bind(user.id, projectId, title, attention, budget ?? null, t, t)
    .first<{ id: number }>();
  if (!ticket) return reply(c, { error: 'insert_failed' }, 500);
  await env.DB.prepare(
    `INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'client', ?, ?)`,
  )
    .bind(ticket.id, text, t)
    .run();

  const ref = { id: ticket.id, title, client_email: user.email };
  c.executionCtx.waitUntil(
    Promise.all([notifyAliOfClientMessage(env, ref, text, true), confirmTicketToClient(env, ref)]),
  );
  return reply(c, { id: ticket.id }, 201);
});

/** Load a ticket the caller may see: their own, or any ticket for the admin. */
async function loadTicket(c: Ctx, admin: boolean) {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return null;
  const ticket = await c.env.DB.prepare(
    `SELECT ${TICKET_COLUMNS}, t.user_id, u.email AS client_email, u.name AS client_name
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
       JOIN users u ON u.id = t.user_id
      WHERE t.id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown> & Meter & { id: number; user_id: string; client_email: string; title: string; status: Status; attention: string }>();
  if (!ticket) return null;
  if (!admin && ticket.user_id !== c.get('user').id) return null;
  return ticket;
}

portal.get('/portal/tickets/:id', async (c) => {
  const ticket = await loadTicket(c, false);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  const { user_id: _, client_email: __, ...visible } = ticket;
  return reply(c, { ticket: visible, messages: await ticketMessages(c.env, ticket.id, false) });
});

portal.post('/portal/tickets/:id/messages', async (c) => {
  const env = c.env;
  const ticket = await loadTicket(c, false);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  const body = await readJson<{ body?: unknown }>(c);
  const text = cleanText(body?.body, MAX_BODY_CHARS);
  if (!text) return reply(c, { error: 'bad_message' }, 400);

  const t = now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'client', ?, ?)`)
      .bind(ticket.id, text, t),
    env.DB.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').bind(t, ticket.id),
  ]);
  c.executionCtx.waitUntil(notifyAliOfClientMessage(env, ticket, text, false));
  return reply(c, { ok: true }, 201);
});

/* —— admin —— */

portal.get('/admin/tickets', async (c) => {
  const status = c.req.query('status');
  const filter = status && (STATUSES as readonly string[]).includes(status) ? status : null;
  const { results } = await c.env.DB.prepare(
    `SELECT ${TICKET_COLUMNS}, u.email AS client_email, u.name AS client_name
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
       JOIN users u ON u.id = t.user_id
      ${filter ? 'WHERE t.status = ?' : ''}
      ORDER BY (t.status = 'new') DESC, t.updated_at DESC
      LIMIT 200`,
  )
    .bind(...(filter ? [filter] : []))
    .all();
  return reply(c, { tickets: results });
});

portal.get('/admin/tickets/:id', async (c) => {
  const ticket = await loadTicket(c, true);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  return reply(c, {
    ticket,
    messages: await ticketMessages(c.env, ticket.id, true),
    runs: await ticketRuns(c.env, ticket.id),
  });
});

portal.patch('/admin/tickets/:id', async (c) => {
  const env = c.env;
  const ticket = await loadTicket(c, true);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  const body = await readJson<{ status?: unknown; projectId?: unknown; attention?: unknown; humanSeconds?: unknown }>(c);

  const attention = body?.attention === undefined ? undefined : cleanAttention(body.attention);
  if (attention === null) return reply(c, { error: 'bad_attention' }, 400);
  // A correction to the meter (the tracker missed an email reply, or ran on a coffee break).
  let humanSeconds: number | undefined;
  if (body?.humanSeconds !== undefined) {
    if (typeof body.humanSeconds !== 'number' || !Number.isInteger(body.humanSeconds) || body.humanSeconds < 0 || body.humanSeconds > MAX_HUMAN_SECONDS) {
      return reply(c, { error: 'bad_time' }, 400);
    }
    humanSeconds = body.humanSeconds;
  }

  const status =
    typeof body?.status === 'string' && (STATUSES as readonly string[]).includes(body.status)
      ? (body.status as Status)
      : null;
  if (body?.status !== undefined && !status) return reply(c, { error: 'bad_status' }, 400);

  let projectId: string | null | undefined;
  if (body?.projectId !== undefined) {
    if (body.projectId === null || body.projectId === '') projectId = null;
    else if (typeof body.projectId === 'string') {
      const exists = await env.DB.prepare('SELECT 1 FROM projects WHERE id = ?').bind(body.projectId).first();
      if (!exists) return reply(c, { error: 'bad_project' }, 400);
      projectId = body.projectId;
    } else return reply(c, { error: 'bad_project' }, 400);
  }

  const t = now();
  const statements = [];
  if (projectId !== undefined) {
    statements.push(env.DB.prepare('UPDATE tickets SET project_id = ?, updated_at = ? WHERE id = ?').bind(projectId, t, ticket.id));
  }
  if (attention) {
    statements.push(env.DB.prepare('UPDATE tickets SET attention = ?, updated_at = ? WHERE id = ?').bind(attention, t, ticket.id));
  }
  if (humanSeconds !== undefined) {
    statements.push(env.DB.prepare('UPDATE tickets SET human_seconds = ?, updated_at = ? WHERE id = ?').bind(humanSeconds, t, ticket.id));
  }
  const statusChanged = status && status !== ticket.status;
  // Done freezes the bill at what the meter reads now; reopening unfreezes it.
  const finalMeter = { humanSeconds: humanSeconds ?? ticket.human_seconds, aiMicroUsd: ticket.ai_micro_usd };
  const bill = statusChanged && status === 'done' ? priceLine(finalMeter) : undefined;
  if (statusChanged) {
    statements.push(
      env.DB.prepare('UPDATE tickets SET status = ?, price_cents = ?, updated_at = ? WHERE id = ?')
        .bind(status, status === 'done' ? priceOf(finalMeter).totalCents : null, t, ticket.id),
      env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'system', ?, ?)`)
        .bind(ticket.id, `Status changed to “${STATUS_LABEL[status]}”.${bill ? ` Total: ${bill}.` : ''}`, t),
    );
  }
  if (statements.length) await env.DB.batch(statements);

  if (statusChanged) c.executionCtx.waitUntil(notifyClientOfStatus(env, ticket, status, bill));
  return reply(c, { ok: true });
});

/*
 * The time meter. The admin ticket view sends a heartbeat with the seconds
 * Ali had it open and focused; they add up to human_seconds. A finished
 * ticket's meter is closed — correct it with PATCH humanSeconds if needed.
 */
portal.post('/admin/tickets/:id/time', async (c) => {
  const ticket = await loadTicket(c, true);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  const body = await readJson<{ seconds?: unknown }>(c);
  const seconds = body?.seconds;
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds <= 0 || seconds > MAX_TIME_STEP_SECONDS) {
    return reply(c, { error: 'bad_time' }, 400);
  }
  if (ticket.status === 'done' || ticket.status === 'declined') return reply(c, { error: 'meter_closed' }, 409);
  const row = await c.env.DB.prepare(
    'UPDATE tickets SET human_seconds = MIN(human_seconds + ?, ?) WHERE id = ? RETURNING human_seconds',
  )
    .bind(seconds, MAX_HUMAN_SECONDS, ticket.id)
    .first<{ human_seconds: number }>();
  return reply(c, { humanSeconds: row?.human_seconds ?? ticket.human_seconds });
});

portal.post('/admin/tickets/:id/messages', async (c) => {
  const env = c.env;
  const ticket = await loadTicket(c, true);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  const body = await readJson<{ body?: unknown; internal?: unknown }>(c);
  const text = cleanText(body?.body, MAX_BODY_CHARS);
  if (!text) return reply(c, { error: 'bad_message' }, 400);
  const internal = body?.internal === true;

  const t = now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'ali', ?, ?, ?)`)
      .bind(ticket.id, text, internal ? 1 : 0, t),
    env.DB.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').bind(t, ticket.id),
  ]);
  if (!internal) c.executionCtx.waitUntil(notifyClientOfReply(env, ticket, text));
  return reply(c, { ok: true }, 201);
});

/* —— agentic runs: the same transitions the local runner uses, driven by an
   admin session so the Harness can claim and report without a second secret —— */

portal.post('/admin/tickets/:id/claim', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return reply(c, { error: 'not_found' }, 404);
  const body = await readJson<{ executor?: unknown; model?: unknown }>(c);

  const result = await claimTicketById(c.env, id, { executor: body?.executor, model: body?.model });
  if (!result.ok) {
    // `not_claimable` means somebody else has it, or it was never approved.
    return reply(c, { error: result.error }, result.error === 'not_found' ? 404 : 409);
  }
  return reply(c, {
    ticket: result.claimed.ticket,
    messages: result.claimed.messages,
    runId: result.claimed.runId,
    executor: result.claimed.executor,
    model: result.claimed.model,
  });
});

portal.post('/admin/tickets/:id/run-result', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return reply(c, { error: 'not_found' }, 404);

  const body = await readJson<Record<string, unknown>>(c);
  const report = normalizeReport(body, 'dsh');
  const done = await finishRun(c.env, id, report);
  if (!done.ok) return reply(c, { error: done.error }, done.error === 'not_found' ? 404 : 409);

  c.executionCtx.waitUntil(
    mailAli(c.env, {
      subject: `[#${id}] ${report.executor} ${report.ok ? 'finished' : 'failed'}: ${done.title}`,
      text:
        `${report.summary}\n\n${report.diffStat ? `${report.diffStat}\n\n` : ''}` +
        `${report.branch ? `Branch: ${report.branch} (local only, nothing pushed)\n` : ''}` +
        `Cost: $${report.costUsd.toFixed(4)}${report.model ? ` · ${report.model}` : ''}\n` +
        `Review: ${siteUrl(c.env)}/portal/admin#ticket=${id}`,
    }),
  );
  return reply(c, { ok: true, costMicroUsd: done.costMicroUsd });
});

/** The fleet: what is running now, and what ran recently. */
portal.get('/admin/runs', async (c) => {
  const [running, recent] = await Promise.all([openRuns(c.env), recentRuns(c.env, 40)]);
  return reply(c, { running, recent });
});

portal.get('/admin/clients', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.created_at,
            (SELECT group_concat(project_id) FROM user_projects WHERE user_id = u.id) AS project_ids,
            (SELECT count(*) FROM tickets WHERE user_id = u.id) AS ticket_count
       FROM users u ORDER BY u.created_at DESC`,
  ).all<Record<string, unknown> & { project_ids: string | null }>();
  return reply(c, {
    clients: results.map(({ project_ids, ...rest }) => ({
      ...rest,
      projectIds: project_ids ? project_ids.split(',') : [],
    })),
  });
});

portal.get('/admin/projects', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, slug, name, created_at FROM projects ORDER BY name').all();
  return reply(c, { projects: results });
});

portal.post('/admin/projects', async (c) => {
  const body = await readJson<{ name?: unknown; slug?: unknown }>(c);
  const name = cleanText(body?.name, MAX_NAME_CHARS);
  const slug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  // The slug is what the local runner maps to a folder — keep it path-safe.
  if (!name || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return reply(c, { error: 'bad_project' }, 400);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare('INSERT INTO projects (id, slug, name, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, slug, name, now())
      .run();
  } catch {
    return reply(c, { error: 'slug_taken' }, 409);
  }
  return reply(c, { id, slug, name }, 201);
});

portal.put('/admin/clients/:userId/projects/:projectId', async (c) => {
  const { userId, projectId } = c.req.param();
  try {
    await c.env.DB.prepare('INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)')
      .bind(userId, projectId)
      .run();
  } catch {
    return reply(c, { error: 'not_found' }, 404); // FK violation: unknown user or project
  }
  return reply(c, { ok: true });
});

portal.delete('/admin/clients/:userId/projects/:projectId', async (c) => {
  const { userId, projectId } = c.req.param();
  await c.env.DB.prepare('DELETE FROM user_projects WHERE user_id = ? AND project_id = ?')
    .bind(userId, projectId)
    .run();
  return reply(c, { ok: true });
});
