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
 *   GET  /portal/tickets/:id              ticket + public messages (with their files)
 *   POST /portal/tickets/:id/messages     { body }, or multipart: body + files
 *   GET  /portal/tickets/:id/files/:fileId
 *   POST /portal/tickets/:id/withdraw     only while new and nothing has run
 *
 *   Admin role only (ADMIN_EMAIL signs in as admin):
 *   GET   /admin/tickets?status=
 *   GET   /admin/tickets/:id              includes internal notes
 *   PATCH /admin/tickets/:id              { status?, projectId? }
 *   POST  /admin/tickets/:id/messages     { body, internal? }, or multipart with files
 *   POST  /admin/tickets/:id/answered     "no reply needed"
 *   GET   /admin/tickets/:id/files/:fileId
 *   GET   /admin/runs/:id/session        a run's Harness session log (zstd JSONL)
 *   GET   /admin/clients
 *   GET   /admin/projects   POST /admin/projects { name, slug }
 *   PUT / DELETE /admin/clients/:userId/projects/:projectId
 *
 * Approval is a status change only Ali can make; nothing in this file runs
 * work on a ticket. Sessions are opaque random tokens; only their SHA-256
 * lives in D1, same for magic-link tokens.
 */
import { Hono, type Context } from 'hono';
import { ATTENTION_KEYS, DEFAULT_ATTENTION, money, priceLine, priceOf } from '../../src/lib/pricing.js';
import { claimTicketById, finishRun, normalizeReport, openRuns, recentRuns, sessionKey, ticketRuns } from './runs.ts';
import { readSteps } from './steps.ts';
import {
  CAPABILITY_CATALOG,
  CLIENT_EXECUTOR,
  cleanExecutorPin,
  cleanList,
  cleanOverrides,
  EXECUTOR_CATALOG,
  getSettings,
  nodesView,
  queueView,
  saveSettings,
  type NodeOverrides,
} from './queue.ts';
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
import {
  briefText,
  cleanBrief,
  cleanRepo,
  isProjectKind,
  isRepoKind,
  onlineSlugs,
  parseBrief,
  setupFor,
  uniqueSlug,
} from './setup.ts';
import {
  advanceSite,
  getSite,
  listDeploys,
  publishSite,
  rollbackSite,
  siteState,
  siteView,
  startSite,
  workspaceFor,
  workspaceRead,
  type SiteRow,
} from './sites.ts';
import { checkUploads, fileCount, fileResponse, FILE_LIMITS, sizeText, storeFiles, withFiles, type FileMeta, type Upload } from './files.ts';

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
/** Client messages per user per hour: each one mails Ali, and may carry files. */
const MESSAGE_LIMIT = 60;

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
  /** How finished work reaches them: 'preview' (a link and Publish) or 'pull_request'. */
  handoff?: 'preview' | 'pull_request';
}

/** `viaAgent`: the caller used an agent token (agent_tokens), not a browser session. */
type PortalEnv = HonoEnv & { Variables: { user: User; viaAgent: boolean } };
type Ctx = Context<PortalEnv>;

/* ——————————————————————— helpers ——————————————————————— */

export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256(value: string): Promise<string> {
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

/**
 * A message as sent: JSON `{ body, internal? }`, or multipart form data with a
 * `body` field and up to FILE_LIMITS.perMessage `files`. Other form fields come
 * back in `fields` as strings. 'too_large' when the request cannot fit.
 */
type IncomingMessage = { text: string; internal: boolean; fields: Record<string, unknown>; files: { name: string; data: ArrayBuffer }[] };

async function readMessage(c: Ctx): Promise<IncomingMessage | 'too_large' | null> {
  const type = c.req.header('content-type') ?? '';
  if (!type.startsWith('multipart/form-data')) {
    const body = await readJson<Record<string, unknown>>(c);
    if (!body) return null;
    return { text: typeof body.body === 'string' ? body.body.trim() : '', internal: body.internal === true, fields: body, files: [] };
  }
  const length = Number(c.req.header('content-length') ?? 0);
  if (length > FILE_LIMITS.perMessage * FILE_LIMITS.bytes + 256 * 1024) return 'too_large';
  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    return null;
  }
  const fields: Record<string, string> = {};
  const files: IncomingMessage['files'] = [];
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') fields[key] = value;
    else if (key === 'files' && value.size > 0) files.push({ name: value.name, data: await value.arrayBuffer() });
  }
  return { text: (fields.body ?? '').trim(), internal: fields.internal === 'true', fields, files };
}

/** Validate a message's files for a ticket; the error is the reply to send. */
async function messageUploads(c: Ctx, ticketId: number | null, files: IncomingMessage['files']) {
  if (!files.length) return { uploads: [] as Upload[] };
  if (!c.env.FILES) return { error: reply(c, { error: 'files_unavailable' }, 503) };
  const checked = checkUploads(files, ticketId === null ? 0 : await fileCount(c.env, ticketId));
  if (!checked.ok) return { error: reply(c, { error: checked.error, name: checked.name }, checked.error === 'file_too_large' ? 413 : 400) };
  return { uploads: checked.uploads };
}

/**
 * Insert a message and its files. The message goes first (a file needs its id);
 * the bytes then go to R2 and the rows after them.
 */
export async function postMessage(
  env: Env,
  ticketId: number,
  author: 'client' | 'ali',
  text: string,
  internal: boolean,
  uploads: Upload[],
  t: number,
): Promise<FileMeta[]> {
  const row = await env.DB.prepare(
    `INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(ticketId, author, text, internal ? 1 : 0, t)
    .first<{ id: number }>();
  if (!row) throw new Error('message insert failed');
  return storeFiles(env, ticketId, row.id, uploads);
}

/** The text a notification carries: the message, then what came with it. */
export function withAttachmentLine(text: string, files: { name: string; size: number }[]): string {
  if (!files.length) return text;
  const line = `Attached: ${files.map((f) => `${f.name} (${sizeText(f.size)})`).join(', ')}`;
  return text ? `${text}\n\n${line}` : line;
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

/** Agent tokens start with this, so a caller (and a leaked-secret scanner) can tell them apart. */
export const AGENT_TOKEN_PREFIX = 'cat_';
export const MAX_AGENT_TOKENS = 5;

/**
 * The client an agent token acts for. Revoked tokens and admins resolve to
 * nothing: an agent token is a client credential, whoever minted it.
 */
export async function agentUser(env: Env, token: string): Promise<User | null> {
  if (!token.startsWith(AGENT_TOKEN_PREFIX) || token.length > 200) return null;
  const hash = await sha256(token);
  const user = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.handoff
       FROM agent_tokens a JOIN users u ON u.id = a.user_id
      WHERE a.token_hash = ? AND a.revoked_at IS NULL AND u.role = 'client'`,
  )
    .bind(hash)
    .first<User>();
  if (user) {
    await env.DB.prepare('UPDATE agent_tokens SET last_used_at = ? WHERE token_hash = ?').bind(now(), hash).run();
  }
  return user;
}

export async function sessionUser(env: Env, token: string): Promise<User | null> {
  return env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.handoff
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), now())
    .first<User>();
}

/** A project row, with the onboarding columns the portal needs to describe it. */
type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  brief: string;
  repo: string | null;
  repo_kind: string;
  created_by: string | null;
  created_at: number;
};

async function userProjects(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.kind, p.brief, p.repo, p.repo_kind, p.created_by, p.created_at
       FROM user_projects up JOIN projects p ON p.id = up.project_id
      WHERE up.user_id = ? ORDER BY p.name`,
  )
    .bind(userId)
    .all<ProjectRow>();
  return results;
}

/**
 * What an account has cost, until there is a payment system to charge it.
 * `billed` is the frozen price of Done tickets; `open` is the live meter on
 * unfinished ones; `aiCents` is the AI share of both, at cost. Declined tickets
 * count nowhere: nothing is owed for them.
 */
export interface Usage {
  billedCents: number;
  openCents: number;
  aiCents: number;
  tickets: number;
}

type UsageRow = { user_id: string; status: string; human_seconds: number; ai_micro_usd: number; price_cents: number | null };

function addUsage(usage: Usage, row: UsageRow): Usage {
  if (row.status === 'declined') return usage;
  const p = priceOf(meter(row));
  return {
    billedCents: usage.billedCents + (row.status === 'done' ? (row.price_cents ?? p.totalCents) : 0),
    openCents: usage.openCents + (row.status === 'done' ? 0 : p.totalCents),
    aiCents: usage.aiCents + p.aiCents,
    tickets: usage.tickets + 1,
  };
}

const NO_USAGE: Usage = { billedCents: 0, openCents: 0, aiCents: 0, tickets: 0 };

/** Usage per user id; one query for every account, or just one. */
async function usageByUser(env: Env, userId?: string): Promise<Map<string, Usage>> {
  const { results } = await env.DB.prepare(
    `SELECT user_id, status, human_seconds, ai_micro_usd, price_cents FROM tickets WHERE kind = 'client'${userId ? ' AND user_id = ?' : ''}`,
  )
    .bind(...(userId ? [userId] : []))
    .all<UsageRow>();
  const out = new Map<string, Usage>();
  for (const row of results ?? []) out.set(row.user_id, addUsage(out.get(row.user_id) ?? NO_USAGE, row));
  return out;
}

/** Hosted sites by project id, for the views that list projects. */
async function sitesById(env: Env): Promise<Map<string, SiteRow>> {
  const { results } = await env.DB.prepare('SELECT * FROM sites').all<SiteRow>();
  return new Map((results ?? []).map((row) => [row.project_id, row]));
}

async function ticketMessages(env: Env, ticketId: number, includeInternal: boolean) {
  const { results } = await env.DB.prepare(
    `SELECT id, author, body, internal, created_at
       FROM ticket_messages
      WHERE ticket_id = ? ${includeInternal ? '' : 'AND internal = 0'}
      ORDER BY id`,
  )
    .bind(ticketId)
    .all<{ id: number; author: string; body: string; internal: number; created_at: number }>();
  return results ?? [];
}

/**
 * A client message on a filed ticket: Ali owes an answer from now, unless he
 * already owed one (the oldest unanswered message is the one that matters).
 * Binds: updated_at, waiting since, ticket id.
 */
export const WAITING_SQL =
  'UPDATE tickets SET updated_at = ?, client_waiting_since = COALESCE(client_waiting_since, ?) WHERE id = ?';

const TICKET_COLUMNS = `t.id, t.title, t.status, t.created_at, t.updated_at, t.client_waiting_since,
  t.project_id, p.name AS project_name, p.slug AS project_slug,
  t.attention, t.human_seconds, t.ai_micro_usd, t.budget_cents, t.price_cents,
  t.kind, t.source, t.priority, t.requires, t.executor, t.worked_by`;

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

const MAX_PRIORITY = 100;

/**
 * Routing fields an admin may set on a work item. Each is undefined when not
 * sent. Client work may not pin an executor other than the sandboxed one.
 */
function cleanRouting(
  body: { priority?: unknown; requires?: unknown; executor?: unknown },
  isClient: boolean,
):
  | { ok: true; priority?: number; requires?: string[]; executor?: string | null }
  | { ok: false; error: string } {
  const out: { ok: true; priority?: number; requires?: string[]; executor?: string | null } = { ok: true };
  if (body.priority !== undefined) {
    if (typeof body.priority !== 'number' || !Number.isInteger(body.priority) || Math.abs(body.priority) > MAX_PRIORITY) {
      return { ok: false, error: 'bad_priority' };
    }
    out.priority = body.priority;
  }
  if (body.requires !== undefined) {
    if (!Array.isArray(body.requires)) return { ok: false, error: 'bad_requires' };
    out.requires = cleanList(body.requires);
  }
  if (body.executor !== undefined) {
    const pin = cleanExecutorPin(body.executor);
    if (pin === undefined) return { ok: false, error: 'bad_executor' };
    if (isClient && pin !== null && pin !== CLIENT_EXECUTOR) return { ok: false, error: 'client_executor' };
    out.executor = pin;
  }
  return out;
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

/*
 * Reviewer demo sign-in: a fixed sample-data account behind a shared code,
 * for app-store reviewers who cannot receive a magic link. Disabled unless
 * both secrets are set.
 */
portal.post('/auth/demo', async (c) => {
  const env = c.env;
  if (!env.DEMO_EMAIL || !env.DEMO_LOGIN_CODE) return reply(c, { error: 'not_found' }, 404);

  const body = await readJson<{ email?: unknown; code?: unknown }>(c);
  const email = cleanEmail(body?.email);
  const code = typeof body?.code === 'string' ? body.code : '';

  const ip = clientIp(c.req.raw);
  if (await isRateLimited(env, ip, 'auth-ip', AUTH_IP_LIMIT, AUTH_WINDOW_SECONDS)) {
    return reply(c, { error: 'rate_limited' }, 429);
  }

  const user = email
    ? await env.DB.prepare('SELECT id, email, name, role FROM users WHERE email = ?').bind(email).first<User>()
    : null;
  // Same answer either way — no hint about which half failed.
  if (!user || email !== env.DEMO_EMAIL.toLowerCase() || code !== env.DEMO_LOGIN_CODE || user.role !== 'client') {
    return reply(c, { error: 'unauthorized' }, 401);
  }

  const session = randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(session), user.id, now() + SESSION_TTL_SECONDS, now())
    .run();
  return reply(c, { session, user });
});

/* —— session guard —— */

const requireUser = async (c: Ctx, next: () => Promise<void>) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const viaAgent = token.startsWith(AGENT_TOKEN_PREFIX);
  const user = !token ? null : viaAgent ? await agentUser(c.env, token) : await sessionUser(c.env, token);
  if (!user) return reply(c, { error: 'unauthorized' }, 401);
  c.set('user', user);
  c.set('viaAgent', viaAgent);
  return next();
};

// An agent token is a client credential: it never reaches the admin routes.
const requireAdmin = async (c: Ctx, next: () => Promise<void>) => {
  if (c.get('viaAgent') || c.get('user').role !== 'admin') return reply(c, { error: 'forbidden' }, 403);
  return next();
};

/** Token management needs the person, in a browser — not an agent holding a token. */
const requireBrowser = async (c: Ctx, next: () => Promise<void>) => {
  if (c.get('viaAgent')) return reply(c, { error: 'forbidden' }, 403);
  return next();
};

portal.use('/auth/logout', requireUser, requireBrowser);
// Cloudflare's OAuth redirect carries no session; its signed state says whose it is (cfconnect.ts).
portal.use('/portal/*', (c, next) => (c.req.path === '/portal/cloudflare/callback' ? next() : requireUser(c, next)));
portal.use('/portal/agent-tokens', requireBrowser);
portal.use('/portal/agent-tokens/*', requireBrowser);
portal.use('/admin/*', requireUser, requireAdmin);

portal.post('/auth/logout', async (c) => {
  const token = (c.req.header('authorization') ?? '').slice(7);
  await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return reply(c, { ok: true });
});

/* —— client —— */

portal.get('/portal/me', async (c) => {
  const user = c.get('user');
  const env = c.env;
  const [projects, slugs, counts, sites, settings, usage] = await Promise.all([
    userProjects(env, user.id),
    onlineSlugs(env),
    env.DB.prepare(
      `SELECT project_id, count(*) AS n FROM tickets
        WHERE user_id = ? AND project_id IS NOT NULL GROUP BY project_id`,
    )
      .bind(user.id)
      .all<{ project_id: string; n: number }>(),
    sitesById(env),
    getSettings(env),
    usageByUser(env, user.id),
  ]);
  const filed = new Map((counts.results ?? []).map((row) => [row.project_id, row.n]));

  return reply(c, {
    user,
    canPublish: settings.clientPublish,
    usage: usage.get(user.id) ?? NO_USAGE,
    projects: (projects ?? []).map((project) => {
      const kind = isProjectKind(project.kind) ? project.kind : 'existing';
      const repoKind = isRepoKind(project.repo_kind) ? project.repo_kind : 'none';
      const site = siteView(sites.get(project.id), settings.sitesDomain);
      return {
        id: project.id,
        slug: project.slug,
        name: project.name,
        kind,
        repoKind,
        repo: project.repo,
        site,
        setup: setupFor({
          kind,
          brief: parseBrief(project.brief),
          repoKind,
          repo: project.repo,
          slug: project.slug,
          onlineSlugs: slugs,
          ticketCount: filed.get(project.id) ?? 0,
          clientCreated: project.created_by !== null,
          site,
        }),
      };
    }),
  });
});

portal.patch('/portal/me', async (c) => {
  const body = await readJson<{ name?: unknown }>(c);
  const name = body?.name === '' ? null : cleanText(body?.name, MAX_NAME_CHARS);
  if (name === null && body?.name !== '') return reply(c, { error: 'bad_name' }, 400);
  await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, c.get('user').id).run();
  return reply(c, { ok: true });
});

/* —— agent tokens: a client connects an AI assistant —— */

portal.get('/portal/agent-tokens', async (c) => {
  const { results } = await c.env.DB.prepare(
    // `via`: the app that connected through OAuth (ChatGPT, …), null for a key made here.
    `SELECT t.id, t.label, t.created_at, t.last_used_at, o.client_name AS via
       FROM agent_tokens t LEFT JOIN oauth_clients o ON o.client_id = t.oauth_client_id
      WHERE t.user_id = ? AND t.revoked_at IS NULL ORDER BY t.created_at DESC`,
  )
    .bind(c.get('user').id)
    .all();
  return reply(c, { tokens: results ?? [] });
});

/** Mint a token. It is returned once and stored only as a hash. */
/**
 * Mint an agent token for a client. Returned once; only the hash is kept.
 * An OAuth grant passes its client id: the app's previous token is revoked, so
 * reconnecting replaces rather than piles up.
 */
export async function mintAgentToken(
  env: Env,
  userId: string,
  label: string,
  oauthClientId: string | null = null,
): Promise<{ ok: true; id: number; token: string } | { ok: false; error: string }> {
  const t = now();
  if (oauthClientId) {
    await env.DB.prepare(`UPDATE agent_tokens SET revoked_at = ? WHERE user_id = ? AND oauth_client_id = ? AND revoked_at IS NULL`)
      .bind(t, userId, oauthClientId)
      .run();
  }
  const active = await env.DB.prepare('SELECT count(*) AS n FROM agent_tokens WHERE user_id = ? AND revoked_at IS NULL')
    .bind(userId)
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_AGENT_TOKENS) return { ok: false, error: 'too_many_tokens' };
  const token = `${AGENT_TOKEN_PREFIX}${randomToken()}`;
  const row = await env.DB.prepare(
    `INSERT INTO agent_tokens (user_id, label, token_hash, oauth_client_id, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(userId, label, await sha256(token), oauthClientId, t)
    .first<{ id: number }>();
  return row ? { ok: true, id: row.id, token } : { ok: false, error: 'insert_failed' };
}

/** Mint a token. It is returned once and stored only as a hash. */
portal.post('/portal/agent-tokens', async (c) => {
  const env = c.env;
  const user = c.get('user');
  if (user.role !== 'client') return reply(c, { error: 'clients_only' }, 400);
  const body = await readJson<{ label?: unknown }>(c);
  const label = cleanText(body?.label, 60);
  if (!label) return reply(c, { error: 'bad_label' }, 400);
  const made = await mintAgentToken(env, user.id, label);
  if (!made.ok) return reply(c, { error: made.error }, made.error === 'too_many_tokens' ? 409 : 500);
  // The canonical address: the site proxies /mcp to this Worker (src/pages/mcp.ts).
  return reply(c, { id: made.id, label, token: made.token, mcpUrl: `${siteUrl(env)}/mcp` }, 201);
});

portal.delete('/portal/agent-tokens/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const done = await c.env.DB.prepare(
    `UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL RETURNING id`,
  )
    .bind(now(), Number.isInteger(id) ? id : -1, c.get('user').id)
    .first();
  return done ? reply(c, { ok: true }) : reply(c, { error: 'not_found' }, 404);
});

/* —— onboarding: a client creates their own project —— */

const MAX_PROJECTS_PER_DAY = 3;

/**
 * Create a project from the interview, and file the first request against it.
 *
 * This is the half of onboarding that used to need Ali: before it, every
 * project came from `POST /admin/projects` plus a hand-written `user_projects`
 * row, and a ticket with no project can never be claimed. The slug is derived
 * here and never supplied, so a client cannot claim a name that another
 * machine's folder already maps to.
 *
 * The last interview answer becomes the first ticket, so the flow ends in a
 * thread that carries the brief rather than a confirmation screen.
 */
portal.post('/portal/projects', async (c) => {
  const env = c.env;
  const user = c.get('user');
  const body = await readJson<{
    kind?: unknown;
    name?: unknown;
    brief?: unknown;
    repoKind?: unknown;
    repo?: unknown;
    attention?: unknown;
    budgetCents?: unknown;
  }>(c);

  const kind = isProjectKind(body?.kind) ? body.kind : null;
  const name = cleanText(body?.name, MAX_NAME_CHARS);
  if (!kind || !name) return reply(c, { error: 'bad_project' }, 400);

  const brief = cleanBrief(body?.brief, kind);
  if (!brief) return reply(c, { error: 'bad_brief' }, 400);

  // Only an existing project names a repo. A new one is created at provisioning.
  const repoKind = kind === 'existing' && isRepoKind(body?.repoKind) ? body.repoKind : 'none';
  const repo = repoKind === 'repo' ? cleanRepo(body?.repo) : null;
  if (repoKind === 'repo' && !repo) return reply(c, { error: 'bad_repo' }, 400);

  const attention = body?.attention === undefined ? DEFAULT_ATTENTION : cleanAttention(body.attention);
  const budget = cleanBudget(body?.budgetCents);
  if (!attention || budget === false) return reply(c, { error: 'bad_ticket' }, 400);

  if (await isRateLimited(env, user.id, 'project', MAX_PROJECTS_PER_DAY, 24 * 60 * 60)) {
    return reply(c, { error: 'rate_limited' }, 429);
  }

  const t = now();
  const id = crypto.randomUUID();
  const slug = await uniqueSlug(env, name);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO projects (id, slug, name, kind, brief, repo, repo_kind, repo_wanted, created_by, onboarded_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        // No repo and no zip coming: a node makes one, so approved work has
        // something to clone.
      ).bind(id, slug, name, kind, JSON.stringify(brief), repo, repoKind, repoKind === 'none' ? 1 : 0, user.id, t, t),
      env.DB.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').bind(user.id, id),
    ]);
  } catch {
    return reply(c, { error: 'slug_taken' }, 409);
  }

  // A "new" project's first request is the build itself; an existing one's is
  // the read-only first look, which is safe to run before any change is agreed.
  const title = (kind === 'new' ? `Build ${name}` : `First look: ${name}`).slice(0, MAX_TITLE_CHARS);
  const text = `Set up from the onboarding form.\n\n${briefText(brief, kind)}`;
  const ticket = await env.DB.prepare(
    `INSERT INTO tickets (user_id, project_id, title, status, attention, budget_cents, created_at, updated_at)
     VALUES (?, ?, ?, 'new', ?, ?, ?, ?) RETURNING id`,
  )
    .bind(user.id, id, title, attention, budget ?? null, t, t)
    .first<{ id: number }>();
  if (!ticket) return reply(c, { error: 'insert_failed' }, 500);

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'client', ?, ?)`).bind(
      ticket.id,
      text,
      t,
    ),
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'system', ?, ?)`).bind(
      ticket.id,
      `Project “${name}” created from the setup form.`,
      t,
    ),
  ]);

  c.executionCtx.waitUntil(
    notifyAliOfClientMessage(env, { id: ticket.id, title, client_email: user.email }, text, true),
  );

  return reply(c, { project: { id, slug, name, kind, repoKind, repo, brief }, ticketId: ticket.id }, 201);
});

/* —— provisioning: the client's own hosted site —— */

const MAX_SITE_STARTS_PER_DAY = 5;

/** The project, when the caller is linked to it. Uniform 404 otherwise. */
async function ownProject(c: Ctx) {
  return c.env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.kind FROM projects p JOIN user_projects up ON up.project_id = p.id
      WHERE p.id = ? AND up.user_id = ?`,
  )
    .bind(c.req.param('id'), c.get('user').id)
    .first<{ id: string; slug: string; name: string; kind: string }>();
}

const siteError = (c: Ctx, error: unknown) => {
  const code = (error as { error?: string })?.error ?? '';
  if (code === 'not_found' || code === 'not_ready' || code === 'unknown_deploy') {
    return reply(c, { error: code }, code === 'unknown_deploy' ? 400 : 409);
  }
  return reply(c, { error: 'site', message: (error as Error)?.message ?? 'The site could not be set up.' }, 502);
};

/**
 * Set up the hosted site for a project we build: a slug on malipetek.online,
 * a placeholder page at once, then a fleet node makes the source repo. Only a
 * "new" project gets one: an existing stack is the client's to bring, with
 * its own credentials.
 */
portal.post('/portal/projects/:id/site', async (c) => {
  const project = await ownProject(c);
  if (!project) return reply(c, { error: 'not_found' }, 404);
  if (project.kind !== 'new') return reply(c, { error: 'not_hosted' }, 400);
  const user = c.get('user');
  if (await isRateLimited(c.env, user.id, 'site', MAX_SITE_STARTS_PER_DAY, 24 * 60 * 60)) {
    return reply(c, { error: 'rate_limited' }, 429);
  }
  try {
    const site = await startSite(c.env, user, project);
    return reply(c, { site: siteView(site) }, 201);
  } catch (error) {
    return siteError(c, error);
  }
});

/** Where the site has got to. Asking moves it forward, at most every few seconds. */
portal.get('/portal/projects/:id/site', async (c) => {
  const project = await ownProject(c);
  if (!project) return reply(c, { error: 'not_found' }, 404);
  const { sitesDomain } = await getSettings(c.env);
  let site = await getSite(c.env, project.id);
  if (site && site.state !== 'ready' && site.state !== 'failed' && now() - site.updated_at >= 4) {
    site = await advanceSite(c.env, project.id);
  }
  return reply(c, { site: siteView(site, sitesDomain) });
});

/**
 * Publish the preview to production, when Ali lets clients do that (the
 * `clientPublish` setting). Off by default: then only Ali publishes.
 */
portal.post('/portal/projects/:id/site/publish', async (c) => {
  const project = await ownProject(c);
  if (!project) return reply(c, { error: 'not_found' }, 404);
  if (!(await getSettings(c.env)).clientPublish) return reply(c, { error: 'forbidden' }, 403);
  try {
    const out = await publishSite(c.env, project.id);
    if ('error' in out) return siteError(c, out);
    c.executionCtx.waitUntil(
      mailAli(c.env, {
        subject: `${project.name} was published by its client`,
        text: `${c.get('user').email} published the preview of ${project.name} to production.\n${out.productionUrl ?? ''}`,
      }),
    );
    return reply(c, { ok: true, productionUrl: out.productionUrl });
  } catch (error) {
    return siteError(c, error);
  }
});

/** Roll production back to an older deploy, when Ali lets clients do that. */
portal.post('/portal/projects/:id/site/rollback', async (c) => {
  const project = await ownProject(c);
  if (!project) return reply(c, { error: 'not_found' }, 404);
  if (!(await getSettings(c.env)).clientPublish) return reply(c, { error: 'forbidden' }, 403);
  const body = await readJson<{ deployId?: unknown }>(c);
  const out = await rollbackSite(c.env, project.id, typeof body?.deployId === 'string' ? body.deployId : '');
  if ('error' in out) return siteError(c, out);
  return reply(c, { ok: true, productionUrl: out.productionUrl });
});

/** The site's deploy history, newest first. */
portal.get('/portal/projects/:id/site/deploys', async (c) => {
  const project = await ownProject(c);
  if (!project) return reply(c, { error: 'not_found' }, 404);
  return reply(c, { deploys: await listDeploys(c.env, project.id) });
});

/* —— the client's own agent: context, workspace, a change, a build —— */

/** The ticket, when it is the caller's own client request. Uniform 404. */
async function ownTicket(c: Ctx) {
  return c.env.DB.prepare(
    `SELECT t.id, t.title, t.status, t.attention, t.worked_by, t.build_requested_at, t.project_id
       FROM tickets t WHERE t.id = ? AND t.user_id = ? AND t.kind = 'client'`,
  )
    .bind(Number(c.req.param('id')) || -1, c.get('user').id)
    .first<{ id: number; title: string; status: string; attention: string; worked_by: string; build_requested_at: number | null; project_id: string | null }>();
}

/** The pending change a client's agent sent, kept in R2 until a node builds it. */
const changeKey = (ticketId: number) => `changes/${ticketId}.json`;

const CHANGE_LIMITS = { files: 40, fileBytes: 512 * 1024, totalBytes: 2 * 1024 * 1024 };
const CHANGE_PATH = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[\w.@+\-/ ]{1,300}$/;

/** Bound a submitted change (path + full content), or say why not. */
function cleanChangeFiles(value: unknown): { files: { path: string; content: string }[] } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) return { error: 'no files' };
  if (value.length > CHANGE_LIMITS.files) return { error: `${value.length} files; a change takes at most ${CHANGE_LIMITS.files}` };
  const files: { path: string; content: string }[] = [];
  let total = 0;
  for (const raw of value as Record<string, unknown>[]) {
    const path = typeof raw?.path === 'string' ? raw.path : '';
    const content = typeof raw?.content === 'string' ? raw.content : null;
    if (!CHANGE_PATH.test(path) || content === null) return { error: `bad file entry ${JSON.stringify(path).slice(0, 80)}` };
    if (path.startsWith('.git/') || path === '.git') return { error: 'refusing a .git path' };
    const bytes = new TextEncoder().encode(content).length;
    if (bytes > CHANGE_LIMITS.fileBytes) return { error: `${path} is larger than 512 KB` };
    total += bytes;
    files.push({ path, content });
  }
  if (total > CHANGE_LIMITS.totalBytes) return { error: 'the files add up to more than 2 MB' };
  return { files };
}

/** Approved means Ali said yes; that is all a client's own agent may work on. */
const AGENT_WORKABLE = new Set(['approved', 'in_progress', 'review']);

/**
 * The client's own agent sends a change: the files it wrote, kept in R2 until
 * a node applies them to the ticket's branch. From here the ticket's work is
 * the client's agent's — no fleet run, so no AI cost on our bill.
 */
portal.post('/portal/tickets/:id/change', async (c) => {
  const ticket = await ownTicket(c);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  if (!AGENT_WORKABLE.has(ticket.status)) return reply(c, { error: 'not_approved' }, 409);
  if (!c.env.FILES) return reply(c, { error: 'files_unavailable' }, 503);
  const body = await readJson<{ files?: unknown }>(c);
  const cleaned = cleanChangeFiles(body?.files);
  if ('error' in cleaned) return reply(c, { error: cleaned.error }, 400);
  const t = now();
  await c.env.FILES.put(changeKey(ticket.id), JSON.stringify({ files: cleaned.files, at: t }), {
    httpMetadata: { contentType: 'application/json' },
  });
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE tickets SET worked_by = 'client_agent', updated_at = ? WHERE id = ?`).bind(t, ticket.id),
    c.env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 0, ?)`)
      .bind(ticket.id, `Your agent sent a change for this request (${cleaned.files.length} file(s)).`, t),
  ]);
  return reply(c, { ok: true, files: cleaned.files.length });
});

/** Ask for a build of the pending change: a node applies it and deploys the preview. */
portal.post('/portal/tickets/:id/build', async (c) => {
  const ticket = await ownTicket(c);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  if (!AGENT_WORKABLE.has(ticket.status)) return reply(c, { error: 'not_approved' }, 409);
  if (!ticket.project_id || !(await getSite(c.env, ticket.project_id))) {
    return reply(c, { error: 'not_hosted' }, 400);
  }
  const pending = await c.env.FILES?.head(changeKey(ticket.id));
  if (!pending) return reply(c, { error: 'no_change' }, 409);
  await c.env.DB.prepare('UPDATE tickets SET build_requested_at = ?, updated_at = ? WHERE id = ?').bind(now(), now(), ticket.id).run();
  return reply(c, { ok: true, state: 'queued' });
});

/** Everything an agent needs about a request it is cleared to work on. */
portal.get('/portal/tickets/:id/context', async (c) => {
  const ticket = await ownTicket(c);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  const [messages, project] = await Promise.all([
    ticketMessages(c.env, ticket.id, false),
    ticket.project_id
      ? c.env.DB.prepare('SELECT id, slug, name, kind, brief, repo FROM projects WHERE id = ?').bind(ticket.project_id).first<Record<string, unknown>>()
      : Promise.resolve(null),
  ]);
  const site = ticket.project_id ? await siteState(c.env, ticket.project_id) : null;
  const workspace = ticket.project_id ? await workspaceFor(c.env, ticket.project_id) : null;
  return reply(c, {
    ticket: { id: ticket.id, title: ticket.title, status: ticket.status, attention: ticket.attention, workedBy: ticket.worked_by },
    messages,
    project: project ? { ...project, brief: parseBrief(project.brief) } : null,
    site: site?.site ?? null,
    siteConfig: workspace?.siteConfig ?? null,
  });
});

/** The source tree the current preview was built from. */
portal.get('/portal/tickets/:id/workspace', async (c) => {
  const ticket = await ownTicket(c);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  const workspace = ticket.project_id ? await workspaceFor(c.env, ticket.project_id) : null;
  if (!workspace) return reply(c, { error: 'not_hosted' }, 404);
  return reply(c, workspace);
});

/** One source file, by ?path=. */
portal.get('/portal/tickets/:id/workspace/file', async (c) => {
  const ticket = await ownTicket(c);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  const path = c.req.query('path') ?? '';
  const file = ticket.project_id ? await workspaceRead(c.env, ticket.project_id, path) : null;
  if (!file) return reply(c, { error: 'not_found' }, 404);
  return reply(c, file);
});

portal.get('/portal/tickets', async (c) => {
  // `unread`: Ali (or a status change) said something the client has not opened yet.
  const { results } = await c.env.DB.prepare(
    `SELECT ${TICKET_COLUMNS},
            EXISTS (SELECT 1 FROM ticket_messages m
                     WHERE m.ticket_id = t.id AND m.internal = 0 AND m.author IN ('ali', 'system')
                       AND m.created_at > COALESCE(t.client_seen_at, t.created_at)) AS unread
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
  // JSON, or multipart form data when files come with it (form fields are strings).
  const msg = await readMessage(c);
  if (msg === 'too_large') return reply(c, { error: 'file_too_large' }, 413);
  const fields = msg?.fields ?? {};
  const fromForm = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v === '' ? undefined : v);
  const body = msg
    ? {
        title: fields.title,
        body: fields.body,
        projectId: fields.projectId,
        attention: fields.attention === '' ? undefined : fields.attention,
        budgetCents: fromForm(fields.budgetCents),
      }
    : null;
  const title = cleanText(body?.title, MAX_TITLE_CHARS);
  const text = cleanText(body?.body, MAX_BODY_CHARS);
  if (!title || !text) return reply(c, { error: 'bad_ticket' }, 400);
  const files = await messageUploads(c, null, msg?.files ?? []);
  if (files.error) return files.error;
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
  const stored = await postMessage(env, ticket.id, 'client', text, false, files.uploads, t);

  const ref = { id: ticket.id, title, client_email: user.email };
  c.executionCtx.waitUntil(
    Promise.all([notifyAliOfClientMessage(env, ref, withAttachmentLine(text, stored), true), confirmTicketToClient(env, ref)]),
  );
  return reply(c, { id: ticket.id, files: stored }, 201);
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
    .first<Record<string, unknown> & Meter & { id: number; user_id: string; client_email: string; title: string; status: Status; attention: string; kind: string }>();
  if (!ticket) return null;
  if (!admin && ticket.user_id !== c.get('user').id) return null;
  return ticket;
}

portal.get('/portal/tickets/:id', async (c) => {
  const ticket = await loadTicket(c, false);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  const { user_id: _, client_email: __, ...visible } = ticket;
  const messages = await ticketMessages(c.env, ticket.id, false);
  c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE tickets SET client_seen_at = ? WHERE id = ?').bind(now(), ticket.id).run());
  return reply(c, { ticket: visible, messages: await withFiles(c.env, ticket.id, messages, false) });
});

/* A file from the thread. Only files on messages the caller can see. */
portal.get('/portal/tickets/:id/files/:fileId', async (c) => {
  const ticket = await loadTicket(c, false);
  const res = ticket && (await fileResponse(c.env, ticket.id, c.req.param('fileId'), false, corsHeaders(origin(c))));
  return res || reply(c, { error: 'not_found' }, 404);
});

portal.post('/portal/tickets/:id/messages', async (c) => {
  const env = c.env;
  const ticket = await loadTicket(c, false);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  const msg = await readMessage(c);
  if (msg === 'too_large') return reply(c, { error: 'file_too_large' }, 413);
  if (!msg || msg.text.length > MAX_BODY_CHARS || (!msg.text && !msg.files.length)) return reply(c, { error: 'bad_message' }, 400);
  const files = await messageUploads(c, ticket.id, msg.files);
  if (files.error) return files.error;
  if (await isRateLimited(env, c.get('user').id, 'message', MESSAGE_LIMIT, TICKET_WINDOW_SECONDS)) {
    return reply(c, { error: 'rate_limited' }, 429);
  }

  const t = now();
  const stored = await postMessage(env, ticket.id, 'client', msg.text, false, files.uploads, t);
  await env.DB.prepare(WAITING_SQL).bind(t, t, ticket.id).run();
  c.executionCtx.waitUntil(notifyAliOfClientMessage(env, ticket, withAttachmentLine(msg.text, stored), false));
  return reply(c, { ok: true, files: stored }, 201);
});

/**
 * The client takes back a request Ali has not started on. Only while it waits
 * for him (`new`) and nothing has run: once work exists there is something to
 * pay for, and stopping it is a conversation with Ali, not a button. A
 * withdrawn request is declined, which bills nothing.
 */
portal.post('/portal/tickets/:id/withdraw', async (c) => {
  const env = c.env;
  const ticket = await loadTicket(c, false);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  const t = now();
  const row = await env.DB.prepare(
    `UPDATE tickets SET status = 'declined', updated_at = ?, client_waiting_since = NULL
      WHERE id = ? AND status = 'new' AND NOT EXISTS (SELECT 1 FROM ticket_runs WHERE ticket_id = tickets.id)
      RETURNING id`,
  )
    .bind(t, ticket.id)
    .first();
  if (!row) return reply(c, { error: 'not_withdrawable' }, 409);
  await env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'system', ?, ?)`)
    .bind(ticket.id, 'The client withdrew this request.', t)
    .run();
  c.executionCtx.waitUntil(notifyAliOfClientMessage(env, ticket, 'I withdrew this request. No need to act on it.', false));
  return reply(c, { ok: true });
});

/** Set a ticket's budget and say so in the thread, where both sides read it. */
function budgetStatements(env: Env, ticketId: number, budget: number | null, who: string, t: number) {
  return [
    env.DB.prepare('UPDATE tickets SET budget_cents = ?, updated_at = ? WHERE id = ?').bind(budget, t, ticketId),
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'system', ?, ?)`).bind(
      ticketId,
      budget === null ? `${who} removed the budget.` : `${who} set the budget to ${money(budget)}.`,
      t,
    ),
  ];
}

/**
 * The client raises, lowers or clears their own budget. Work stops when the
 * meter reaches it (queue.ts), so this is how they let it continue.
 */
portal.patch('/portal/tickets/:id/budget', async (c) => {
  const env = c.env;
  const ticket = await loadTicket(c, false);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  if (ticket.status === 'done' || ticket.status === 'declined') return reply(c, { error: 'closed' }, 409);
  const body = await readJson<{ budgetCents?: unknown }>(c);
  const budget = cleanBudget(body?.budgetCents);
  if (budget === undefined || budget === false) return reply(c, { error: 'bad_budget' }, 400);
  if (budget === ticket.budget_cents) return reply(c, { ok: true });
  await env.DB.batch(budgetStatements(env, ticket.id, budget, 'The client', now()));
  c.executionCtx.waitUntil(
    notifyAliOfClientMessage(env, ticket, budget === null ? 'I removed the budget.' : `I set the budget to ${money(budget)}.`, false),
  );
  return reply(c, { ok: true, budgetCents: budget });
});

/* —— admin —— */

/**
 * What needs Ali, in one cheap query: tickets to approve, runs to review,
 * clients waiting on an answer, and runs working right now. The Harness's
 * sidebar polls it for the Admin entry's count.
 */
portal.get('/admin/attention', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT count(*) FROM tickets WHERE status = 'new') AS approve,
       (SELECT count(*) FROM tickets WHERE status = 'review') AS review,
       (SELECT count(*) FROM tickets WHERE client_waiting_since IS NOT NULL AND status NOT IN ('new', 'done', 'declined')) AS waiting,
       (SELECT count(*) FROM ticket_runs WHERE status = 'running') AS running`,
  ).first<{ approve: number; review: number; waiting: number; running: number }>();
  return reply(c, row ?? { approve: 0, review: 0, waiting: 0, running: 0 });
});

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

/**
 * Tickets whose thread mentions `q` (private notes and agent reports included),
 * newest first, with the matching line. The workbench merges this into its
 * filter, which otherwise only sees titles.
 */
portal.get('/admin/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 100);
  if (q.length < 3) return reply(c, { hits: [] });
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT m.ticket_id AS id, max(m.id) AS mid, m.body
       FROM ticket_messages m
      WHERE m.body LIKE ? ESCAPE '\\'
      GROUP BY m.ticket_id
      ORDER BY mid DESC LIMIT 50`,
  )
    .bind(like)
    .all<{ id: number; mid: number; body: string }>();
  const lower = q.toLowerCase();
  const hits = (results ?? []).map((r) => {
    const at = r.body.toLowerCase().indexOf(lower);
    const from = Math.max(0, at - 40);
    return { id: r.id, snippet: `${from > 0 ? '…' : ''}${r.body.slice(from, at + q.length + 60).replace(/\s+/g, ' ')}` };
  });
  return reply(c, { hits });
});

portal.get('/admin/tickets/:id', async (c) => {
  const ticket = await loadTicket(c, true);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  const land = await c.env.DB.prepare(
    'SELECT land_requested_at, landed_ref, landed_sha FROM tickets WHERE id = ?',
  )
    .bind(ticket.id)
    .first<{ land_requested_at: number | null; landed_ref: string | null; landed_sha: string | null }>();
  return reply(c, {
    ticket,
    messages: await withFiles(c.env, ticket.id, await ticketMessages(c.env, ticket.id, true), true),
    runs: await ticketRuns(c.env, ticket.id),
    land: {
      requestedAt: land?.land_requested_at ?? null,
      ref: land?.landed_ref ?? null,
      sha: land?.landed_sha ?? null,
    },
  });
});

/**
 * Put a ticket's finished work on its project's main line, from the app.
 *
 * The Worker runs no git and holds no repo credentials, so this only records
 * the request: the node that holds the folder picks it up on its next
 * heartbeat, fetches the work branch and pushes it to the default branch. Git
 * refuses anything but a fast-forward, so this cannot rewrite main.
 */
portal.post('/admin/tickets/:id/land', async (c) => {
  const ticket = await loadTicket(c, true);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  if (!ticket.project_id) return reply(c, { error: 'bad_project' }, 400);
  if (ticket.status === 'in_progress') return reply(c, { error: 'in_progress' }, 409);
  await c.env.DB.prepare(
    'UPDATE tickets SET land_requested_at = ?, landed_ref = NULL, landed_sha = NULL WHERE id = ?',
  )
    .bind(now(), ticket.id)
    .run();
  return reply(c, { ok: true });
});

portal.get('/admin/tickets/:id/files/:fileId', async (c) => {
  const ticket = await loadTicket(c, true);
  const res = ticket && (await fileResponse(c.env, ticket.id, c.req.param('fileId'), true, corsHeaders(origin(c))));
  return res || reply(c, { error: 'not_found' }, 404);
});

portal.patch('/admin/tickets/:id', async (c) => {
  const env = c.env;
  const ticket = await loadTicket(c, true);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  const body = await readJson<{
    status?: unknown;
    projectId?: unknown;
    attention?: unknown;
    humanSeconds?: unknown;
    priority?: unknown;
    requires?: unknown;
    executor?: unknown;
    budgetCents?: unknown;
  }>(c);

  const budget = cleanBudget(body?.budgetCents);
  if (budget === false) return reply(c, { error: 'bad_budget' }, 400);
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

  // Routing: what may take it, and in what order. Client work is pinned to the
  // sandboxed executor whatever is asked for here.
  const routing = cleanRouting(body ?? {}, ticket.kind === 'client');
  if (!routing.ok) return reply(c, { error: routing.error }, 400);

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
  if (routing.priority !== undefined) {
    statements.push(env.DB.prepare('UPDATE tickets SET priority = ? WHERE id = ?').bind(routing.priority, ticket.id));
  }
  if (routing.requires !== undefined) {
    statements.push(env.DB.prepare('UPDATE tickets SET requires = ? WHERE id = ?').bind(JSON.stringify(routing.requires), ticket.id));
  }
  if (routing.executor !== undefined) {
    statements.push(env.DB.prepare('UPDATE tickets SET executor = ? WHERE id = ?').bind(routing.executor, ticket.id));
  }
  if (budget !== undefined && budget !== ticket.budget_cents) {
    statements.push(...budgetStatements(env, ticket.id, budget, 'Ali', t));
  }
  const statusChanged = status && status !== ticket.status;
  // A run still going on this ticket is stopped: whatever Ali moved it to, the
  // agent is no longer working on what he decided. Without this a requeued item
  // is claimed again while the first run still works on it. The lease is cut
  // as in POST /admin/runs/:id/cancel, so a run whose node is gone is reaped.
  if (statusChanged) {
    const { results: live } = await env.DB.prepare(
      `SELECT id, node_id FROM ticket_runs WHERE ticket_id = ? AND status = 'running' AND cancel_requested = 0`,
    )
      .bind(ticket.id)
      .all<{ id: number; node_id: string | null }>();
    if (live?.length) {
      statements.push(
        env.DB.prepare(
          `UPDATE ticket_runs SET cancel_requested = 1, lease_expires_at = MIN(COALESCE(lease_expires_at, ?), ?)
            WHERE ticket_id = ? AND status = 'running'`,
        ).bind(t + 60, t + 60, ticket.id),
        env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 1, ?)`).bind(
          ticket.id,
          `Stopped ${live.map((r) => `run ${r.id} on ${r.node_id ?? 'the Harness'}`).join(', ')}: the status was changed to “${STATUS_LABEL[status]}”.`,
          t,
        ),
      );
    }
  }
  // Done freezes the bill at what the meter reads now; reopening unfreezes it.
  const finalMeter = { humanSeconds: humanSeconds ?? ticket.human_seconds, aiMicroUsd: ticket.ai_micro_usd };
  const bill = statusChanged && status === 'done' ? priceLine(finalMeter) : undefined;
  if (statusChanged) {
    statements.push(
      // The client is mailed about it, so it answers them too.
      env.DB.prepare('UPDATE tickets SET status = ?, price_cents = ?, updated_at = ?, client_waiting_since = NULL WHERE id = ?')
        .bind(status, status === 'done' ? priceOf(finalMeter).totalCents : null, t, ticket.id),
      env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'system', ?, ?)`)
        .bind(ticket.id, `Status changed to “${STATUS_LABEL[status]}”.${bill ? ` Total: ${bill}.` : ''}`, t),
    );
  }
  if (statements.length) await env.DB.batch(statements);

  // A system task's "client" is Ali himself; he does not need mail about it.
  if (statusChanged && ticket.kind === 'client') c.executionCtx.waitUntil(notifyClientOfStatus(env, ticket, status, bill));
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
  const msg = await readMessage(c);
  if (msg === 'too_large') return reply(c, { error: 'file_too_large' }, 413);
  if (!msg || msg.text.length > MAX_BODY_CHARS || (!msg.text && !msg.files.length)) return reply(c, { error: 'bad_message' }, 400);
  const internal = msg.internal;
  const files = await messageUploads(c, ticket.id, msg.files);
  if (files.error) return files.error;

  const t = now();
  const stored = await postMessage(env, ticket.id, 'ali', msg.text, internal, files.uploads, t);
  // A private note is not an answer; a reply is.
  await env.DB.prepare(`UPDATE tickets SET updated_at = ?${internal ? '' : ', client_waiting_since = NULL'} WHERE id = ?`)
    .bind(t, ticket.id)
    .run();
  if (!internal && ticket.kind === 'client') c.executionCtx.waitUntil(notifyClientOfReply(env, ticket, withAttachmentLine(msg.text, stored)));
  return reply(c, { ok: true, files: stored }, 201);
});

/** "No reply needed": the client's last word (a thank-you, say) needs no answer. */
portal.post('/admin/tickets/:id/answered', async (c) => {
  const ticket = await loadTicket(c, true);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  await c.env.DB.prepare('UPDATE tickets SET client_waiting_since = NULL WHERE id = ?').bind(ticket.id).run();
  return reply(c, { ok: true });
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
  // Only a node uploads session logs (PUT /node/runs/:id/session); the session
  // id and folder are kept, a claim of a stored log is not.
  report.sessionLog = false;
  const done = await finishRun(c.env, id, report);
  if (!done.ok) return reply(c, { error: done.error }, done.error === 'not_found' ? 404 : 409);

  if ((await getSettings(c.env)).notifyRunFinished) c.executionCtx.waitUntil(
    mailAli(c.env, {
      subject: `[#${id}] ${report.executor} ${done.late ? 'stopped' : report.ok ? 'finished' : 'failed'}: ${done.title}`,
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

/** A run's live steps after `?after=<seq>`, and whether it is still running. */
portal.get('/admin/runs/:id/steps', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return reply(c, { error: 'not_found' }, 404);
  const after = Math.max(0, Number(c.req.query('after') ?? 0) || 0);
  const result = await readSteps(c.env, id, after);
  if (!result.found) return reply(c, { error: 'not_found' }, 404);
  return reply(c, { live: result.live, steps: result.steps });
});

/**
 * A run's Harness session log, as the node uploaded it (zstd-compressed JSONL),
 * so the conversation can be opened on any machine. `x-session-id` and
 * `x-session-dir` say which session it is and where it lived on the node.
 */
portal.get('/admin/runs/:id/session', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0 || !c.env.FILES) return reply(c, { error: 'not_found' }, 404);
  const run = await c.env.DB.prepare(
    'SELECT ticket_id, session_id, session_dir FROM ticket_runs WHERE id = ? AND session_log = 1',
  )
    .bind(id)
    .first<{ ticket_id: number; session_id: string | null; session_dir: string | null }>();
  const object = run && (await c.env.FILES.get(sessionKey(run.ticket_id, id)));
  if (!run || !object) return reply(c, { error: 'not_found' }, 404);
  return new Response(object.body, {
    headers: {
      ...corsHeaders(origin(c)),
      'Access-Control-Expose-Headers': 'x-intercom-session, x-session-id, x-session-dir',
      'content-type': 'application/zstd',
      'content-length': String(object.size),
      'x-session-id': run.session_id ?? '',
      'x-session-dir': run.session_dir ?? '',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
});

/*
 * Stop a run. The node sees the flag on its next heartbeat and kills the
 * executor; its lease is cut to a minute so an offline node's run is reaped
 * (to review, not back into the queue) instead of waiting out a full lease.
 */
portal.post('/admin/runs/:id/cancel', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return reply(c, { error: 'not_found' }, 404);
  const t = now();
  const row = await c.env.DB.prepare(
    `UPDATE ticket_runs SET cancel_requested = 1, lease_expires_at = MIN(COALESCE(lease_expires_at, ?), ?)
      WHERE id = ? AND status = 'running' RETURNING ticket_id`,
  )
    .bind(t + 60, t + 60, id)
    .first<{ ticket_id: number }>();
  if (!row) return reply(c, { error: 'not_running' }, 409);
  return reply(c, { ok: true, ticketId: row.ticket_id });
});

/* —— the work queue: nodes, what is waiting, and why —— */

portal.get('/admin/nodes', async (c) => reply(c, { nodes: await nodesView(c.env) }));

/**
 * Change a node from the admin views: drain or resume it, and set its
 * overrides (slots, capabilities, executors, offline alert). Overrides reach
 * the node on its next heartbeat.
 */
portal.patch('/admin/nodes/:id', async (c) => {
  const body = await readJson<{ draining?: unknown; overrides?: unknown }>(c);
  const node = await c.env.DB.prepare('SELECT overrides FROM nodes WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ overrides: string }>();
  if (!node) return reply(c, { error: 'not_found' }, 404);
  const statements = [];
  if (body?.draining !== undefined) {
    if (typeof body.draining !== 'boolean') return reply(c, { error: 'bad_node' }, 400);
    statements.push(c.env.DB.prepare('UPDATE nodes SET draining = ? WHERE id = ?').bind(body.draining ? 1 : 0, c.req.param('id')));
  }
  if (body?.overrides !== undefined) {
    let current: NodeOverrides = {};
    try {
      current = JSON.parse(node.overrides);
    } catch {
      current = {};
    }
    const next = cleanOverrides(body.overrides, current);
    if (!next) return reply(c, { error: 'bad_overrides' }, 400);
    statements.push(c.env.DB.prepare('UPDATE nodes SET overrides = ? WHERE id = ?').bind(JSON.stringify(next), c.req.param('id')));
  }
  if (!statements.length) return reply(c, { error: 'bad_node' }, 400);
  await c.env.DB.batch(statements);
  return reply(c, { ok: true });
});

/** System-wide settings, plus the catalogs the views build their buttons from. */
portal.get('/admin/settings', async (c) =>
  reply(c, { settings: await getSettings(c.env), catalog: { capabilities: CAPABILITY_CATALOG, executors: EXECUTOR_CATALOG } }),
);

portal.patch('/admin/settings', async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  if (!body || typeof body !== 'object') return reply(c, { error: 'bad_settings' }, 400);
  const rejected = await saveSettings(c.env, body);
  if (rejected.length) return reply(c, { error: 'bad_settings', rejected }, 400);
  return reply(c, { settings: await getSettings(c.env) });
});

/** Forget a node. It re-registers on its next heartbeat if it is still alive. */
portal.delete('/admin/nodes/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(c.req.param('id')).run();
  return reply(c, { ok: true });
});

portal.get('/admin/queue', async (c) => reply(c, { queue: await queueView(c.env) }));

/**
 * File a system task: Ali's own work, owned by his account, with no client to
 * notify. Filing it is the approval unless `approve` is false, in which case it
 * waits in `new` like any request.
 */
portal.post('/admin/work', async (c) => {
  const env = c.env;
  const body = await readJson<{
    title?: unknown;
    brief?: unknown;
    projectId?: unknown;
    slug?: unknown;
    priority?: unknown;
    requires?: unknown;
    executor?: unknown;
    approve?: unknown;
    source?: unknown;
  }>(c);
  const title = cleanText(body?.title, MAX_TITLE_CHARS);
  const brief = cleanText(body?.brief, MAX_BODY_CHARS);
  if (!title || !brief) return reply(c, { error: 'bad_message' }, 400);
  const routing = cleanRouting(body ?? {}, false);
  if (!routing.ok) return reply(c, { error: routing.error }, 400);

  const project =
    typeof body?.projectId === 'string'
      ? await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(body.projectId).first<{ id: string }>()
      : typeof body?.slug === 'string'
        ? await env.DB.prepare('SELECT id FROM projects WHERE slug = ?').bind(body.slug.trim().toLowerCase()).first<{ id: string }>()
        : null;
  if (!project) return reply(c, { error: 'bad_project' }, 400);

  const status = body?.approve === false ? 'new' : 'approved';
  const source = body?.source === 'schedule' ? 'schedule' : 'dsh';
  const t = now();
  const row = await env.DB.prepare(
    `INSERT INTO tickets (user_id, project_id, title, status, kind, source, priority, requires, executor, attention, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'system', ?, ?, ?, ?, 'auto', ?, ?) RETURNING id`,
  )
    .bind(
      c.get('user').id,
      project.id,
      title,
      status,
      source,
      routing.priority ?? (await getSettings(env)).defaultPriority,
      JSON.stringify(routing.requires ?? []),
      routing.executor ?? null,
      t,
      t,
    )
    .first<{ id: number }>();
  if (!row) return reply(c, { error: 'insert_failed' }, 500);
  // Ali's own words are trusted guidance, the same author as his notes.
  await env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'ali', ?, 1, ?)`)
    .bind(row.id, brief, t)
    .run();
  return reply(c, { id: row.id, status }, 201);
});

portal.get('/admin/clients', async (c) => {
  const [{ results }, usage] = await Promise.all([
    c.env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.role, u.handoff, u.created_at,
              (SELECT group_concat(project_id) FROM user_projects WHERE user_id = u.id) AS project_ids,
              (SELECT count(*) FROM tickets WHERE user_id = u.id) AS ticket_count
         FROM users u ORDER BY u.created_at DESC`,
    ).all<Record<string, unknown> & { id: string; project_ids: string | null }>(),
    usageByUser(c.env),
  ]);
  const clients = results.map(({ project_ids, ...rest }) => ({
    ...rest,
    projectIds: project_ids ? project_ids.split(',') : [],
    usage: usage.get(rest.id) ?? NO_USAGE,
  }));
  // Everything owed across all clients, for the top of the Directory.
  const total = [...usage.values()].reduce(
    (a, u) => ({ billedCents: a.billedCents + u.billedCents, openCents: a.openCents + u.openCents, aiCents: a.aiCents + u.aiCents, tickets: a.tickets + u.tickets }),
    NO_USAGE,
  );
  return reply(c, { clients, total });
});

/** Where a project's repo has got to, in the words the admin card shows. */
function repoStatus(p: {
  repo: string | null;
  repo_kind: string;
  repo_wanted: number;
  repo_error: string | null;
  repo_claim_node: string | null;
  repo_claim_at: number | null;
}): { state: 'ready' | 'creating' | 'queued' | 'failed' | 'zip' | 'missing'; detail: string } {
  if (p.repo) return { state: 'ready', detail: p.repo };
  if (p.repo_error) return { state: 'failed', detail: `Creating the repo failed: ${p.repo_error}` };
  if (p.repo_wanted && p.repo_claim_node && p.repo_claim_at && now() - p.repo_claim_at < 15 * 60) {
    return { state: 'creating', detail: `${p.repo_claim_node} is creating the repo.` };
  }
  if (p.repo_wanted) return { state: 'queued', detail: 'A node creates the repo on its next beat.' };
  if (p.repo_kind === 'zip') return { state: 'zip', detail: 'Waiting for the client to send a copy.' };
  return { state: 'missing', detail: 'No repo, and none is being made. Work on it cannot start.' };
}

portal.get('/admin/projects', async (c) => {
  const [{ sitesDomain }, projects, slugs, counts, sites] = await Promise.all([
    getSettings(c.env),
    c.env.DB.prepare(
      `SELECT id, slug, name, kind, brief, repo, repo_kind, repo_wanted, repo_error, repo_claim_node, repo_claim_at,
              github_installation_id, created_by, onboarded_at, created_at
         FROM projects ORDER BY name`,
    ).all<ProjectRow & { repo_wanted: number; repo_error: string | null; repo_claim_node: string | null; repo_claim_at: number | null; github_installation_id: number | null }>(),
    onlineSlugs(c.env),
    c.env.DB.prepare(
      `SELECT project_id, count(*) AS n FROM tickets WHERE project_id IS NOT NULL GROUP BY project_id`,
    ).all<{ project_id: string; n: number }>(),
    sitesById(c.env),
  ]);
  const filed = new Map((counts.results ?? []).map((row) => [row.project_id, row.n]));

  // The same setup the client sees, so the admin view is not guessing at it.
  return reply(c, {
    projects: (projects.results ?? []).map((project) => {
      const kind = isProjectKind(project.kind) ? project.kind : 'existing';
      const repoKind = isRepoKind(project.repo_kind) ? project.repo_kind : 'none';
      const brief = parseBrief(project.brief);
      const site = siteView(sites.get(project.id), sitesDomain);
      return {
        ...project,
        brief,
        kind,
        repoKind,
        site,
        repoStatus: repoStatus(project),
        setup: setupFor({
          kind,
          brief,
          repoKind,
          repo: project.repo,
          slug: project.slug,
          onlineSlugs: slugs,
          ticketCount: filed.get(project.id) ?? 0,
          clientCreated: project.created_by !== null,
          site,
        }),
      };
    }),
  });
});

/** Retry a stopped site: back to allocating, so whatever it waited for is tried again. */
portal.post('/admin/projects/:id/site/retry', async (c) => {
  const env = c.env;
  const site = await getSite(env, c.req.param('id'));
  if (!site) return reply(c, { error: 'not_found' }, 404);
  await env.DB.prepare(
    `UPDATE sites SET state = 'allocating', error = NULL, failure_alerted_at = NULL, created_at = ?, updated_at = ?
      WHERE project_id = ?`,
  )
    .bind(now(), now(), site.project_id)
    .run();
  const { sitesDomain } = await getSettings(env);
  return reply(c, { site: siteView(await advanceSite(env, site.project_id), sitesDomain) });
});

/** The deploy history of a site: what publish and rollback point at. */
portal.get('/admin/projects/:id/site/deploys', async (c) => {
  const site = await getSite(c.env, c.req.param('id'));
  if (!site) return reply(c, { error: 'not_found' }, 404);
  return reply(c, { deploys: await listDeploys(c.env, site.project_id) });
});

portal.post('/admin/projects/:id/site/publish', async (c) => {
  const out = await publishSite(c.env, c.req.param('id'));
  if ('error' in out) return siteError(c, out);
  return reply(c, { ok: true, productionUrl: out.productionUrl });
});

portal.post('/admin/projects/:id/site/rollback', async (c) => {
  const body = await readJson<{ deployId?: unknown }>(c);
  const out = await rollbackSite(c.env, c.req.param('id'), typeof body?.deployId === 'string' ? body.deployId : '');
  if ('error' in out) return siteError(c, out);
  return reply(c, { ok: true, productionUrl: out.productionUrl });
});

/**
 * Where a project's code comes from, as the admin form asks it:
 *   create  a node makes a private repo (the default — work needs something to clone)
 *   repo    this URL
 *   folder  a folder that already exists on a node; that node shares its origin
 */
portal.post('/admin/projects', async (c) => {
  const body = await readJson<{ name?: unknown; slug?: unknown; code?: unknown; repo?: unknown; kind?: unknown }>(c);
  const name = cleanText(body?.name, MAX_NAME_CHARS);
  const slug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  // The slug is what the local runner maps to a folder — keep it path-safe.
  if (!name || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return reply(c, { error: 'bad_project' }, 400);
  const code = body?.code === 'repo' || body?.code === 'folder' ? body.code : 'create';
  const repo = code === 'repo' ? cleanRepo(body?.repo) : null;
  if (code === 'repo' && !repo) return reply(c, { error: 'bad_repo' }, 400);
  const kind = body?.kind === 'new' ? 'new' : 'existing';
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare(
      `INSERT INTO projects (id, slug, name, kind, repo, repo_kind, repo_wanted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, slug, name, kind, repo, repo ? 'repo' : 'none', code === 'create' ? 1 : 0, now())
      .run();
  } catch {
    return reply(c, { error: 'slug_taken' }, 409);
  }
  return reply(c, { id, slug, name }, 201);
});

/** Name the project's repo. Replaces whatever was there, and stops any pending creation. */
portal.put('/admin/projects/:id/repo', async (c) => {
  const body = await readJson<{ repo?: unknown }>(c);
  const repo = cleanRepo(body?.repo);
  if (!repo || /^https:\/\/[^/]*@/i.test(repo)) return reply(c, { error: 'bad_repo' }, 400);
  const res = await c.env.DB.prepare(
    `UPDATE projects SET repo = ?, repo_kind = 'repo', repo_wanted = 0, repo_error = NULL,
            repo_claim_node = NULL, repo_claim_at = NULL WHERE id = ?`,
  )
    .bind(repo, c.req.param('id'))
    .run();
  if (!res.meta.changes) return reply(c, { error: 'not_found' }, 404);
  // An allocating site was waiting for exactly this.
  if (await getSite(c.env, c.req.param('id'))) await advanceSite(c.env, c.req.param('id'));
  return reply(c, { ok: true, repo });
});

/** Ask the fleet to create the repo now: clears a failed attempt and any zip wait. */
portal.post('/admin/projects/:id/repo/create', async (c) => {
  const id = c.req.param('id');
  const project = await c.env.DB.prepare('SELECT repo FROM projects WHERE id = ?').bind(id).first<{ repo: string | null }>();
  if (!project) return reply(c, { error: 'not_found' }, 404);
  if (project.repo) return reply(c, { error: 'has_repo' }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE projects SET repo_wanted = 1, repo_kind = 'none', repo_error = NULL, repo_claim_node = NULL, repo_claim_at = NULL
        WHERE id = ?`,
    ).bind(id),
    // A site that gave up waiting for the repo tries again with it.
    c.env.DB.prepare(
      `UPDATE sites SET state = 'allocating', error = NULL, failure_alerted_at = NULL, created_at = ?, updated_at = ?
        WHERE project_id = ? AND state = 'failed'`,
    ).bind(now(), now(), id),
  ]);
  return reply(c, { ok: true });
});

/**
 * Delete a project. Refused while it has open requests: those are a client's
 * live work. Closed requests stay, unlinked, with their whole thread; client
 * links, the hosted site and its deploys go (the schema cascades), and so do
 * the site's files. The repo on GitHub is left alone.
 */
portal.delete('/admin/projects/:id', async (c) => {
  const env = c.env;
  const id = c.req.param('id');
  const project = await env.DB.prepare('SELECT id, slug FROM projects WHERE id = ?').bind(id).first<{ id: string; slug: string }>();
  if (!project) return reply(c, { error: 'not_found' }, 404);
  const open = await env.DB.prepare(
    `SELECT count(*) AS n FROM tickets WHERE project_id = ? AND status IN ('new', 'approved', 'in_progress', 'review')`,
  )
    .bind(id)
    .first<{ n: number }>();
  if (open?.n) return reply(c, { error: 'open_tickets', count: open.n }, 409);

  const site = await getSite(env, id);
  if (site && env.SITES) {
    // Everything under the site's prefix: manifests and blobs.
    let cursor: string | undefined;
    do {
      const page = await env.SITES.list({ prefix: `sites/${site.slug}/`, cursor });
      if (page.objects.length) await env.SITES.delete(page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
  return reply(c, { ok: true });
});

/** Build the preview branch as it is and deploy it: a node holding the project does it on its next beat. */
portal.post('/admin/projects/:id/site/rebuild', async (c) => {
  const res = await c.env.DB.prepare(
    `UPDATE sites SET rebuild_requested_at = ?, rebuild_error = NULL WHERE project_id = ? AND state = 'ready' AND host = 'ours'`,
  )
    .bind(now(), c.req.param('id'))
    .run();
  if (!res.meta.changes) return reply(c, { error: 'not_ready' }, 409);
  return reply(c, { ok: true });
});

/** Host a project on malipetek.online, the same as a client's "Set up my site", for any project. */
portal.post('/admin/projects/:id/site', async (c) => {
  const project = await c.env.DB.prepare('SELECT id, name, slug FROM projects WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ id: string; name: string; slug: string }>();
  if (!project) return reply(c, { error: 'not_found' }, 404);
  try {
    const site = await startSite(c.env, c.get('user'), project);
    return reply(c, { site: siteView(site) }, 201);
  } catch (error) {
    return siteError(c, error);
  }
});

/** How a client's finished work reaches them: a preview link, or a PR in their repo. */
portal.patch('/admin/clients/:userId', async (c) => {
  const body = await readJson<{ handoff?: unknown }>(c);
  if (body?.handoff !== 'preview' && body?.handoff !== 'pull_request') {
    return reply(c, { error: 'bad_handoff' }, 400);
  }
  const res = await c.env.DB.prepare(`UPDATE users SET handoff = ? WHERE id = ? AND role = 'client'`)
    .bind(body.handoff, c.req.param('userId'))
    .run();
  if (!res.meta.changes) return reply(c, { error: 'not_found' }, 404);
  return reply(c, { ok: true, handoff: body.handoff });
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
