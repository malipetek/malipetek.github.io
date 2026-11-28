/*
 * Client portal — D1-backed accounts and tickets.
 *
 *   POST /auth/request   { email, turnstileToken }  → emails a magic link
 *   POST /auth/verify    { token }                   → { session, user }
 *   POST /auth/code      { email, code }             → { session, user }  (the code in the same email)
 *   POST /auth/device/start { challenge, label?, state? } → { deviceCode, verificationUrl, expiresAt }
 *   GET  /auth/device/info?code=                     → { label, expiresAt }  (consent page only)
 *   POST /auth/device/token { code, verifier }       → { session, user }  (PTech Admin desktop app)
 *   POST /auth/logout
 *
 *   Signed in (Authorization: Bearer <session>):
 *   GET  /portal/me                       user + linked projects
 *   POST /portal/device/approve { deviceCode } → { redirect, code }  (admin only)
 *   GET  /portal/tickets                  own tickets
 *   POST /portal/tickets                  { title, body, projectId? }
 *   GET  /portal/tickets/:id              ticket + public messages (with their files)
 *   POST /portal/tickets/:id/messages     { body }, or multipart: body + files
 *   GET  /portal/tickets/:id/files/:fileId
 *   POST /portal/tickets/:id/withdraw     only while new and nothing has run
 *
 *   Admin role only (any address in ADMIN_EMAILS, or the legacy ADMIN_EMAIL):
 *   GET   /admin/tickets?status=
 *   GET   /admin/tickets/:id              includes internal notes
 *   PATCH /admin/tickets/:id              { status?, projectId? }
 *   POST  /admin/tickets/:id/messages     { body, internal? }, or multipart with files
 *   POST  /admin/tickets/:id/answered     "no reply needed"
 *   GET   /admin/tickets/:id/files/:fileId
 *   GET   /admin/runs/:id/session        a run's Harness session log (zstd JSONL)
 *   GET   /admin/clients
 *   POST  /admin/clients                  { email, name?, locale?, projectIds[], note? } → invite
 *   POST  /admin/clients/:userId/invite   send a fresh link, killing the unused ones
 *   DELETE /admin/clients/:userId/invite  revoke the unused links
 *   GET   /admin/projects   POST /admin/projects { name, slug, ownerUserId? }   PATCH /admin/projects/:id { name?, kind?, ownerUserId? }
 *   PUT   /admin/clients/:userId/projects/:projectId { copy? }   (copy: mail them every request on it)
 *   DELETE /admin/clients/:userId/projects/:projectId
 *
 * Approval is a status change only Ali can make; nothing in this file runs
 * work on a ticket. Sessions are opaque random tokens; only their SHA-256
 * lives in D1, same for magic-link tokens.
 */
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { SOLUTION_CATALOG, INTEGRATION_CATALOG, cleanSolutions, fieldBelongs, integrationStatus, integrationsFor, parseSolutions, requiresFor } from './solutions.ts';
import { verifyIntegration } from './integrations.ts';
import { ATTENTION_KEYS, billOf, DEFAULT_ATTENTION, money, priceLine, priceOf } from '../../src/lib/pricing.js';
import { claimTicketById, finishRun, normalizeReport, sessionKey, sharedLine, ticketRuns } from './runs.ts';
import { finishContentCycle } from './content.ts';
import { finishGuideCycle, finishSeoCycle } from './seo.ts';
import { bridgeMessage, bridgeTitle, forAli, forClientMail, threadFor, translateText, type Bridged } from './translate.ts';
import { inviteMail, INVITE_TTL_SECONDS, joinProjectNames } from './invites.ts';
import { previewStrings, tFor } from '../../src/i18n/eager.js';
import { closestLocale, fromAcceptLanguage, TRANSLATION_ENGINES, type TranslationEngine } from '../../src/lib/locales.js';
import { readSteps } from './steps.ts';
import { i18nStatus, requestI18nSync, setI18nAuto } from './i18nSync.ts';
import { healthMail, healthView, markHealthAlerted, runHealthChecks } from './health.ts';
import { latestReview, reviewLine, reviewRun } from './review.ts';
import { maybeAutoApprove } from './approve.ts';
import { completeFirstPreview, limitCentsFor } from './firstPreview.ts';
import { apiBase, cloudflareAccess } from './cfaccess.ts';
import { screenshotResponse, screenshotsFor, verifyShotToken } from './screenshots.ts';
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
  canUseAssistant,
  isAllowedOrigin,
  clientIp,
  corsHeaders,
  encoder,
  isAdminEmail,
  isRateLimited,
  json,
  now,
  primaryAdminEmail,
  randomToken,
  sha256,
  verifyTurnstile,
  type Env,
  type HonoEnv,
} from './shared.ts';
import { createSession } from './sessions.ts';
import {
  approveDevice,
  cleanChallenge,
  cleanDeviceLabel,
  cleanDeviceState,
  deviceInfo,
  deviceRedirect,
  exchangeDevice,
  startDevice,
} from './device.ts';
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
  cleanSiteSlug,
  deleteSite,
  getSite,
  getSiteById,
  getSites,
  listDeploys,
  PLACEHOLDER_DEPLOY,
  publishSite,
  rollbackSite,
  setSiteHost,
  siteSlugFree,
  siteState,
  siteView,
  startSite,
  workspaceFor,
  workspaceRead,
  type SiteHost,
  type SiteRow,
} from './sites.ts';
import { grantedAccounts, connectionRow } from './cfaccess.ts';
import { registerProjectCollaborationRoutes } from './projectCollaboration.ts';
import { ensureRepo, useClientRepo, installationToken } from './ghapp.ts';
import { accessFor, authorizeWorkbenchRoute, canWorkProject, isSuperAdmin, ownsProject, projectScope, sealProjectSecret, openProjectSecret } from './projectAccess.ts';
import { moveSite, moveTicket, promotePrimary } from './move.ts';
import { runIntake } from './intake.ts';
import { detectProviderBuild, listDomains, listPages, listWorkers, normalizeRepo, parseDeployTarget, pickConnection, readDeployTarget, type ConnectionSummary } from './hosting.ts';
import { isAudioType, transcribe } from './transcribe.ts';
import { checkUploads, fileCount, fileResponse, FILE_LIMITS, sizeText, storeFiles, withFiles, type FileMeta, type Upload } from './files.ts';

// Kept exported from here for the modules that already import them from the
// portal; the implementations live in shared.ts.
export { now, randomToken, sha256 };

const LINK_TTL_SECONDS = 15 * 60;
const MAX_EMAIL_CHARS = 254;
export const MAX_TITLE_CHARS = 140;
export const MAX_BODY_CHARS = 8000;
const MAX_NAME_CHARS = 80;
const AUTH_IP_LIMIT = 5; // magic-link requests per IP per window
const AUTH_EMAIL_LIMIT = 3; // per address per window
const AUTH_WINDOW_SECONDS = 15 * 60;
const DEVICE_START_LIMIT = 10; // device sign-in attempts per IP per window
const DEVICE_TOKEN_LIMIT = 30; // device code redemptions per IP per window
const TICKET_LIMIT = 10; // new tickets per user per window
const TICKET_WINDOW_SECONDS = 60 * 60;
/** Client messages per user per hour: each one mails Ali, and may carry files. */
const MESSAGE_LIMIT = 60;

const STATUSES = ['new', 'approved', 'in_progress', 'review', 'done', 'declined'] as const;
type Status = (typeof STATUSES)[number];

const STATUS_LABEL: Record<Status, string> = {
  new: 'Waiting for a developer',
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
  /** Their language (src/lib/locales.js) and who may translate for them. */
  locale?: string;
  translation?: TranslationEngine;
}

/** `viaAgent`: the caller used an agent token (agent_tokens), not a browser session. */
export type PortalEnv = HonoEnv & { Variables: { user: User; viaAgent: boolean } };
type Ctx = Context<PortalEnv>;

/* ——————————————————————— helpers ——————————————————————— */

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
): Promise<FileMeta[] & { messageId: number }> {
  const row = await env.DB.prepare(
    `INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(ticketId, author, text, internal ? 1 : 0, t)
    .first<{ id: number }>();
  if (!row) throw new Error('message insert failed');
  return Object.assign(await storeFiles(env, ticketId, row.id, uploads), { messageId: row.id });
}

/** The text a notification carries: the message, then what came with it. */
export function withAttachmentLine(text: string, files: { name: string; size: number }[]): string {
  if (!files.length) return text;
  const line = `Attached: ${files.map((f) => `${f.name} (${sizeText(f.size)})`).join(', ')}`;
  return text ? `${text}\n\n${line}` : line;
}

/**
 * A new client message: across the bridge, then to Ali in English with the
 * original under it. Runs after the response (waitUntil).
 */
export async function relayClientMessage(env: Env, t: TicketRef, messageId: number, text: string, files: FileMeta[], isNew: boolean) {
  const [bridgedText, titleEn] = await Promise.all([
    bridgeMessage(env, { id: messageId, ticketId: t.id, author: 'client', text, internal: false }),
    isNew ? bridgeTitle(env, t.id, t.title) : Promise.resolve(t.title_en ?? null),
  ]);
  const ref = { ...t, title_en: titleEn && titleEn !== t.title ? titleEn : t.title_en };
  await notifyAliOfClientMessage(env, ref, withAttachmentLine(forAli(bridgedText, text), files), isNew);
}

/** Ali's reply: across the bridge, then to the client in their language. */
export async function relayAliReply(env: Env, t: TicketRef, messageId: number, text: string, files: FileMeta[]) {
  const b: Bridged = await bridgeMessage(env, { id: messageId, ticketId: t.id, author: 'ali', text, internal: false });
  const body = forClientMail(b, text, tFor(t.client_locale)('mail.translatedNote'));
  await notifyClientOfReply(env, t, withAttachmentLine(body, files));
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

/**
 * When the portal moved from malipetek.dev/portal to ptechsolutions.net/portal
 * (2026-11-13, UTC). Accounts created before it get a line in the sign-in
 * email saying the new sender is the same portal.
 */
export const PORTAL_MOVED_AT = Date.UTC(2026, 10, 13) / 1000;

export function siteUrl(env: Env): string {
  return (env.PORTAL_URL || env.SITE_URL || 'https://ptechsolutions.net').replace(/\/+$/, '');
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
  return (env.REPLY_ADDRESS || 'reply@ptechsolutions.net').split('@')[1];
}

export async function replyAddress(env: Env, ticketId: number, role: ReplyRole): Promise<string> {
  const [local, domain] = (env.REPLY_ADDRESS || 'reply@ptechsolutions.net').split('@');
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
      from: { email: env.PORTAL_FROM_EMAIL || 'portal@ptechsolutions.net', name: 'PTech Solutions' },
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
export async function mailAli(env: Env, mail: Mail): Promise<boolean> {
  if (!env.EMAIL) {
    console.warn('email_not_configured', mail.subject);
    return false;
  }
  try {
    await env.EMAIL.send({
      from: env.PORTAL_FROM_EMAIL || env.CONTACT_FROM_EMAIL || 'portal@ptechsolutions.net',
      to: 'malipetek@gmail.com', // pinned by the binding's destination_address
      ...mail,
    });
    return true;
  } catch (error) {
    console.error('mail_ali_failed', error);
    return false;
  }
}

/**
 * Run every health check and mail the transitions: once when a check starts
 * failing, once when it recovers. Called by the five-minute cron and by
 * Admin → Health → Run now.
 */
export async function runAndNotifyHealth(env: Env) {
  const run = await runHealthChecks(env);
  const mail = healthMail(run, `${siteUrl(env)}/portal/admin`);
  if (mail) {
    // Only mark a failure reported when the mail really went out, so a mailer
    // outage retries on the next run instead of going quiet.
    const sent = await mailAli(env, mail);
    if (sent && run.fresh.length) await markHealthAlerted(env, run.fresh.map((check) => check.name));
  }
  return run;
}

/**
 * Pre-review a finished run, then mail Ali. Both callers (the node API and the
 * Harness) hand this to waitUntil, so the report itself is not delayed.
 */
export async function notifyRunFinished(
  env: Env,
  id: number,
  report: ReturnType<typeof normalizeReport>,
  done: { runId: number; late: boolean; title: string },
  nodeId?: string,
): Promise<void> {
  const review = await reviewRun(env, { ticketId: id, runId: done.runId, report }).catch(() => null);
  if (!(await getSettings(env)).notifyRunFinished) return;
  await mailAli(env, {
    subject: `[#${id}] ${report.executor}${nodeId ? ` on ${nodeId}` : ''} ${done.late ? 'stopped' : report.ok ? 'finished' : 'failed'}: ${done.title}`,
    text:
      `${review ? `${reviewLine(review)}\n\n` : ''}` +
      `${report.summary}\n\n${report.diffStat ? `${report.diffStat}\n\n` : ''}` +
      `${sharedLine(report, nodeId) ? `${sharedLine(report, nodeId)}\n` : ''}` +
      `${report.branch ? `Branch: ${report.branch} (local only, nothing pushed)\n` : ''}` +
      `Cost: $${report.costUsd.toFixed(4)}${report.model ? ` · ${report.model}` : ''}\n` +
      `Review: ${siteUrl(env)}/portal/admin#ticket=${id}`,
  });
}

/*
 * The four ticket notifications, shared by the HTTP routes and inbound mail.
 * Each one sets Reply-To so answering from an inbox lands in the thread.
 */
type TicketRef = { id: number; title: string; client_email: string; client_locale?: string | null; title_en?: string | null };

/** The title Ali reads: the English one when the client filed in another language. */
const aliTitle = (t: TicketRef) => t.title_en || t.title;

/** Footer of a client email, in their language. */
const threadFooter = (env: Env, t: TicketRef, key = 'mail.footer.thread') =>
  tFor(t.client_locale)(key, { url: `${siteUrl(env)}/portal/ticket#id=${t.id}` });

export async function notifyAliOfClientMessage(env: Env, t: TicketRef, text: string, isNew: boolean) {
  // A request that started itself (Autopilot, under the cap) must not say
  // "Review and approve" — Ali would look for work that is already running.
  const state = isNew
    ? await env.DB.prepare('SELECT status, attention FROM tickets WHERE id = ?')
        .bind(t.id)
        .first<{ status: string; attention: string }>()
    : null;
  const autoApproved = state?.status === 'approved' && state.attention === 'auto';
  await mailAli(env, {
    subject: `[#${t.id}] ${isNew ? `New ticket from ${t.client_email}` : `${t.client_email} replied`}: ${aliTitle(t)}`,
    text: ticketMail(
      text,
      `Replying to this email answers ${t.client_email} — they will see it.\n` +
        `${isNew ? (autoApproved ? 'Autopilot: approved and queued without you' : 'Review and approve') : 'Open'}: ${siteUrl(env)}/portal/admin#ticket=${t.id}`,
    ),
    replyTo: await replyAddress(env, t.id, 'a'),
  });
}

export async function notifyClientOfReply(env: Env, t: TicketRef, text: string) {
  const tr = tFor(t.client_locale);
  await mailClient(env, t.client_email, {
    subject: `[#${t.id}] ${tr('mail.reply.subject', { title: t.title })}`,
    text: ticketMail(text, threadFooter(env, t)),
    replyTo: await replyAddress(env, t.id, 'c'),
  });
  // The body is already in the author's language; a copy keeps it as it is.
  await mailCopies(env, t, (cr) => ({ subject: `[#${t.id}] ${cr('mail.reply.subject', { title: t.title })}`, body: text }));
}

async function notifyClientOfStatus(env: Env, t: TicketRef, status: Status, bill?: string) {
  const tr = tFor(t.client_locale);
  const label = tr(`status.${status}`);
  await mailClient(env, t.client_email, {
    subject: `[#${t.id}] ${label}: ${t.title}`,
    text: ticketMail(
      `${tr('mail.status.body', { title: t.title, status: label })}${bill ? `\n\n${tr('mail.status.total', { bill })}` : ''}`,
      threadFooter(env, t),
    ),
    replyTo: await replyAddress(env, t.id, 'c'),
  });
  // The bill is the author's: a project-mate never sees the money (sharedTicket).
  await mailCopies(env, t, (cr) => ({
    subject: `[#${t.id}] ${cr(`status.${status}`)}: ${t.title}`,
    body: cr('mail.status.body', { title: t.title, status: cr(`status.${status}`) }),
  }));
}

export async function confirmTicketToClient(env: Env, t: TicketRef) {
  const tr = tFor(t.client_locale);
  await mailClient(env, t.client_email, {
    subject: `[#${t.id}] ${tr('mail.confirm.subject', { title: t.title })}`,
    text: ticketMail(tr('mail.confirm.body'), threadFooter(env, t, 'mail.confirm.footer')),
    replyTo: await replyAddress(env, t.id, 'c'),
  });
  await mailCopies(env, t, (cr, project) => ({
    subject: `[#${t.id}] ${cr('mail.copy.new.subject', { project, title: t.title })}`,
    body: cr('mail.copy.new.body', { author: t.client_email, project, title: t.title }),
  }));
}

/**
 * The other people on a client request's project who asked for copies
 * (`user_projects.copy_mail`), never the author, an admin or a system task.
 */
export async function copyRecipients(env: Env, ticketId: number) {
  const rows = await env.DB.prepare(
    `SELECT u.email, u.locale, p.name AS project
       FROM tickets t
       JOIN projects p ON p.id = t.project_id
       JOIN user_projects up ON up.project_id = t.project_id AND up.copy_mail = 1
       JOIN users u ON u.id = up.user_id
      WHERE t.id = ? AND t.kind = 'client' AND u.role = 'client' AND u.id <> t.user_id
      ORDER BY u.email`,
  )
    .bind(ticketId)
    .all<{ email: string; locale: string | null; project: string }>();
  return rows.results ?? [];
}

/**
 * A copy of one client email to each of those people, in their own language.
 * No Reply-To: inbound mail only files the author's replies, and someone
 * else's request is read-only for them in the portal too.
 */
async function mailCopies(
  env: Env,
  t: TicketRef,
  build: (tr: ReturnType<typeof tFor>, project: string) => { subject: string; body: string },
) {
  let people: Awaited<ReturnType<typeof copyRecipients>> = [];
  try {
    people = await copyRecipients(env, t.id);
  } catch (error) {
    console.error('copy_recipients_failed', error);
    return;
  }
  for (const person of people) {
    const cr = tFor(person.locale);
    const { subject, body } = build(cr, person.project);
    await mailClient(env, person.email, {
      subject,
      text: `${body}\n\n-- \n${cr('mail.copy.footer', { project: person.project, url: `${siteUrl(env)}/portal/ticket#id=${t.id}` })}`,
    });
  }
}

/* ——————————————————————— queries ——————————————————————— */

/** Agent tokens start with this, so a caller (and a leaked-secret scanner) can tell them apart. */
export const AGENT_TOKEN_PREFIX = 'cat_';
export const MAX_AGENT_TOKENS = 5;

/**
 * The client an agent token acts for. Revoked tokens resolve to nothing, and so
 * do accounts that may not hold an assistant connection: an agent token is a
 * client credential, whoever minted it. ASSISTANT_EMAILS is the explicit
 * exception for the owner's own demo account; its role stays admin, and the
 * token still cannot reach admin routes (they reject `viaAgent`).
 */
export async function agentUser(env: Env, token: string): Promise<User | null> {
  if (!token.startsWith(AGENT_TOKEN_PREFIX) || token.length > 200) return null;
  const hash = await sha256(token);
  const user = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.handoff, u.locale, u.translation
       FROM agent_tokens a JOIN users u ON u.id = a.user_id
      WHERE a.token_hash = ? AND a.revoked_at IS NULL`,
  )
    .bind(hash)
    .first<User>();
  if (!user || !canUseAssistant(env, user)) return null;
  await env.DB.prepare('UPDATE agent_tokens SET last_used_at = ? WHERE token_hash = ?').bind(now(), hash).run();
  return user;
}

export async function sessionUser(env: Env, token: string): Promise<User | null> {
  return env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.handoff, u.locale, u.translation
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), now())
    .first<User>();
}

/** A project row, with the onboarding columns the portal needs to describe it. */
type ProjectRow = {
  solutions: string;
  id: string;
  slug: string;
  name: string;
  kind: string;
  brief: string;
  repo: string | null;
  repo_kind: string;
  repo_wanted: number;
  repo_error: string | null;
  github_installation_id: number | null;
  created_by: string | null;
  created_at: number;
  deploy_target: string | null;
};

async function userProjects(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.kind, p.brief, p.repo, p.repo_kind, p.repo_wanted, p.repo_error,
            p.github_installation_id, p.created_by, p.created_at, p.solutions, p.deploy_target
       FROM projects p
      WHERE EXISTS (SELECT 1 FROM user_projects up WHERE up.project_id=p.id AND up.user_id=?)
         OR p.owner_user_id=? OR EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id=p.id AND pm.user_id=? AND pm.member_type='trusted_developer')
      ORDER BY p.name`,
  )
    .bind(userId, userId, userId)
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
  /** AI cost we carried ourselves: first previews, which the client is not charged for. */
  ourCents: number;
  tickets: number;
}

type UsageRow = {
  user_id: string;
  status: string;
  human_seconds: number;
  ai_micro_usd: number;
  price_cents: number | null;
  first_preview: number;
};

function addUsage(usage: Usage, row: UsageRow): Usage {
  if (row.status === 'declined') return usage;
  // A first preview is ours: it is on the client's account but not on their bill.
  if (row.first_preview === 1) {
    return {
      ...usage,
      ourCents: usage.ourCents + priceOf(meter(row)).aiCents,
      tickets: usage.tickets + 1,
    };
  }
  const p = priceOf(meter(row));
  return {
    billedCents: usage.billedCents + (row.status === 'done' ? (row.price_cents ?? p.totalCents) : 0),
    openCents: usage.openCents + (row.status === 'done' ? 0 : p.totalCents),
    aiCents: usage.aiCents + p.aiCents,
    ourCents: usage.ourCents,
    tickets: usage.tickets + 1,
  };
}

const NO_USAGE: Usage = { billedCents: 0, openCents: 0, aiCents: 0, ourCents: 0, tickets: 0 };

/** Usage per user id; one query for every account, or just one. */
async function usageByUser(env: Env, userId?: string): Promise<Map<string, Usage>> {
  const { results } = await env.DB.prepare(
    `SELECT user_id, status, human_seconds, ai_micro_usd, price_cents, first_preview FROM tickets WHERE kind = 'client'${userId ? ' AND user_id = ?' : ''}`,
  )
    .bind(...(userId ? [userId] : []))
    .all<UsageRow>();
  const out = new Map<string, Usage>();
  for (const row of results ?? []) out.set(row.user_id, addUsage(out.get(row.user_id) ?? NO_USAGE, row));
  return out;
}

/** Hosted sites grouped by project, main site first. */
async function sitesByProject(env: Env, user?: User): Promise<Map<string, SiteRow[]>> {
  const scope = user ? projectScope(user, 's.project_id') : {sql:'1=1',bindings:[]};
  const { results } = await env.DB.prepare(
    `SELECT s.* FROM sites s WHERE ${scope.sql} ORDER BY is_primary DESC, created_at ASC`,
  ).bind(...scope.bindings).all<SiteRow>();
  const out = new Map<string, SiteRow[]>();
  for (const row of results ?? []) out.set(row.project_id, [...(out.get(row.project_id) ?? []), row]);
  return out;
}

async function ticketMessages(env: Env, ticketId: number, includeInternal: boolean) {
  const { results } = await env.DB.prepare(
    `SELECT id, author, body, internal, created_at, lang
       FROM ticket_messages
      WHERE ticket_id = ? ${includeInternal ? '' : 'AND internal = 0'}
      ORDER BY id`,
  )
    .bind(ticketId)
    .all<{ id: number; author: string; body: string; internal: number; created_at: number; lang: string | null }>();
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
  t.project_id, t.site_id, p.name AS project_name, p.slug AS project_slug,
  t.attention, t.human_seconds, t.ai_micro_usd, t.budget_cents, t.price_cents,
  t.kind, t.source, t.priority, t.requires, t.executor, t.worked_by, t.title_en,
  t.first_preview, t.first_preview_done_at, t.assistant_app`;

/**
 * What a client may see of a ticket: their own requests, plus the client
 * requests on the projects Ali attached them to (an invite to a project is
 * access to its history). System work stays Ali's, and a request with no
 * project is private to whoever filed it. Binds: user id, user id.
 */
const VISIBLE_TICKETS = `(t.user_id = ?
  OR (t.kind = 'client' AND t.project_id IN (SELECT project_id FROM user_projects WHERE user_id = ?)))`;

/**
 * Someone else's request on a shared project: the thread is shared, the money
 * is not. Price, time, AI cost and the author's own budget never leave the
 * account that owns the work.
 */
function sharedTicket<T extends Record<string, unknown>>(row: T): T {
  return { ...row, price_cents: null, human_seconds: 0, ai_micro_usd: 0, budget_cents: null };
}

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
 * sent. Client work can pin any executor (Ali approves before a run starts).
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
    void isClient;
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
  // /mcp and /kb-mcp validate Origin themselves as the MCP spec's rebinding
  // guard requires.
  // Preview feedback is called from a preview origin, not the portal, and its
  // site token is the credential; these routes echo their own origin.
  const isPreviewFeedback = path === '/portal/preview-feedback' || path === '/portal/preview-feedback/config';
  const isPortalPath =
    path.startsWith('/auth/') || path.startsWith('/portal/') || path.startsWith('/admin/');

  if (isPortalPath) {
    if (!isPreviewFeedback && o && !isAllowedOrigin(o)) return reply(c, { error: 'origin_not_allowed' }, 403);

    // Preflight must be answered before the auth guards below. A 401 to OPTIONS
    // is a CORS failure, not an auth failure: the browser then refuses the real
    // request, so every signed-in page silently breaks and looks like a dead
    // session.
    if (c.req.method === 'OPTIONS') {
      const headers = new Headers(corsHeaders(o));
      if (isPreviewFeedback && o) {
        headers.set('Access-Control-Allow-Origin', o);
        headers.set('Vary', 'Origin');
      }
      return new Response(null, { status: 204, headers });
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
  // The same email also carries a code, typed into the window that asked
  // (POST /auth/code). The link opens wherever the mail app decides; an
  // assistant's OAuth window can only finish if the person signs in there.
  const code = signinCode();
  await env.DB.prepare('INSERT INTO login_tokens (token_hash, email, expires_at, code_hash) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), email, now() + LINK_TTL_SECONDS, await sha256(`${email}:${code}`))
    .run();

  // Fragment, not query: the token never reaches a server log or a Referer.
  const link = `${siteUrl(env)}/portal/verify#token=${token}`;
  // Their saved language, else the browser's: the email is the first thing they read.
  const known = await env.DB.prepare('SELECT locale, created_at FROM users WHERE email = ?')
    .bind(email)
    .first<{ locale: string; created_at: number }>();
  const tr = tFor(known?.locale ?? fromAcceptLanguage(c.req.header('Accept-Language')));
  // An account from before the move knew the portal as malipetek.dev/portal:
  // say once, in the mail they get anyway, that this sender is the same portal.
  const moved = known && known.created_at < PORTAL_MOVED_AT ? `\n\n${tr('mail.signin.moved')}` : '';
  const sent = await mailClient(env, email, {
    subject: tr('mail.signin.subject'),
    text: `${tr('mail.signin.body', { link })}\n\n${tr('mail.signin.code', { code })}${moved}`,
  });

  // Same answer whether or not the address has an account — no enumeration.
  if (env.DEV_RETURN_LINK === '1') return reply(c, { ok: true, sent, devLink: link, devCode: code });
  if (!sent) return reply(c, { error: 'mail_failed' }, 502);
  return reply(c, { ok: true });
});

portal.post('/auth/verify', async (c) => {
  const env = c.env;
  const body = await readJson<{ token?: unknown }>(c);
  const token = typeof body?.token === 'string' ? body.token : '';
  if (!token || token.length > 100) return reply(c, { error: 'bad_token' }, 400);

  // Single use: claim the token atomically, then read who it was for. An invite
  // token (purpose 'invite', a week long) is claimed exactly the same way.
  const hash = await sha256(token);
  const claimed = await env.DB.prepare(
    `UPDATE login_tokens SET used_at = ?
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
      RETURNING email`,
  )
    .bind(now(), hash, now())
    .first<{ email: string }>();
  if (!claimed) return reply(c, { error: 'link_expired' }, 401);

  return signInAs(c, claimed.email);
});

/** Six digits, uniform (rejection sampling keeps 0–999999 unbiased). */
function signinCode(): string {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < 4_294_000_000) return String(buf[0] % 1_000_000).padStart(6, '0');
  }
}

const CODE_TRIES = 5; // wrong codes per address before its live codes die

/**
 * The address is proven (a link or a code from its inbox): make or find the
 * account and start a session. Shared by /auth/verify and /auth/code.
 */
async function signInAs(c: Ctx, email: string) {
  const env = c.env;
  const role = isAdminEmail(env, email) ? 'admin' : 'client';
  // A new client starts in their browser's language; they can change it in the portal.
  const locale = role === 'client' ? fromAcceptLanguage(c.req.header('Accept-Language')) : 'en-US';
  // A magic link reached this address, so the account is verified from here on.
  // Only a verified account gets the free first preview.
  //
  // The role is only ever raised to admin for an address listed in ADMIN_EMAIL
  // or ADMIN_EMAILS and is never changed for an account that already exists: a
  // magic link proves the address, not the right to promote or demote an
  // account. A second admin therefore needs an env var, never a code change.
  await env.DB.prepare(
    `INSERT INTO users (id, email, role, locale, created_at, verified_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         role = CASE WHEN excluded.role = 'admin' THEN 'admin' ELSE users.role END,
         verified_at = COALESCE(users.verified_at, excluded.verified_at)`,
  )
    .bind(crypto.randomUUID(), email, role, locale, now(), now())
    .run();
  const user = await env.DB.prepare('SELECT id, email, name, role, locale, translation FROM users WHERE email = ?')
    .bind(email)
    .first<User>();
  if (!user) return reply(c, { error: 'user_missing' }, 500);

  const session = await createSession(env, user);

  return reply(c, { session, user });
}

/*
 * Sign in with the code from the email instead of its link, in the window that
 * asked. Each wrong code counts against every live code for the address; at
 * CODE_TRIES they stop working and only the link (or a new email) is left.
 */
portal.post('/auth/code', async (c) => {
  const env = c.env;
  const body = await readJson<{ email?: unknown; code?: unknown }>(c);
  const email = cleanEmail(body?.email);
  const code = typeof body?.code === 'string' ? body.code.replace(/\s+/g, '') : '';
  if (!email || !/^\d{6}$/.test(code)) return reply(c, { error: 'bad_code' }, 400);

  const ip = clientIp(c.req.raw);
  if (
    (await isRateLimited(env, ip, 'auth-code-ip', 20, AUTH_WINDOW_SECONDS)) ||
    (await isRateLimited(env, email, 'auth-code-email', 10, AUTH_WINDOW_SECONDS))
  ) {
    return reply(c, { error: 'rate_limited' }, 429);
  }

  const live = await env.DB.prepare(
    `SELECT token_hash, code_hash FROM login_tokens
      WHERE email = ? AND purpose = 'signin' AND used_at IS NULL AND expires_at > ?
        AND code_hash IS NOT NULL AND code_tries < ?`,
  )
    .bind(email, now(), CODE_TRIES)
    .all<{ token_hash: string; code_hash: string }>();
  const hash = await sha256(`${email}:${code}`);
  const match = (live.results ?? []).find((row) => row.code_hash === hash);
  if (!match) {
    await env.DB.prepare(
      `UPDATE login_tokens SET code_tries = code_tries + 1
        WHERE email = ? AND used_at IS NULL AND code_hash IS NOT NULL`,
    )
      .bind(email)
      .run();
    return reply(c, { error: (live.results ?? []).length ? 'bad_code' : 'code_expired' }, 401);
  }

  // Single use, like the link: the code and its link are the same token.
  const claimed = await env.DB.prepare(
    'UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL RETURNING email',
  )
    .bind(now(), match.token_hash)
    .first<{ email: string }>();
  if (!claimed) return reply(c, { error: 'code_expired' }, 401);
  return signInAs(c, claimed.email);
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

  const session = await createSession(env, user);
  return reply(c, { session, user });
});

/* —— session guard —— */

export const requireUser = async (c: Ctx, next: () => Promise<void>) => {
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
export const requireAdmin = async (c: Ctx, next: () => Promise<void>) => {
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
// Two portal routes are reached without a portal session: Cloudflare's OAuth
// redirect (its signed state says whose it is) and preview feedback (the
// site's token is the credential).
const PUBLIC_PORTAL_PATHS = new Set(['/portal/cloudflare/callback', '/portal/preview-feedback', '/portal/preview-feedback/config']);
portal.use('/portal/*', (c, next) => (PUBLIC_PORTAL_PATHS.has(c.req.path) ? next() : requireUser(c, next)));
portal.use('/portal/agent-tokens', requireBrowser);
portal.use('/portal/agent-tokens/*', requireBrowser);
// Scoped work routes are explicit; unknown/global routes remain super-admin only.
const requireWorkbenchRoute = async (c: Ctx, next: () => Promise<void>) => {
  const path = c.req.path.startsWith('/portal/admin/') ? c.req.path.slice('/portal'.length) : c.req.path;
  if (c.get('viaAgent') || !await authorizeWorkbenchRoute(c.env, c.get('user'), c.req.method, path)) {
    return reply(c, { error: 'forbidden' }, 403);
  }
  return next();
};
portal.use('/admin/*', requireUser, requireWorkbenchRoute);
portal.use('/portal/admin/*', requireWorkbenchRoute);
registerProjectCollaborationRoutes(portal, { sendMail: mailClient });

const integrationCatalog = new Map(INTEGRATION_CATALOG.map(entry => [entry.id, entry]));
const projectSolutions = (env: Env, id: string) => env.DB.prepare('SELECT solutions FROM projects WHERE id = ?').bind(id).first<{ solutions: string }>();
const projectRequires = async (env: Env, id: string) => requiresFor(parseSolutions((await projectSolutions(env, id))?.solutions));
// AWS offers two complete credential sets. The generic catalog helper only
// considers nonoptional fields, so handle the alternatives at the API boundary.
function projectIntegrationStatus(entry: (typeof INTEGRATION_CATALOG)[number], names: Set<string>) {
  if (entry.id !== 'aws') return integrationStatus(entry, names);
  const preferred = ['AWS_ROLE_ARN', 'AWS_EXTERNAL_ID'];
  const alternate = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
  const missingPreferred = preferred.filter(name => !names.has(name));
  const missingAlternate = alternate.filter(name => !names.has(name));
  if (!missingPreferred.length || !missingAlternate.length) return { connected: true, missing: [] };
  return { connected: false, missing: missingAlternate.length < missingPreferred.length ? missingAlternate : missingPreferred };
}
const memberSolutions = (c: Ctx) => c.env.DB.prepare(
  'SELECT p.solutions FROM projects p JOIN user_projects up ON up.project_id = p.id WHERE p.id = ? AND up.user_id = ?',
).bind(c.req.param('id'), c.get('user').id).first<{ solutions: string }>();
async function integrationView(c: Ctx, project: { solutions: string } | null) {
  if (!project) return reply(c, { error: 'not_found' }, 404);
  const solutions = parseSolutions(project.solutions);
  const id = c.req.param('id');
  const [secrets, checks] = await Promise.all([
    c.env.DB.prepare('SELECT name FROM project_secrets WHERE project_id = ?').bind(id).all<{ name: string }>(),
    c.env.DB.prepare('SELECT integration, ok, detail, checked_at FROM project_integration_checks WHERE project_id = ?').bind(id).all<{ integration: string; ok: number; detail: string | null; checked_at: number }>(),
  ]);
  const names = new Set((secrets.results ?? []).map(row => row.name));
  const checked = new Map((checks.results ?? []).map(row => [row.integration, row]));
  c.header('Cache-Control', 'no-store');
  return reply(c, { solutions, integrations: integrationsFor(solutions).map(({ id, optional }) => {
    const entry = integrationCatalog.get(id)!;
    const check = checked.get(id);
    return { id, label: entry.label, required: !optional, ...projectIntegrationStatus(entry, names), verifiedAt: check?.checked_at ?? null, verifyError: check?.ok === 0 ? check.detail : null };
  }) });
}

// The explicit portal paths serve the public contract; the aliases match the workbench conventions.
for (const prefix of ['/portal/admin', '/admin']) {
  portal.get(`${prefix}/solutions`, c => reply(c, { solutions: SOLUTION_CATALOG, integrations: INTEGRATION_CATALOG }));
  portal.put(`${prefix}/projects/:id/solutions`, async c => {
    const body = await readJson<{ solutions?: unknown }>(c);
    if (!Array.isArray(body?.solutions)) return reply(c, { error: 'bad_solutions' }, 400);
    const solutions = cleanSolutions(body.solutions);
    const result = await c.env.DB.prepare('UPDATE projects SET solutions = ? WHERE id = ?')
      .bind(JSON.stringify(solutions), c.req.param('id')).run();
    return result.meta.changes ? reply(c, { ok: true, solutions }) : reply(c, { error: 'not_found' }, 404);
  });
  portal.get(`${prefix}/projects/:id/integrations`, async c => integrationView(c, await projectSolutions(c.env, c.req.param('id'))));
  portal.post(`${prefix}/projects/:id/integrations/:integration/verify`, async c => {
    const id = c.req.param('id'), integration = c.req.param('integration');
    const project = await projectSolutions(c.env, id);
    const entry = integrationCatalog.get(integration);
    if (!project || !entry || !integrationsFor(parseSolutions(project.solutions)).some(ref => ref.id === integration)) {
      return reply(c, { ok: false, error: 'not_found' }, 404);
    }
    if (!c.env.SESSION_SECRET) return reply(c, { ok: false, error: 'secrets_unavailable' }, 503);
    const names = entry.fields.map(field => field.name);
    const rows = (await c.env.DB.prepare(`SELECT name,value_enc FROM project_secrets WHERE project_id = ? AND name IN (${names.map(() => '?').join(', ')}) ORDER BY name`)
      .bind(id, ...names).all<{ name: string; value_enc: string }>()).results ?? [];
    let result: { ok: boolean; error?: string; detail?: string } = { ok: false, error: 'missing_fields' };
    if (projectIntegrationStatus(entry, new Set(rows.map(row => row.name))).connected) {
      try {
        const fields = Object.fromEntries(await Promise.all(rows.map(async row => [row.name, await openProjectSecret(c.env, id, row.name, row.value_enc)] as const)));
        const checked = await verifyIntegration(integration, fields);
        // Never forward exception or response bodies. As a backstop, discard any
        // verifier message that contains an input credential.
        const message = checked.ok ? checked.detail : checked.error;
        const safe = message && !Object.values(fields).some(value => value && message.includes(value)) ? message.slice(0, 512) : undefined;
        result = checked.ok ? { ok: true, detail: safe ?? 'verified' } : { ok: false, error: safe ?? 'verification_failed' };
      } catch {
        result = { ok: false, error: 'verification_failed' };
      }
    }
    // An in-flight check must not restore an old result after credential rotation.
    const recorded = await c.env.DB.prepare(`INSERT INTO project_integration_checks (project_id, integration, ok, detail, checked_at)
      SELECT id, ?, ?, ?, ? FROM projects WHERE id = ? AND solutions = ? AND (
        SELECT json_group_array(json_array(name,value_enc)) FROM (
          SELECT name,value_enc FROM project_secrets WHERE project_id = ? AND name IN (${names.map(() => '?').join(', ')}) ORDER BY name
        )
      ) = ? ON CONFLICT(project_id, integration) DO UPDATE SET ok=excluded.ok, detail=excluded.detail, checked_at=excluded.checked_at`)
      .bind(integration, result.ok ? 1 : 0, result.detail ?? result.error ?? null, now(), id, project.solutions, id, ...names, JSON.stringify(rows.map(row => [row.name, row.value_enc]))).run();
    c.header('Cache-Control', 'no-store');
    return recorded.meta.changes ? reply(c, result) : reply(c, { ok: false, error: 'credentials_changed' }, 409);
  });
}

// The catalog holds no secrets: clients read it to see what each connection needs and how to make one.
portal.get('/portal/solutions', c => reply(c, { solutions: SOLUTION_CATALOG, integrations: INTEGRATION_CATALOG }));
portal.get('/portal/projects/:id/integrations', requireBrowser, async c => integrationView(c, await memberSolutions(c)));
portal.put('/portal/projects/:id/integrations/:integration', requireBrowser,
  bodyLimit({ maxSize: 512 * 1024, onError: c => c.json({ error: 'bad_fields' }, 413) }), async c => {
    const id = c.req.param('id'), integration = c.req.param('integration');
    const project = await memberSolutions(c);
    if (!project || !integrationsFor(parseSolutions(project.solutions)).some(ref => ref.id === integration)) {
      return reply(c, { error: 'not_found' }, 404);
    }
    if (!c.env.SESSION_SECRET) return reply(c, { error: 'secrets_unavailable' }, 503);
    const fields = (await readJson<{ fields?: unknown }>(c))?.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return reply(c, { error: 'bad_fields' }, 400);
    const entries = Object.entries(fields);
    if (!entries.length || entries.some(([name, value]) => !fieldBelongs(integration, name) || typeof value !== 'string' || !value.trim() || value.length > 16384)) {
      return reply(c, { error: 'bad_fields' }, 400);
    }
    const timestamp = now();
    const userId = c.get('user').id;
    const statements = await Promise.all(entries.map(async ([name, value]) => {
      const sealed = await sealProjectSecret(c.env, id, name, value);
      return c.env.DB.prepare(`INSERT INTO project_secrets (project_id, name, value_enc, updated_by, updated_at)
        SELECT p.id, ?, ?, ?, ? FROM projects p JOIN user_projects up ON up.project_id = p.id
        WHERE p.id = ? AND up.user_id = ? AND p.solutions = ?
        ON CONFLICT(project_id, name) DO UPDATE SET value_enc=excluded.value_enc, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
        .bind(name, sealed, userId, timestamp, id, userId, project.solutions);
    }));
    const results = await c.env.DB.batch([...statements, c.env.DB.prepare(`DELETE FROM project_integration_checks
      WHERE project_id = ? AND integration = ? AND EXISTS (
        SELECT 1 FROM projects p JOIN user_projects up ON up.project_id = p.id WHERE p.id = ? AND up.user_id = ? AND p.solutions = ?
      )`).bind(id, integration, id, userId, project.solutions)]);
    results.pop(); // The check may not yet exist; only the credential writes must change rows.
    c.header('Cache-Control', 'no-store');
    return results.every(row => row.meta.changes) ? reply(c, { ok: true }) : reply(c, { error: 'not_found' }, 404);
  });


portal.post('/auth/logout', async (c) => {
  const token = (c.req.header('authorization') ?? '').slice(7);
  await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return reply(c, { ok: true });
});

/* —— device sign-in for the PTech Admin desktop app (custom-scheme PKCE) —— */

/**
 * Open a device authorization. Public and IP rate-limited: the app has not
 * signed anyone in yet and only gets a device code back.
 */
portal.post('/auth/device/start', async (c) => {
  const env = c.env;
  const body = await readJson<{ challenge?: unknown; label?: unknown; state?: unknown }>(c);

  const ip = clientIp(c.req.raw);
  if (await isRateLimited(env, ip, 'device-start', DEVICE_START_LIMIT, AUTH_WINDOW_SECONDS)) {
    return reply(c, { error: 'rate_limited' }, 429);
  }

  const challenge = cleanChallenge(body?.challenge);
  if (!challenge) return reply(c, { error: 'bad_challenge' }, 400);
  const label = cleanDeviceLabel(body?.label);
  if (label === undefined) return reply(c, { error: 'bad_label' }, 400);
  const state = cleanDeviceState(body?.state);
  if (state === undefined) return reply(c, { error: 'bad_state' }, 400);

  const started = await startDevice(env, { challenge, label, state });
  return reply(c, {
    deviceCode: started.deviceCode,
    // The default contract: the browser page needs only the code. `state` is
    // kept server-side and echoed to the app in the approval redirect.
    verificationUrl: `${siteUrl(env)}/portal/device?code=${encodeURIComponent(started.deviceCode)}`,
    expiresAt: started.expiresAt,
  });
});

/**
 * The app's label for the consent page, before anyone signs in. Only the
 * unexpired, unapproved device code's label and window are returned; the code
 * itself is never echoed and is unguessable.
 */
portal.get('/auth/device/info', async (c) => {
  const env = c.env;
  const ip = clientIp(c.req.raw);
  if (await isRateLimited(env, ip, 'device-info', 60, AUTH_WINDOW_SECONDS)) {
    return reply(c, { error: 'rate_limited' }, 429);
  }
  const code = c.req.query('code') ?? '';
  const info = await deviceInfo(env, code);
  if (!info) return reply(c, { error: 'invalid_code' }, 404);
  return reply(c, { label: info.label, expiresAt: info.expiresAt });
});

/**
 * A signed-in portal admin approves the request. This is the only route that
 * mints the one-time code; it is bound to this admin's user id and the app's
 * original challenge, which the app must still prove with its verifier.
 */
portal.use('/portal/device/approve', requireBrowser);
portal.post('/portal/device/approve', async (c) => {
  const user = c.get('user');
  if (!(await accessFor(c.env, user)).canUseWorkbench) return reply(c, { error: 'forbidden' }, 403);

  const body = await readJson<{ deviceCode?: unknown }>(c);
  const deviceCode = typeof body?.deviceCode === 'string' ? body.deviceCode.trim() : '';
  if (!deviceCode) return reply(c, { error: 'bad_device_code' }, 400);

  const approved = await approveDevice(c.env, user, deviceCode);
  if (!approved) return reply(c, { error: 'invalid_code' }, 400);
  return reply(c, { redirect: deviceRedirect(approved.code, approved.state), code: approved.code });
});

/**
 * The app redeems the authorization code with its verifier. Public and IP
 * rate-limited; every failure is the same 401 `invalid_code`, so nothing leaks
 * which check (expiry, reuse, verifier) failed.
 */
portal.post('/auth/device/token', async (c) => {
  const env = c.env;
  const body = await readJson<{ code?: unknown; verifier?: unknown }>(c);

  const ip = clientIp(c.req.raw);
  if (await isRateLimited(env, ip, 'device-token', DEVICE_TOKEN_LIMIT, AUTH_WINDOW_SECONDS)) {
    return reply(c, { error: 'rate_limited' }, 429);
  }

  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  const verifier = typeof body?.verifier === 'string' ? body.verifier : '';
  const user = await exchangeDevice(env, code, verifier);
  if (!user) return reply(c, { error: 'invalid_code' }, 401);

  const session = await createSession(env, user);
  return reply(c, {
    session,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, locale: user.locale ?? null },
    access: await accessFor(env, user),
  });
});

/* —— client —— */

portal.get('/portal/me', async (c) => {
  const user = c.get('user');
  const env = c.env;
  const [projects, slugs, counts, sites, settings, usage, accountRow] = await Promise.all([
    userProjects(env, user.id),
    onlineSlugs(env),
    env.DB.prepare(
      // Every request on the project the account can see, not only the ones it
      // filed: a project's history is shared with everyone attached to it.
      `SELECT t.project_id, count(*) AS n FROM tickets t
        WHERE t.project_id IS NOT NULL AND ${VISIBLE_TICKETS} GROUP BY t.project_id`,
    )
      .bind(user.id, user.id)
      .all<{ project_id: string; n: number }>(),
    sitesByProject(env),
    getSettings(env),
    usageByUser(env, user.id),
    env.DB.prepare('SELECT verified_at, first_preview_at, first_preview_limit_usd FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ verified_at: number | null; first_preview_at: number | null; first_preview_limit_usd: number | null }>(),
  ]);
  const account = accountRow ?? null;
  // The one free first preview: whether this account still has it, and its cap.
  const firstPreviewLimit = limitCentsFor(account?.first_preview_limit_usd ?? null, settings.first_preview_limit_usd);
  const filed = new Map((counts.results ?? []).map((row) => [row.project_id, row.n]));

  // How many times each site has gone live: a building gains a floor per
  // publish, and a rollback takes one away. Older sites published before this
  // table existed fall back to one floor when they have a real production deploy.
  const projectIds = (projects ?? []).map((project) => project.id);
  const publishes = projectIds.length
    ? await env.DB.prepare(
        `SELECT site_id, SUM(CASE WHEN action = 'publish' THEN 1 ELSE -1 END) AS floors
           FROM site_publishes
          WHERE project_id IN (${projectIds.map(() => '?').join(',')})
          GROUP BY site_id`,
      )
        .bind(...projectIds)
        .all<{ site_id: string; floors: number }>()
    : { results: [] as { site_id: string; floors: number }[] };
  const floors = new Map((publishes.results ?? []).map((row) => [row.site_id, Math.max(0, row.floors)]));

  return reply(c, {
    user,
    access: await accessFor(env, user),
    canPublish: settings.clientPublish,
    canConnectAssistant: canUseAssistant(env, user),
    usage: usage.get(user.id) ?? NO_USAGE,
    firstPreview: {
      available: firstPreviewLimit > 0 && account?.verified_at != null && account?.first_preview_at == null,
      limitUsd: firstPreviewLimit / 100,
    },
    projects: (projects ?? []).map((project) => {
      const kind = isProjectKind(project.kind) ? project.kind : 'existing';
      const repoKind = isRepoKind(project.repo_kind) ? project.repo_kind : 'none';
      const rows = sites.get(project.id) ?? [];
      const site = siteView(rows[0], settings.sitesDomain);
      // Adopted hosting, client-safe: no connection id or account id leaves here.
      const target = readDeployTarget(project.deploy_target);
      const deployTarget = target
        ? {
            provider: target.provider,
            kind: target.kind,
            name: target.name,
            productionBranch: target.productionBranch,
            builds: target.builds ?? 'fleet',
          }
        : null;
      return {
        id: project.id,
        slug: project.slug,
        name: project.name,
        kind,
        solutions: parseSolutions(project.solutions),
        repoKind,
        repo: project.repo,
        repoWanted: Boolean(project.repo_wanted),
        repoError: project.repo_error,
        githubInstallationId: project.github_installation_id,
        deployTarget,
        site,
        sites: rows.map((row) => siteView(row, settings.sitesDomain)),
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
          deployTarget,
        }),
      };
    }),
    lanes: (projects ?? []).map((project) => {
      const rows = sites.get(project.id) ?? [];
      // No hosted site yet but the project adopted live hosting: the target is
      // the lane's one live pod.
      if (rows.length === 0) {
        const target = readDeployTarget(project.deploy_target);
        if (target) {
          return {
            id: project.id,
            name: project.name,
            sites: [
              {
                id: `target:${target.kind}:${target.name}`,
                name: target.name,
                url: target.kind === 'pages' ? `https://${target.name}.pages.dev` : null,
                live: true,
                deploys: 1,
              },
            ],
          };
        }
      }
      return {
        id: project.id,
        name: project.name,
        sites: rows.map((row) => {
          const view = siteView(row, settings.sitesDomain);
          const live = Boolean(view?.productionDeploy && view.productionDeploy !== PLACEHOLDER_DEPLOY);
          return {
            id: view?.id ?? row.id,
            name: view?.name || project.name,
            url: view?.productionUrl ?? null,
            live,
            deploys: Math.max(floors.get(row.id) ?? 0, live ? 1 : 0),
          };
        }),
      };
    }),
  });
});

portal.patch('/portal/me', async (c) => {
  const body = await readJson<{ name?: unknown; locale?: unknown; translation?: unknown }>(c);
  const id = c.get('user').id;
  const updates: D1PreparedStatement[] = [];
  if (body?.name !== undefined) {
    const name = body.name === '' ? null : cleanText(body.name, MAX_NAME_CHARS);
    if (name === null && body.name !== '') return reply(c, { error: 'bad_name' }, 400);
    updates.push(c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, id));
  }
  const language = cleanLanguage(body);
  if ('error' in language) return reply(c, { error: language.error }, 400);
  if (language.locale) updates.push(c.env.DB.prepare('UPDATE users SET locale = ? WHERE id = ?').bind(language.locale, id));
  if (language.translation) updates.push(c.env.DB.prepare('UPDATE users SET translation = ? WHERE id = ?').bind(language.translation, id));
  if (updates.length) await c.env.DB.batch(updates);
  return reply(c, { ok: true, ...language });
});

/** locale / translation from a settings body; each optional, each checked. */
function cleanLanguage(body: { locale?: unknown; translation?: unknown } | null) {
  const out: { locale?: string; translation?: TranslationEngine } = {};
  if (body?.locale !== undefined) {
    const locale = closestLocale(body.locale);
    if (!locale) return { error: 'bad_locale' };
    out.locale = locale;
  }
  if (body?.translation !== undefined) {
    if (!TRANSLATION_ENGINES.includes(body.translation as TranslationEngine)) return { error: 'bad_translation' };
    out.translation = body.translation as TranslationEngine;
  }
  return out;
}

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
  if (!canUseAssistant(env, user)) return reply(c, { error: 'clients_only' }, 400);
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
/** Whether an address on malipetek.online is still free, while the client types it. */
portal.get('/portal/site-address', async (c) => {
  const raw = c.req.query('slug') ?? '';
  const slug = cleanSiteSlug(raw);
  if (!slug) return reply(c, { available: false, slug: raw, reason: 'bad' });
  return reply(c, { available: await siteSlugFree(c.env, slug), slug });
});

/**
 * Create a project from the setup form, and file the first request against it.
 *
 * The form now chooses the three things that used to be guessed: the site's
 * address, where the code lives (our org, their GitHub, or a repo they named),
 * and where it is hosted (ours or their Cloudflare account). A new project's
 * site starts here rather than waiting for a second button on another page.
 */
portal.post('/portal/projects', async (c) => {
  const env = c.env;
  const user = c.get('user');
  const body = await readJson<{
    kind?: unknown;
    name?: unknown;
    brief?: unknown;
    repoKind?: unknown;
    repoMode?: unknown;
    repo?: unknown;
    repoSource?: unknown;
    installationId?: unknown;
    siteSlug?: unknown;
    host?: unknown;
    connectionId?: unknown;
    accountId?: unknown;
    attention?: unknown;
    budgetCents?: unknown;
  }>(c);

  const kind = isProjectKind(body?.kind) ? body.kind : null;
  const name = cleanText(body?.name, MAX_NAME_CHARS);
  if (!kind || !name) return reply(c, { error: 'bad_project' }, 400);

  const brief = cleanBrief(body?.brief, kind);
  if (!brief) return reply(c, { error: 'bad_brief' }, 400);

  // Where the code comes from. `repoKind` is the old form; `repoMode` adds
  // "create it for me" and "in my GitHub account" as first-class choices.
  const mode =
    body?.repoMode === 'none' || body?.repoMode === 'create' || body?.repoMode === 'repo' || body?.repoMode === 'zip'
      ? body.repoMode
      : body?.repoKind === 'repo' || body?.repoKind === 'zip'
        ? body.repoKind
        : kind === 'new'
          ? 'create'
          : 'none';
  const repoKind = mode === 'repo' ? 'repo' : mode === 'zip' ? 'zip' : 'none';
  const repo = mode === 'repo' ? cleanRepo(body?.repo) : null;
  if (mode === 'repo' && !repo) return reply(c, { error: 'bad_repo' }, 400);

  const attention = body?.attention === undefined ? DEFAULT_ATTENTION : cleanAttention(body.attention);
  const budget = cleanBudget(body?.budgetCents);
  if (!attention || budget === false) return reply(c, { error: 'bad_ticket' }, 400);

  if (await isRateLimited(env, user.id, 'project', MAX_PROJECTS_PER_DAY, 24 * 60 * 60)) {
    return reply(c, { error: 'rate_limited' }, 429);
  }

  const t = now();
  const id = crypto.randomUUID();
  const slug = await uniqueSlug(env, name);
  const repoWanted = mode === 'create' ? 1 : 0;
  const creatorAccess = await accessFor(env, user);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO projects (id, slug, name, kind, brief, repo, repo_kind, repo_wanted, created_by, owner_user_id, onboarded_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, slug, name, kind, JSON.stringify(brief), repo, repoKind, repoWanted, user.id, user.id, t, t),
      env.DB.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').bind(user.id, id),
      ...(creatorAccess.developerProjectIds.length ? [env.DB.prepare(
        `INSERT INTO project_memberships (project_id,user_id,member_type,granted_by,created_at) VALUES (?,?,'trusted_developer',?,?)`,
      ).bind(id,user.id,user.id,t)] : []),
    ]);
  } catch {
    return reply(c, { error: 'slug_taken' }, 409);
  }

  // A repo in the client's own GitHub account, when they asked for one.
  let repoOutcome: string | null = null;
  let repoError: string | null = null;
  if (mode === 'create' && body?.repoSource === 'github') {
    const wantedInstall = Number(body?.installationId);
    const installation =
      Number.isInteger(wantedInstall) && wantedInstall > 0
        ? await env.DB.prepare('SELECT id, account_login FROM github_installations WHERE id = ? AND user_id = ?')
            .bind(wantedInstall, user.id)
            .first<{ id: number; account_login: string }>()
        : await env.DB.prepare('SELECT id, account_login FROM github_installations WHERE user_id = ? ORDER BY account_login LIMIT 1')
            .bind(user.id)
            .first<{ id: number; account_login: string }>();
    if (!installation) {
      repoError = 'Connect GitHub first, then choose “create it in my account”.';
    } else {
      try {
        const out = await useClientRepo(env, { id, slug }, installation);
        repoOutcome = out.outcome;
      } catch (error) {
        repoError = (error as Error)?.message ?? 'Could not create the repo.';
        await env.DB.prepare('UPDATE projects SET repo_error = ? WHERE id = ?')
          .bind(`github: ${repoError}`.slice(0, 300), id)
          .run();
      }
    }
  } else if (mode === 'repo' && repo) {
    const owner = repo.split('github.com/')[1]?.split('/')[0] ?? '';
    const installation = await env.DB.prepare(
      'SELECT id FROM github_installations WHERE user_id = ? AND lower(account_login) = lower(?)',
    )
      .bind(user.id, owner)
      .first<{ id: number }>();
    if (installation) {
      await env.DB.prepare('UPDATE projects SET github_installation_id = ? WHERE id = ?').bind(installation.id, id).run();
      try {
        await ensureRepo(env, id);
      } catch (error) {
        repoError = (error as Error)?.message ?? 'Could not reach the repo.';
        await env.DB.prepare('UPDATE projects SET repo_error = ? WHERE id = ?')
          .bind(`github: ${repoError}`.slice(0, 300), id)
          .run();
      }
    }
  }

  // A "new" project's first request is the build itself; an existing one's is
  // the read-only first look, which is safe to run before any change is agreed.
  const title = (kind === 'new' ? `Build ${name}` : `First look: ${name}`).slice(0, MAX_TITLE_CHARS);
  const text = `Set up from the onboarding form.\n\n${briefText(brief, kind)}`;
  const ticket = await env.DB.prepare(
    `INSERT INTO tickets (user_id, project_id, title, status, attention, budget_cents, requires, created_at, updated_at)
     VALUES (?, ?, ?, 'new', ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(user.id, id, title, attention, budget ?? null, JSON.stringify(await projectRequires(env, id)), t, t)
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

  // The first request of a project follows the same Autopilot rule.
  await maybeAutoApprove(env, ticket.id);

  c.executionCtx.waitUntil(
    notifyAliOfClientMessage(env, { id: ticket.id, title, client_email: user.email }, text, true),
  );

  return reply(
    c,
    {
      project: { id, slug, name, kind, repoKind, repo, brief },
      ticketId: ticket.id,
      repoOutcome,
      repoError,
    },
    201,
  );
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

/** A grant the caller owns, and one of its accounts: the target for a site. */
async function cloudflareTarget(
  c: Ctx,
  body: { connectionId?: unknown; accountId?: unknown } | null,
): Promise<{ connectionId: number; accountId: string } | { error: string }> {
  const user = c.get('user');
  const wanted = Number(body?.connectionId);
  const connection =
    Number.isInteger(wanted) && wanted > 0
      ? await connectionRow(c.env, wanted)
      : await c.env.DB.prepare(
          'SELECT * FROM cloudflare_connections WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1',
        )
          .bind(user.id)
          .first<{ id: number; user_id: string; accounts: string }>();
  if (!connection || connection.user_id !== user.id) return { error: 'no_cloudflare' };
  const accounts = grantedAccounts(connection);
  const wantedAccount = typeof body?.accountId === 'string' ? body.accountId : '';
  const account = accounts.find((a) => a.id === wantedAccount) ?? accounts[0];
  if (!account) return { error: 'no_cloudflare_account' };
  return { connectionId: connection.id, accountId: account.id };
}

const siteError = (c: Ctx, error: unknown) => {
  const code = (error as { error?: string })?.error ?? '';
  if (code === 'not_found' || code === 'not_ready' || code === 'unknown_deploy') {
    return reply(c, { error: code }, code === 'unknown_deploy' ? 400 : 409);
  }
  return reply(c, { error: 'site', message: (error as Error)?.message ?? 'The site could not be set up.' }, 502);
};

/**
 * Set up the hosted site for a project we build: a slug on ptechsolutions.dev,
 * a placeholder page at once, then a fleet node makes the source repo. Only a
 * "new" project gets one: an existing stack is the client's to bring, with
 * its own credentials.
 */
/**
 * Add a site under a project. The first is the project's main site; later ones
 * are extra addresses that share the project's code.
 */
portal.post('/portal/projects/:id/site', async (c) => {
  const project = await ownProject(c);
  if (!project) return reply(c, { error: 'not_found' }, 404);
  const user = c.get('user');
  if (await isRateLimited(c.env, user.id, 'site', MAX_SITE_STARTS_PER_DAY, 24 * 60 * 60)) {
    return reply(c, { error: 'rate_limited' }, 429);
  }
  const body = await readJson<{
    name?: unknown;
    siteSlug?: unknown;
    host?: unknown;
    connectionId?: unknown;
    accountId?: unknown;
  }>(c);
  const rawSlug = typeof body?.siteSlug === 'string' ? body.siteSlug : '';
  const wanted = rawSlug ? cleanSiteSlug(rawSlug) : null;
  if (rawSlug && !wanted) return reply(c, { error: 'bad_slug' }, 400);
  if (wanted && !(await siteSlugFree(c.env, wanted))) return reply(c, { error: 'slug_taken' }, 409);
  let host: SiteHost = 'ours';
  let connectionId: number | null = null;
  let accountId: string | null = null;
  if (body?.host === 'cloudflare') {
    const target = await cloudflareTarget(c, body);
    if ('error' in target) return reply(c, { error: target.error }, 400);
    host = 'cloudflare';
    connectionId = target.connectionId;
    accountId = target.accountId;
  }
  try {
    const site = await startSite(c.env, user, project, {
      name: typeof body?.name === 'string' ? body.name : null,
      siteSlug: wanted,
      host,
      connectionId,
      accountId,
    });
    const { sitesDomain } = await getSettings(c.env);
    return reply(c, { site: siteView(site, sitesDomain) }, 201);
  } catch (error) {
    return siteError(c, error);
  }
});

/** Delete one of the client's own sites. */
portal.delete('/portal/projects/:id/site', async (c) => {
  const project = await ownProject(c);
  if (!project) return reply(c, { error: 'not_found' }, 404);
  const body = await readJson<{ siteId?: unknown }>(c);
  if (typeof body?.siteId !== 'string' || !body.siteId) return reply(c, { error: 'bad_site' }, 400);
  const out = await deleteSite(c.env, project.id, body.siteId);
  if ('error' in out) return reply(c, out, out.error === 'not_found' ? 404 : 409);
  return reply(c, { ok: true });
});

/** Every site under a project, main first. */
portal.get('/portal/projects/:id/sites', async (c) => {
  const project = await ownProject(c);
  if (!project) return reply(c, { error: 'not_found' }, 404);
  const { sitesDomain } = await getSettings(c.env);
  return reply(c, { sites: (await getSites(c.env, project.id)).map((row) => siteView(row, sitesDomain)) });
});

/** Move a site between our hosting and the client's Cloudflare account. */
portal.post('/portal/projects/:id/site/host', async (c) => {
  const project = await ownProject(c);
  if (!project) return reply(c, { error: 'not_found' }, 404);
  const body = await readJson<{ host?: unknown; connectionId?: unknown; accountId?: unknown; siteId?: unknown }>(c);
  if (body?.host !== 'ours' && body?.host !== 'cloudflare') return reply(c, { error: 'bad_host' }, 400);
  let target: { id: number; accountId: string } | null = null;
  if (body.host === 'cloudflare') {
    const found = await cloudflareTarget(c, body);
    if ('error' in found) return reply(c, { error: found.error }, 400);
    target = { id: found.connectionId, accountId: found.accountId };
  }
  const site = await setSiteHost(
    c.env,
    project.id,
    body.host,
    target,
    typeof body?.siteId === 'string' ? body.siteId : null,
  );
  if (!site) return reply(c, { error: 'not_found' }, 404);
  const { sitesDomain } = await getSettings(c.env);
  return reply(c, { site: siteView(site, sitesDomain) });
});

/** Where one site has got to. Asking moves it forward, at most every few seconds. */
portal.get('/portal/projects/:id/site', async (c) => {
  const project = await ownProject(c);
  if (!project) return reply(c, { error: 'not_found' }, 404);
  const { sitesDomain } = await getSettings(c.env);
  const siteId = c.req.query('siteId') ?? null;
  let site = siteId ? await getSiteById(c.env, siteId) : await getSite(c.env, project.id);
  if (site && site.project_id !== project.id) return reply(c, { error: 'not_found' }, 404);
  if (site && site.state !== 'ready' && site.state !== 'failed' && now() - site.updated_at >= 4) {
    site = await advanceSite(c.env, project.id, site.id);
  }
  return reply(c, { site: siteView(site, sitesDomain) });
});

type AssistantChange = { id: number; title: string; status: string; assistant_app: string | null; review_skipped_at: number | null };

/**
 * Put a publish or rollback on record: who did it, how (the portal, or the
 * assistant app holding their token), and — for a publish — which changes the
 * client's assistant made went live without a review. Those requests get a
 * line in their thread saying so, and Ali is emailed when it was not him.
 */
async function recordPublish(
  c: Ctx,
  project: { id: string; name: string | null },
  out: { productionUrl: string; siteId: string; deployId: string | null },
  action: 'publish' | 'rollback',
): Promise<{ unreviewed: AssistantChange[] }> {
  const env = c.env;
  const user = c.get('user');
  const via = c.get('viaAgent') ? await agentApp(c) : 'portal';
  const t = now();
  const changes =
    action === 'publish'
      ? ((
          await env.DB.prepare(
            `SELECT id, title, status, assistant_app, review_skipped_at FROM tickets
              WHERE project_id = ? AND source = 'assistant' AND preview_built_at IS NOT NULL
                AND published_at IS NULL AND status <> 'declined'`,
          )
            .bind(project.id)
            .all<AssistantChange>()
        ).results ?? [])
      : [];
  // Reviewed means Ali closed it after review; anything else is the client's own call.
  const unreviewed = changes.filter((ch) => ch.status !== 'done' || ch.review_skipped_at !== null);
  const by = `${user.email}${via === 'portal' ? '' : ` via ${via}`}`;
  const statements = [
    env.DB.prepare(
      `INSERT INTO site_publishes (site_id, project_id, deploy_id, action, user_id, actor, role, via, unreviewed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(out.siteId, project.id, out.deployId, action, user.id, user.email, user.role, via, JSON.stringify(unreviewed.map((ch) => ch.id)), t),
    ...changes.flatMap((ch) => [
      env.DB.prepare('UPDATE tickets SET published_at = ? WHERE id = ?').bind(t, ch.id),
      env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 0, ?)`).bind(
        ch.id,
        unreviewed.includes(ch)
          ? `Published to production by ${by}, without a review. Taking it live unreviewed was the client’s decision.`
          : `Published to production by ${by}.`,
        t,
      ),
    ]),
  ];
  await env.DB.batch(statements);

  if (user.role !== 'admin') {
    const name = project.name ?? project.id;
    const lines =
      action === 'rollback'
        ? [`${by} rolled ${name} back to deploy ${out.deployId ?? '?'}.`, out.productionUrl]
        : [
            `${by} published the preview of ${name} to production.`,
            out.productionUrl,
            ...(unreviewed.length
              ? ['', 'Changes their assistant made that went live without your review:', ...unreviewed.map((ch) => `  #${ch.id} ${ch.title} (${ch.assistant_app ?? 'assistant'}) — ${siteUrl(env)}/portal/admin#ticket=${ch.id}`)]
              : []),
          ];
    c.executionCtx.waitUntil(
      mailAli(env, {
        subject: `${name} ${action === 'rollback' ? 'was rolled back' : 'was published'} by ${by}${unreviewed.length ? ` (${unreviewed.length} unreviewed)` : ''}`,
        text: lines.join('\n'),
      }),
    );
  }
  return { unreviewed };
}

/**
 * Publish the preview to production, when Ali lets clients do that (the
 * `clientPublish` setting). Off by default: then only Ali publishes.
 */
portal.post('/portal/projects/:id/site/publish', async (c) => {
  const project = await ownProject(c);
  if (!project) return reply(c, { error: 'not_found' }, 404);
  if (!(await getSettings(c.env)).clientPublish) return reply(c, { error: 'forbidden' }, 403);
  const body = await readJson<{ siteId?: unknown }>(c);
  try {
    const out = await publishSite(c.env, project.id, typeof body?.siteId === 'string' ? body.siteId : null);
    if ('error' in out) return siteError(c, out);
    const record = await recordPublish(c, { id: project.id, name: project.name }, out, 'publish');
    return reply(c, {
      ok: true,
      productionUrl: out.productionUrl,
      unreviewed: record.unreviewed.map((t) => ({ id: t.id, title: t.title })),
      ...(out.cloudflareError ? { cloudflareError: out.cloudflareError } : {}),
    });
  } catch (error) {
    return siteError(c, error);
  }
});

/** Roll production back to an older deploy, when Ali lets clients do that. */
portal.post('/portal/projects/:id/site/rollback', async (c) => {
  const project = await ownProject(c);
  if (!project) return reply(c, { error: 'not_found' }, 404);
  if (!(await getSettings(c.env)).clientPublish) return reply(c, { error: 'forbidden' }, 403);
  const body = await readJson<{ deployId?: unknown; siteId?: unknown }>(c);
  const out = await rollbackSite(
    c.env,
    project.id,
    typeof body?.deployId === 'string' ? body.deployId : '',
    typeof body?.siteId === 'string' ? body.siteId : null,
  );
  if ('error' in out) return siteError(c, out);
  await recordPublish(c, { id: project.id, name: project.name }, out, 'rollback');
  return reply(c, {
    ok: true,
    productionUrl: out.productionUrl,
    ...(out.cloudflareError ? { cloudflareError: out.cloudflareError } : {}),
  });
});

/** One site's deploy history, newest first. */
portal.get('/portal/projects/:id/site/deploys', async (c) => {
  const project = await ownProject(c);
  if (!project) return reply(c, { error: 'not_found' }, 404);
  const siteId = c.req.query('siteId') ?? null;
  return reply(c, { deploys: await listDeploys(c.env, project.id, 50, siteId) });
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
  const who = c.get('viaAgent') ? await agentApp(c) : 'Your agent';
  const paths = cleaned.files.map((f) => f.path);
  const listed = paths.slice(0, 12).join(', ') + (paths.length > 12 ? `, and ${paths.length - 12} more` : '');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE tickets SET worked_by = 'client_agent', updated_at = ? WHERE id = ?`).bind(t, ticket.id),
    c.env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 0, ?)`)
      .bind(ticket.id, `${who} sent a change (${paths.length} file${paths.length === 1 ? '' : 's'}): ${listed}.`, t),
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

/** The app an agent token came from — "ChatGPT", from its OAuth registration — or the token's label. */
async function agentApp(c: Ctx): Promise<string> {
  const token = (c.req.header('authorization') ?? '').slice(7);
  const row = await c.env.DB.prepare(
    `SELECT o.client_name AS app, a.label FROM agent_tokens a
       LEFT JOIN oauth_clients o ON o.client_id = a.oauth_client_id WHERE a.token_hash = ?`,
  )
    .bind(await sha256(token))
    .first<{ app: string | null; label: string | null }>();
  return row?.app || row?.label || 'The client’s assistant';
}

/**
 * The client's own assistant (ChatGPT on their subscription) changes their
 * project itself. Each change is a request of its own, source 'assistant', so
 * there is always a record of who changed what. No approval and no fleet run:
 * a node claims only `approved`, and this starts `in_progress` worked by the
 * client's agent, so it carries no AI cost. Review is the client's choice
 * afterwards (`/finish`).
 */
portal.post('/portal/changes', async (c) => {
  if (!c.get('viaAgent')) return reply(c, { error: 'agents_only' }, 403);
  const env = c.env;
  const user = c.get('user');
  const body = await readJson<{ projectId?: unknown; title?: unknown; summary?: unknown }>(c);
  const title = cleanText(body?.title, MAX_TITLE_CHARS);
  const summary = cleanText(body?.summary, 4000);
  if (!title || !summary) return reply(c, { error: 'bad_change' }, 400);
  const projectId = typeof body?.projectId === 'string' ? body.projectId : '';
  const linked = projectId
    ? await env.DB.prepare('SELECT 1 FROM user_projects WHERE user_id = ? AND project_id = ?').bind(user.id, projectId).first()
    : null;
  if (!linked) return reply(c, { error: 'bad_project' }, 400);
  if (!(await getSite(env, projectId))) return reply(c, { error: 'not_hosted' }, 400);
  if (await isRateLimited(env, user.id, 'ticket', TICKET_LIMIT, TICKET_WINDOW_SECONDS)) {
    return reply(c, { error: 'rate_limited' }, 429);
  }
  const app = await agentApp(c);
  const t = now();
  const ticket = await env.DB.prepare(
    `INSERT INTO tickets (user_id, project_id, title, status, attention, kind, worked_by, source, assistant_app, requires, created_at, updated_at)
     VALUES (?, ?, ?, 'in_progress', 'auto', 'client', 'client_agent', 'assistant', ?, ?, ?, ?) RETURNING id`,
  )
    .bind(user.id, projectId, title, app, JSON.stringify(await projectRequires(env, projectId)), t, t)
    .first<{ id: number }>();
  if (!ticket) return reply(c, { error: 'insert_failed' }, 500);
  await env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 0, ?)`)
    .bind(ticket.id, `${app} is making this change itself, on the client’s own subscription, so there is no AI cost.\n\n${summary}`, t)
    .run();
  return reply(c, { id: ticket.id, status: 'in_progress', by: app }, 201);
});

/**
 * The client decides about a change their assistant made: send it to Ali for
 * review (paid, by his time), or keep it as it is (closed, nothing to bill).
 */
portal.post('/portal/changes/:id/finish', async (c) => {
  const env = c.env;
  const user = c.get('user');
  const ticket = await env.DB.prepare(
    `SELECT id, title, status, source, build_requested_at FROM tickets WHERE id = ? AND user_id = ? AND kind = 'client'`,
  )
    .bind(Number(c.req.param('id')) || -1, user.id)
    .first<{ id: number; title: string; status: string; source: string; build_requested_at: number | null }>();
  if (!ticket || ticket.source !== 'assistant') return reply(c, { error: 'not_found' }, 404);
  if (ticket.status !== 'in_progress') return reply(c, { error: 'already_decided', status: ticket.status }, 409);
  if (ticket.build_requested_at) return reply(c, { error: 'still_building' }, 409);
  const body = await readJson<{ review?: unknown }>(c);
  if (typeof body?.review !== 'boolean') return reply(c, { error: 'bad_choice' }, 400);
  const t = now();
  const app = c.get('viaAgent') ? await agentApp(c) : 'Their assistant';
  if (body.review) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE tickets SET status = 'review', attention = 'checked', updated_at = ? WHERE id = ?`).bind(t, ticket.id),
      env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 0, ?)`)
        .bind(ticket.id, `Sent for review. Ali reads the change before it goes live; the review is billed as his time.`, t),
    ]);
    c.executionCtx.waitUntil(
      mailAli(env, {
        subject: `[#${ticket.id}] Review asked by ${user.email}: ${ticket.title}`,
        text: ticketMail(
          `${app} made this change for ${user.email} and they want it reviewed.`,
          `Open: ${siteUrl(env)}/portal/admin#ticket=${ticket.id}`,
        ),
        replyTo: await replyAddress(env, ticket.id, 'a'),
      }),
    );
    return reply(c, { ok: true, status: 'review' });
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE tickets SET status = 'done', review_skipped_at = ?, updated_at = ? WHERE id = ?`).bind(t, t, ticket.id),
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 0, ?)`)
      .bind(ticket.id, `Kept without review. ${app} made this change; there is nothing to bill.`, t),
  ]);
  c.executionCtx.waitUntil(
    mailAli(env, {
      subject: `[#${ticket.id}] ${user.email} kept ${app}’s change without review: ${ticket.title}`,
      text: ticketMail(
        `${app} made this change for ${user.email}, and they chose not to have it reviewed. It is on the preview; they can publish it themselves.`,
        `Open: ${siteUrl(env)}/portal/admin#ticket=${ticket.id}`,
      ),
      replyTo: await replyAddress(env, ticket.id, 'a'),
    }),
  );
  return reply(c, { ok: true, status: 'done', canPublish: (await getSettings(env)).clientPublish });
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
  const workspace = ticket.project_id ? await workspaceFor(c.env, ticket.project_id) : null;
  if (!workspace) return reply(c, { error: 'not_hosted' }, 404);
  const file = ticket.project_id ? await workspaceRead(c.env, ticket.project_id, path) : null;
  if (!file) return reply(c, { error: 'file_not_found' }, 404);
  return reply(c, file);
});

portal.get('/portal/tickets', async (c) => {
  const user = c.get('user');
  // `unread`: Ali (or a status change) said something the client has not opened
  // yet. It is a per-ticket mark, so it only means anything on their own rows.
  // `mine`: the caller filed it; another client's request on a shared project
  // is visible, but read-only and without its bill.
  const { results } = await c.env.DB.prepare(
    `SELECT ${TICKET_COLUMNS},
            (SELECT count(*) FROM ticket_runs r WHERE r.ticket_id = t.id) AS run_count,
            (SELECT min(r.started_at) FROM ticket_runs r WHERE r.ticket_id = t.id AND r.status = 'running') AS run_started_at,
            (SELECT max(r.finished_at) FROM ticket_runs r WHERE r.ticket_id = t.id AND r.status <> 'running') AS run_finished_at,
            (t.user_id = ?) AS mine,
            (t.user_id = ? AND EXISTS (SELECT 1 FROM ticket_messages m
                     WHERE m.ticket_id = t.id AND m.internal = 0
                       AND (m.author IN ('ali', 'system') OR (t.kind = 'intake' AND m.author = 'runner'))
                       AND m.created_at > COALESCE(t.client_seen_at, t.created_at))) AS unread
       FROM tickets t LEFT JOIN projects p ON p.id = t.project_id
      WHERE ${VISIBLE_TICKETS} ORDER BY t.updated_at DESC`,
  )
    .bind(user.id, user.id, user.id, user.id)
    .all<Record<string, unknown> & { mine: number }>();
  return reply(c, {
    tickets: (results ?? []).map((row) => (row.mine ? { ...row, mine: true } : { ...sharedTicket(row), mine: false })),
  });
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
        intake: fields.intake === true || fields.intake === 'true',
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

  // A request with no project cannot be claimed by a fleet node. It becomes
  // an intake ticket: the Worker's setup assistant works it, creates the
  // project/site/repo the client described, and files the real work (which
  // still needs Ali's approval).
  const intake = !projectId || body?.intake === true;
  const filedBy = c.get('viaAgent') ? await agentApp(c) : null;
  const t = now();
  const ticket = await env.DB.prepare(
    `INSERT INTO tickets (user_id, project_id, title, status, attention, budget_cents, kind, worked_by, assistant_app, requires, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      user.id,
      intake ? null : projectId,
      title,
      intake ? 'in_progress' : 'new',
      attention,
      budget ?? null,
      intake ? 'intake' : 'client',
      intake ? 'client_agent' : 'fleet',
      // Which assistant filed it (MCP key or ChatGPT), for the client's start
      // page. Only a label: source stays 'portal', so review is never skipped.
      filedBy,
      JSON.stringify(!intake && projectId ? await projectRequires(env, projectId) : []),
      t,
      t,
    )
    .first<{ id: number }>();
  if (!ticket) return reply(c, { error: 'insert_failed' }, 500);
  const stored = await postMessage(env, ticket.id, 'client', text, false, files.uploads, t);
  // Autopilot + a budget under the cap: start without waiting for Ali.
  const autoApproved = intake ? false : await maybeAutoApprove(env, ticket.id);

  const ref = { id: ticket.id, title, client_email: user.email, client_locale: user.locale };
  c.executionCtx.waitUntil(
    Promise.all([
      relayClientMessage(env, ref, stored.messageId, text, stored, true),
      confirmTicketToClient(env, ref),
      ...(intake ? [runIntake(env, ticket.id)] : []),
    ]),
  );
  return reply(c, { id: ticket.id, files: stored, intake, autoApproved }, 201);
});

/* ——————————————————————— preview feedback ——————————————————————— */

/**
 * A request filed from a preview site by the widget the preview host injects.
 *
 * The caller is not on the portal origin, so there is no session: the site's
 * `feedback_token` in the form body is the credential. It only allows filing a
 * request for that one site's project — nothing is read back except the new
 * ticket's own id, and the ticket still waits for Ali's approval like any
 * other client request.
 *
 * Multipart body: `token`, `body`, optional `page`, `viewport`, `files`.
 * CORS is echoed for this route only: a preview lives on another origin
 * (ptechsolutions.dev, workers.dev or the client's own domain). Since the token
 * travels in the body and no cookie is read, echoing the origin grants nothing.
 */
const PREVIEW_FEEDBACK_LIMIT = 8;
const PREVIEW_FEEDBACK_WINDOW_SECONDS = 60 * 60;

interface FeedbackSite {
  id: string;
  project_id: string;
  name: string | null;
  state: string;
  project_name: string;
}

interface FeedbackClient {
  id: string;
  email: string;
  name: string | null;
  locale: string | null;
}

/** The site a token belongs to and the client who owns its project. */
async function feedbackTarget(env: Env, token: string): Promise<{ site: FeedbackSite; client: FeedbackClient } | null> {
  const site = await env.DB.prepare(
    `SELECT s.id, s.project_id, s.name, s.state, p.name AS project_name
       FROM sites s JOIN projects p ON p.id = s.project_id
      WHERE s.feedback_token = ?`,
  )
    .bind(token)
    .first<FeedbackSite>();
  if (!site || site.state !== 'ready') return null;
  const client = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.locale
       FROM user_projects up JOIN users u ON u.id = up.user_id
      WHERE up.project_id = ? AND u.role = 'client'
      ORDER BY u.created_at ASC LIMIT 1`,
  )
    .bind(site.project_id)
    .first<FeedbackClient>();
  return client ? { site, client } : null;
}

/**
 * A preview route's answer: JSON with the caller's own origin echoed. The
 * portal's `reply()` only allows malipetek.dev, and a preview is elsewhere.
 */
function previewReply(c: Ctx, data: unknown, status = 200): Response {
  const requestOrigin = c.req.header('Origin') ?? null;
  const res = json(data, status, null);
  if (requestOrigin) {
    res.headers.set('Access-Control-Allow-Origin', requestOrigin);
    res.headers.set('Vary', 'Origin');
  }
  return res;
}

/** `pathname + search` of the page the note was made on, without the token. */
function previewPage(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 2000) return null;
  try {
    const url = new URL(value);
    url.searchParams.delete('mf');
    const path = `${url.pathname}${url.search}`;
    return path.length > 300 ? path.slice(0, 300) : path;
  } catch {
    return null;
  }
}

/**
 * The widget's copy, in the client's own language. It is fetched once by the
 * preview page; the token says which client, and so which locale. A locale
 * that has not been translated yet falls back to English string by string.
 */
portal.get('/portal/preview-feedback/config', async (c) => {
  const token = c.req.query('token') ?? '';
  if (!/^[a-f0-9]{32,64}$/.test(token)) return previewReply(c, { error: 'signed_out' }, 401);
  const target = await feedbackTarget(c.env, token);
  if (!target) return previewReply(c, { error: 'unknown_site' }, 404);
  const locale = target.client.locale || 'en-US';
  return previewReply(c, { locale, strings: previewStrings(locale) });
});

portal.post('/portal/preview-feedback', async (c) => {
  const env = c.env;
  const out = (data: unknown, status = 200) => previewReply(c, data, status);

  const msg = await readMessage(c);
  if (msg === 'too_large') return out({ error: 'file_too_large' }, 413);
  if (!msg) return out({ error: 'bad_request' }, 400);

  const token = typeof msg.fields.token === 'string' ? msg.fields.token : '';
  if (!/^[a-f0-9]{32,64}$/.test(token)) return out({ error: 'signed_out' }, 401);

  const target = await feedbackTarget(env, token);
  if (!target) return out({ error: 'unknown_site' }, 404);
  const { site, client } = target;

  if (await isRateLimited(env, clientIp(c.req.raw), 'preview-feedback', PREVIEW_FEEDBACK_LIMIT, PREVIEW_FEEDBACK_WINDOW_SECONDS)) {
    return out({ error: 'rate_limited' }, 429);
  }

  if (msg.text.length > MAX_BODY_CHARS) return out({ error: 'bad_ticket' }, 400);
  const text = msg.text;
  if (msg.files.length && !env.FILES) return out({ error: 'files_unavailable' }, 503);
  const checked = checkUploads(msg.files, 0);
  if (!checked.ok) return out({ error: checked.error, name: checked.name }, checked.error === 'file_too_large' ? 413 : 400);
  if (!text && !checked.uploads.length) return out({ error: 'empty' }, 400);

  const audio = checked.uploads.find((file) => isAudioType(file.type));
  const transcript = audio ? await transcribe(env, audio.data, audio.type) : null;

  const siteName = site.name || site.project_name;
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean);
  const title = (firstLine ? firstLine.slice(0, 120) : `Feedback on the preview of ${siteName}`).slice(0, MAX_TITLE_CHARS);

  let body = text;
  if (transcript) body = body ? `${body}\n\nVoice note transcript:\n${transcript}` : `Voice note transcript:\n${transcript}`;
  if (!body) body = audio ? 'Voice note attached.' : 'See the attached screenshot.';

  const t = now();
  const ticket = await env.DB.prepare(
    `INSERT INTO tickets (user_id, project_id, site_id, title, status, attention, kind, worked_by, requires, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'new', ?, 'client', 'fleet', ?, ?, ?) RETURNING id`,
  )
    .bind(client.id, site.project_id, site.id, title, DEFAULT_ATTENTION, JSON.stringify(await projectRequires(env, site.project_id)), t, t)
    .first<{ id: number }>();
  if (!ticket) return out({ error: 'insert_failed' }, 500);

  const stored = await postMessage(env, ticket.id, 'client', body, false, checked.uploads, t);
  const page = previewPage(msg.fields.page);
  const viewport = typeof msg.fields.viewport === 'string' && /^\d{2,5}x\d{2,5}$/.test(msg.fields.viewport) ? msg.fields.viewport : null;
  const where = page ? ` — ${page}${viewport ? ` (${viewport})` : ''}` : '';
  await env.DB.prepare(
    `INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'system', ?, ?)`,
  )
    .bind(ticket.id, `Filed from the preview of ${siteName}${where}.`, t)
    .run();

  const ref = { id: ticket.id, title, client_email: client.email, client_locale: client.locale };
  c.executionCtx.waitUntil(
    Promise.all([relayClientMessage(env, ref, stored.messageId, body, stored, true), confirmTicketToClient(env, ref)]),
  );
  return out({ ticketId: ticket.id, url: `${siteUrl(env)}/portal/ticket#id=${ticket.id}`, transcript }, 201);
});

/**
 * Load a ticket the caller may see: their own, any ticket for the admin, or a
 * client request on a project they are attached to. Only the author may act on
 * it (write, withdraw, set a budget); every caller checks `user_id` for that.
 */
async function loadTicket(c: Ctx, admin: boolean) {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return null;
  const ticket = await c.env.DB.prepare(
    `SELECT ${TICKET_COLUMNS}, t.user_id, u.email AS client_email, u.name AS client_name, u.locale AS client_locale
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
       JOIN users u ON u.id = t.user_id
      WHERE t.id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown> & Meter & { id: number; user_id: string; client_email: string; client_locale: string | null; title_en: string | null; title: string; status: Status; attention: string; kind: string; project_id: string | null }>();
  if (!ticket) return null;
  if (admin) return isSuperAdmin(c.get('user')) || await canWorkProject(c.env,c.get('user'),ticket.project_id) ? ticket : null;
  if (ticket.user_id === c.get('user').id) return ticket;
  // Another client's request is readable when it is a client request on a
  // project they share. Nothing else is.
  if (ticket.kind !== 'client' || !ticket.project_id) return null;
  const linked = await c.env.DB.prepare('SELECT 1 FROM user_projects WHERE user_id = ? AND project_id = ?')
    .bind(c.get('user').id, ticket.project_id)
    .first();
  return linked ? ticket : null;
}

portal.get('/portal/tickets/:id', async (c) => {
  const ticket = await loadTicket(c, false);
  if (!ticket) return reply(c, { error: 'not_found' }, 404);
  const { user_id, client_email: __, client_locale: ___, ...rest } = ticket;
  const mine = user_id === c.get('user').id;
  // Another client's request: the thread is visible, its bill is not.
  const visible = mine ? rest : sharedTicket(rest);
  const messages = await threadFor(c.env, ticket.id, await ticketMessages(c.env, ticket.id, false), 'client', (p) =>
    c.executionCtx.waitUntil(p),
  );
  // The unread mark belongs to the author, so another reader leaves it alone.
  if (mine) c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE tickets SET client_seen_at = ? WHERE id = ?').bind(now(), ticket.id).run());
  // An intake ticket hands off to the real request it filed: the newest
  // file_request action names the spawned ticket, when there is one.
  let spawnedTicket: { id: number; title: string; status: string; first_preview: number | null; project_id: string | null } | null = null;
  if (ticket.kind === 'intake') {
    const action = await c.env.DB.prepare(
      `SELECT result_json FROM ticket_actions WHERE ticket_id = ? AND action = 'file_request' ORDER BY id DESC LIMIT 1`,
    )
      .bind(ticket.id)
      .first<{ result_json: string }>();
    let childId: number | null = null;
    try {
      const result = action?.result_json ? (JSON.parse(action.result_json) as { ticket?: { id?: unknown } }) : null;
      if (typeof result?.ticket?.id === 'number') childId = result.ticket.id;
    } catch {
      /* a malformed action row reads as no spawned ticket */
    }
    if (childId !== null) {
      spawnedTicket =
        (await c.env.DB.prepare('SELECT id, title, status, first_preview, project_id FROM tickets WHERE id = ? AND user_id = ?')
          .bind(childId, user_id)
          .first<{ id: number; title: string; status: string; first_preview: number | null; project_id: string | null }>()) ?? null;
    }
  }
  return reply(c, { ticket: { ...visible, mine }, spawnedTicket, messages: await withFiles(c.env, ticket.id, messages, false) });
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
  // A shared project shows the thread; only the client who filed it writes in it.
  if (ticket.user_id !== c.get('user').id) return reply(c, { error: 'not_author' }, 403);
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
  c.executionCtx.waitUntil(
    Promise.all([
      relayClientMessage(env, ticket, stored.messageId, msg.text, stored, false),
      ...(ticket.kind === 'intake' ? [runIntake(env, ticket.id)] : []),
    ]),
  );
  return reply(c, { ok: true, files: stored, messageId: stored.messageId }, 201);
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
  // Withdrawing is the author's call, never a project-mate's.
  if (ticket.user_id !== c.get('user').id) return reply(c, { error: 'not_author' }, 403);
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

/**
 * Move a client's request to another of their projects (and optionally one of
 * that project's sites). A run in progress refuses the move: it holds a
 * worktree of the old project.
 */
portal.patch('/portal/tickets/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await readJson<{ projectId?: unknown; siteId?: unknown }>(c);
  if (typeof body?.projectId !== 'string' || !body.projectId) return reply(c, { error: 'bad_project' }, 400);
  const siteId = typeof body?.siteId === 'string' && body.siteId ? body.siteId : null;
  const out = await moveTicket(c.env, c.get('user').id, id, body.projectId, siteId);
  if ('error' in out) {
    return reply(c, out, out.error === 'not_found' ? 404 : out.error === 'in_progress' ? 409 : 400);
  }
  return reply(c, { ok: true, status: out.status });
});

/** Move one of the client's sites to another of their projects. */
portal.patch('/portal/sites/:id', async (c) => {
  const body = await readJson<{ projectId?: unknown }>(c);
  if (typeof body?.projectId !== 'string' || !body.projectId) return reply(c, { error: 'bad_project' }, 400);
  const out = await moveSite(c.env, c.get('user').id, c.req.param('id'), body.projectId);
  if ('error' in out) return reply(c, out, out.error === 'not_found' ? 404 : 400);
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
  // The budget is the author's, and its meter is private to them.
  if (ticket.user_id !== c.get('user').id) return reply(c, { error: 'not_author' }, 403);
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
  const scope = projectScope(c.get('user'));
  const row = await c.env.DB.prepare(
    `SELECT
       (SELECT count(*) FROM tickets t WHERE t.status = 'new' AND ${scope.sql}) AS approve,
       (SELECT count(*) FROM tickets t WHERE t.status = 'review' AND ${scope.sql}) AS review,
       (SELECT count(*) FROM tickets t WHERE t.client_waiting_since IS NOT NULL AND t.status NOT IN ('new', 'done', 'declined') AND ${scope.sql}) AS waiting,
       (SELECT count(*) FROM ticket_runs r JOIN tickets t ON t.id=r.ticket_id WHERE r.status = 'running' AND ${scope.sql}) AS running`,
  ).bind(...scope.bindings, ...scope.bindings, ...scope.bindings, ...scope.bindings).first<{ approve: number; review: number; waiting: number; running: number }>();
  return reply(c, row ?? { approve: 0, review: 0, waiting: 0, running: 0 });
});

portal.get('/admin/tickets', async (c) => {
  const status = c.req.query('status');
  const filter = status && (STATUSES as readonly string[]).includes(status) ? status : null;
  const projectId = c.req.query('projectId');
  if (projectId && !await canWorkProject(c.env, c.get('user'), projectId)) return reply(c, { error: 'forbidden' }, 403);
  const scope = projectScope(c.get('user'));
  const { results } = await c.env.DB.prepare(
    `SELECT ${TICKET_COLUMNS}, u.email AS client_email, u.name AS client_name
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
       JOIN users u ON u.id = t.user_id
      WHERE ${scope.sql} ${filter ? 'AND t.status = ?' : ''} ${projectId ? 'AND t.project_id = ?' : ''}
      ORDER BY (t.status = 'new') DESC, t.updated_at DESC
      LIMIT 200`,
  )
    .bind(...scope.bindings, ...(filter ? [filter] : []), ...(projectId ? [projectId] : []))
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
  const scope = projectScope(c.get('user'));
  const { results } = await c.env.DB.prepare(
    `SELECT m.ticket_id AS id, max(m.id) AS mid, m.body
       FROM ticket_messages m JOIN tickets t ON t.id = m.ticket_id
      WHERE m.body LIKE ? ESCAPE '\\'
      AND ${scope.sql} GROUP BY m.ticket_id
      ORDER BY mid DESC LIMIT 50`,
  )
    .bind(like, ...scope.bindings)
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
    messages: await withFiles(
      c.env,
      ticket.id,
      await threadFor(c.env, ticket.id, await ticketMessages(c.env, ticket.id, true), 'ali', (p) => c.executionCtx.waitUntil(p)),
      true,
    ),
    runs: await ticketRuns(c.env, ticket.id),
    review: await latestReview(c.env, ticket.id),
    screenshots: await screenshotsFor(c.env, ticket.id, siteUrl(c.env)),
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
    siteId?: unknown;
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

  if (projectId !== undefined && !isSuperAdmin(c.get('user')) && !await canWorkProject(env, c.get('user'), projectId)) return reply(c, { error: 'forbidden' }, 403);
  const effectiveProject = projectId !== undefined ? projectId : ticket.project_id;
  let siteId: string | null | undefined;
  if (body?.siteId !== undefined) {
    if (body.siteId === null || body.siteId === '') siteId = null;
    else if (typeof body.siteId === 'string') {
      const site = await env.DB.prepare('SELECT 1 FROM sites WHERE id = ? AND project_id = ?')
        .bind(body.siteId, effectiveProject)
        .first();
      if (!site) return reply(c, { error: 'bad_site' }, 400);
      siteId = body.siteId;
    } else return reply(c, { error: 'bad_site' }, 400);
  } else if (projectId !== undefined && projectId !== ticket.project_id) {
    // A site belongs to one project; keep it only when it is the same project.
    siteId = null;
  }

  const t = now();
  const statements = [];
  if (projectId !== undefined) {
    statements.push(env.DB.prepare('UPDATE tickets SET project_id = ?, updated_at = ? WHERE id = ?').bind(projectId, t, ticket.id));
  }
  if (siteId !== undefined) {
    statements.push(env.DB.prepare('UPDATE tickets SET site_id = ?, updated_at = ? WHERE id = ?').bind(siteId, t, ticket.id));
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
  // A first preview freezes at zero: it is ours, whatever the meter says.
  const finalMeter = { humanSeconds: humanSeconds ?? ticket.human_seconds, aiMicroUsd: ticket.ai_micro_usd };
  const firstPreview = ticket.first_preview === 1;
  const finalBill = billOf({ ...finalMeter, firstPreview });
  const bill = statusChanged && status === 'done' && !firstPreview ? priceLine(finalMeter) : undefined;
  if (statusChanged) {
    statements.push(
      // The client is mailed about it, so it answers them too.
      env.DB.prepare('UPDATE tickets SET status = ?, price_cents = ?, updated_at = ?, client_waiting_since = NULL WHERE id = ?')
        .bind(status, status === 'done' ? finalBill.totalCents : null, t, ticket.id),
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
  if (!internal && ticket.kind === 'client') c.executionCtx.waitUntil(relayAliReply(env, ticket, stored.messageId, msg.text, stored));
  return reply(c, { ok: true, files: stored, messageId: stored.messageId }, 201);
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

  // A content cycle reads its outbox from the summary; nothing about it may
  // fail the report of a run that already closed.
  if (!done.late) await finishContentCycle(c.env, id, report.summary, report.ok).catch(() => {});
  // An SEO cycle ticket reads the same block, keyed on its own ticket column.
  if (!done.late) await finishSeoCycle(c.env, id, report.summary, report.ok).catch(() => {});
  // A guide cycle ticket reads it for the guide's PR.
  if (!done.late) await finishGuideCycle(c.env, id, report.summary, report.ok).catch(() => {});

  if (!done.late) c.executionCtx.waitUntil(completeFirstPreview(c.env, id));
  c.executionCtx.waitUntil(notifyRunFinished(c.env, id, report, done));
  return reply(c, { ok: true, costMicroUsd: done.costMicroUsd, review: 'pending' });
});

/** The fleet: what is running now, and what ran recently. */
portal.get('/admin/runs', async (c) => {
  const scope = projectScope(c.get('user'));
  const select = `SELECT r.id, r.ticket_id, r.executor, r.model, r.status, r.cost_micro_usd, r.started_at, r.finished_at,
    r.node_id, r.lease_expires_at, r.attempt, r.cancel_requested, r.session_id, r.session_dir, r.session_log,
    t.title, t.status AS ticket_status, p.slug, t.project_id
    FROM ticket_runs r JOIN tickets t ON t.id=r.ticket_id LEFT JOIN projects p ON p.id=t.project_id`;
  const [active, latest] = await Promise.all([
    c.env.DB.prepare(`${select} WHERE ${scope.sql} AND r.status='running' ORDER BY r.started_at`).bind(...scope.bindings).all(),
    c.env.DB.prepare(`${select} WHERE ${scope.sql} ORDER BY r.id DESC LIMIT 40`).bind(...scope.bindings).all(),
  ]);
  const running = active.results ?? [];
  const recent = latest.results ?? [];
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

/** A signed screenshot URL for <img>: no session header needed, expires in an hour. */
portal.get('/shot/:runId/:kind', async (c) => {
  const runId = Number(c.req.param('runId'));
  const kind = c.req.param('kind');
  const token = c.req.query('t') ?? '';
  if (!Number.isInteger(runId) || runId <= 0 || (kind !== 'before' && kind !== 'after')) {
    return c.json({ error: 'not_found' }, 404);
  }
  if (!(await verifyShotToken(c.env, runId, kind, token))) return c.json({ error: 'not_found' }, 404);
  const res = await screenshotResponse(c.env, runId, kind);
  return res ?? c.json({ error: 'not_found' }, 404);
});

/** The health page: every check, its last result and when it last changed. */
portal.get('/admin/health', async (c) => reply(c, await healthView(c.env)));

/** Run every check now, mail any transition, and return the fresh page. */
portal.post('/admin/health/run', async (c) => {
  const run = await runAndNotifyHealth(c.env);
  return reply(c, { ...(await healthView(c.env)), fresh: run.fresh.length, recovered: run.recovered.length });
});

/** System-wide settings, plus the catalogs the views build their buttons from. */
portal.get('/admin/settings', async (c) =>
  reply(c, { settings: await getSettings(c.env), catalog: { capabilities: CAPABILITY_CATALOG, executors: EXECUTOR_CATALOG, solutions: SOLUTION_CATALOG, integrations: INTEGRATION_CATALOG } }),
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
      ? await env.DB.prepare('SELECT id, solutions FROM projects WHERE id = ?').bind(body.projectId).first<{ id: string; solutions: string }>()
      : typeof body?.slug === 'string'
        ? await env.DB.prepare('SELECT id, solutions FROM projects WHERE slug = ?').bind(body.slug.trim().toLowerCase()).first<{ id: string; solutions: string }>()
        : null;
  if (!project) return reply(c, { error: 'bad_project' }, 400);
  if (!await canWorkProject(env, c.get('user'), project.id)) return reply(c, { error: 'forbidden' }, 403);

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
      JSON.stringify(routing.requires ?? requiresFor(parseSolutions(project.solutions))),
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

/* —— invites: add a client to existing projects before they sign up —— */

/** The primary admin's name as the invite mail says it; Ali unless one is set. */
async function inviterName(env: Env): Promise<string> {
  const email = primaryAdminEmail(env);
  const row = email ? await env.DB.prepare('SELECT name FROM users WHERE email = ?').bind(email).first<{ name: string | null }>() : null;
  return row?.name?.trim() || 'Ali';
}

/** The projects an account is attached to, cheapest form. */
async function inviteProjects(env: Env, userId: string): Promise<{ id: string; name: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.name FROM user_projects up JOIN projects p ON p.id = up.project_id
      WHERE up.user_id = ? ORDER BY p.name`,
  )
    .bind(userId)
    .all<{ id: string; name: string }>();
  return results ?? [];
}

/**
 * Mint an invite token (SHA-256 stored, raw token only in the mailed fragment)
 * and mail it. The caller keeps the account and the project links even when
 * the send fails, so the UI can offer a resend.
 */
async function sendInvite(
  env: Env,
  to: { email: string; locale: string | null; added: boolean; projectNames: string[]; note?: string | null },
  invitedBy: string,
): Promise<{ expiresAt: number; sent: boolean; link: string }> {
  const token = randomToken();
  const expiresAt = now() + INVITE_TTL_SECONDS;
  await env.DB.prepare(
    `INSERT INTO login_tokens (token_hash, email, expires_at, purpose, invited_by) VALUES (?, ?, ?, 'invite', ?)`,
  )
    .bind(await sha256(token), to.email, expiresAt, invitedBy)
    .run();
  // Fragment, not query: the token never reaches a server log or a Referer.
  const link = `${siteUrl(env)}/portal/verify#token=${token}`;
  const mail = inviteMail(to.locale, {
    name: await inviterName(env),
    project: joinProjectNames(to.projectNames),
    link,
    added: to.added,
    note: to.note ?? null,
  });
  const sent = await mailClient(env, to.email, mail);
  return { expiresAt, sent, link };
}

portal.get('/admin/clients', async (c) => {
  const [{ results }, usage] = await Promise.all([
    c.env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.role, u.handoff, u.locale, u.translation, u.created_at,
              u.verified_at, u.first_preview_at, u.first_preview_limit_usd, u.invited_at, u.invited_by,
              (SELECT max(expires_at) FROM login_tokens lt
                WHERE lt.email = u.email AND lt.purpose = 'invite' AND lt.used_at IS NULL) AS invite_expires_at,
              (SELECT group_concat(project_id) FROM user_projects WHERE user_id = u.id) AS project_ids,
              (SELECT count(*) FROM tickets WHERE user_id = u.id) AS ticket_count
         FROM users u ORDER BY u.created_at DESC`,
    ).all<Record<string, unknown> & { id: string; project_ids: string | null; verified_at: number | null; invited_at: number | null }>(),
    usageByUser(c.env),
  ]);
  const clients = results.map(({ project_ids, first_preview_limit_usd, invite_expires_at, invited_at, ...rest }) => ({
    ...rest,
    projectIds: project_ids ? project_ids.split(',') : [],
    // Dollars, like the setting; null means the account follows the setting.
    firstPreviewLimitUsd: typeof first_preview_limit_usd === 'number' ? first_preview_limit_usd : null,
    // An invite is pending until the account is first verified; its link may
    // still be live after that (until it is used or expires), which is why the
    // expiry is reported separately.
    invitedAt: invited_at,
    pending: invited_at !== null && rest.verified_at === null,
    inviteExpiresAt: typeof invite_expires_at === 'number' ? invite_expires_at : null,
    usage: usage.get(rest.id) ?? NO_USAGE,
  }));
  // Everything owed across all clients, for the top of the Directory.
  const total = [...usage.values()].reduce(
    (a, u) => ({
      billedCents: a.billedCents + u.billedCents,
      openCents: a.openCents + u.openCents,
      aiCents: a.aiCents + u.aiCents,
      ourCents: a.ourCents + u.ourCents,
      tickets: a.tickets + u.tickets,
    }),
    NO_USAGE,
  );
  return reply(c, { clients, total });
});

/** What the admin UI needs about an invite, without the token. */
function inviteView(env: Env, invite: { expiresAt: number; sent: boolean; link: string }) {
  return {
    expiresAt: invite.expiresAt,
    sent: invite.sent,
    // Local dev and the e2e suite read the link the mail would carry.
    ...(env.DEV_RETURN_LINK === '1' ? { devLink: invite.link } : {}),
  };
}

/**
 * Invite a client to existing projects. The account is made if the address is
 * new (role client, the language Ali picked); an existing account keeps its
 * role, name and language and only gains the projects. Either way it gets a
 * week-long link, and the links stay even if the mail cannot be sent.
 */
portal.post('/admin/clients', async (c) => {
  const env = c.env;
  const body = await readJson<{ email?: unknown; name?: unknown; locale?: unknown; projectIds?: unknown; note?: unknown; copy?: unknown }>(c);
  const email = cleanEmail(body?.email);
  if (!email) return reply(c, { error: 'bad_email' }, 400);
  // Any admin address is refused, not only the primary one: an invite must
  // never be the way a second admin account gets made or renamed.
  if (isAdminEmail(env, email)) return reply(c, { error: 'admin_email' }, 400);

  const name = body?.name === undefined || body.name === '' ? null : cleanText(body.name, MAX_NAME_CHARS);
  if (name === null && body?.name !== undefined && body.name !== '') return reply(c, { error: 'bad_name' }, 400);
  const language = cleanLanguage({ locale: body?.locale });
  if ('error' in language) return reply(c, { error: language.error }, 400);
  const note = body?.note === undefined || body.note === '' ? null : cleanText(body.note, 1000);
  if (note === null && body?.note !== undefined && body.note !== '') return reply(c, { error: 'bad_note' }, 400);

  // One or more existing projects: an invite with nothing behind it is a bug.
  const ids = Array.isArray(body?.projectIds)
    ? [...new Set(body.projectIds.filter((id): id is string => typeof id === 'string' && id !== ''))]
    : [];
  if (!ids.length) return reply(c, { error: 'bad_projects' }, 400);
  const found = await env.DB.prepare(`SELECT id, name FROM projects WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ id: string; name: string }>();
  const byId = new Map((found.results ?? []).map((project) => [project.id, project.name]));
  if (byId.size !== ids.length) return reply(c, { error: 'bad_project' }, 400);
  const projectNames = ids.map((id) => byId.get(id) ?? '');

  const t = now();
  const inserted = await env.DB.prepare(
    `INSERT INTO users (id, email, name, role, locale, created_at, invited_at, invited_by)
     VALUES (?, ?, ?, 'client', ?, ?, ?, ?)
     ON CONFLICT(email) DO NOTHING`,
  )
    .bind(crypto.randomUUID(), email, name, language.locale ?? 'en-US', t, t, c.get('user').id)
    .run();

  const user = await env.DB.prepare(
    'SELECT id, email, name, role, locale, verified_at, invited_at, invited_by FROM users WHERE email = ?',
  )
    .bind(email)
    .first<{ id: string; email: string; name: string | null; role: string; locale: string | null; verified_at: number | null; invited_at: number | null; invited_by: string | null }>();
  if (!user) return reply(c, { error: 'user_missing' }, 500);
  // Never grant admin, and never touch an existing account's role, name or
  // language: only the project links and the invite bookkeeping change.
  if (user.role === 'admin' || isAdminEmail(env, user.email)) return reply(c, { error: 'admin_email' }, 400);

  await env.DB.batch([
    env.DB.prepare('UPDATE users SET invited_at = COALESCE(invited_at, ?), invited_by = COALESCE(invited_by, ?) WHERE id = ?')
      .bind(t, c.get('user').id, user.id),
    ...ids.map((projectId) =>
      env.DB.prepare('INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)').bind(user.id, projectId),
    ),
    // Copies only ever turn on here; turning them off is the link's own switch.
    ...(body?.copy === true
      ? ids.map((projectId) =>
          env.DB.prepare('UPDATE user_projects SET copy_mail = 1 WHERE user_id = ? AND project_id = ?').bind(user.id, projectId),
        )
      : []),
  ]);

  const invite = await sendInvite(
    env,
    {
      email: user.email,
      locale: user.locale,
      added: user.verified_at !== null,
      projectNames,
      note,
    },
    c.get('user').id,
  );
  const fresh = await env.DB.prepare(
    'SELECT id, email, name, role, locale, verified_at, invited_at, invited_by FROM users WHERE id = ?',
  )
    .bind(user.id)
    .first();
  return reply(
    c,
    { user: fresh, projects: await inviteProjects(env, user.id), invite: inviteView(env, invite) },
    (inserted.meta.changes ?? 0) > 0 ? 201 : 200,
  );
});

/** Send the invite again: the old unused links stop working first. */
portal.post('/admin/clients/:userId/invite', async (c) => {
  const env = c.env;
  const user = await env.DB.prepare('SELECT id, email, name, role, locale, verified_at FROM users WHERE id = ?')
    .bind(c.req.param('userId'))
    .first<{ id: string; email: string; name: string | null; role: string; locale: string | null; verified_at: number | null }>();
  if (!user || user.role !== 'client' || isAdminEmail(env, user.email)) return reply(c, { error: 'not_found' }, 404);
  const projects = await inviteProjects(env, user.id);
  if (!projects.length) return reply(c, { error: 'no_projects' }, 409);
  await env.DB.prepare(`DELETE FROM login_tokens WHERE email = ? AND purpose = 'invite' AND used_at IS NULL`)
    .bind(user.email)
    .run();
  const invite = await sendInvite(
    env,
    {
      email: user.email,
      locale: user.locale,
      added: user.verified_at !== null,
      projectNames: projects.map((project) => project.name),
    },
    c.get('user').id,
  );
  return reply(c, { ok: true, invite: inviteView(env, invite) });
});

/** Revoke every unused invite link. A live session is not touched. */
portal.delete('/admin/clients/:userId/invite', async (c) => {
  const env = c.env;
  const user = await env.DB.prepare('SELECT id, email, role FROM users WHERE id = ?')
    .bind(c.req.param('userId'))
    .first<{ id: string; email: string; role: string }>();
  if (!user || user.role !== 'client' || isAdminEmail(env, user.email)) return reply(c, { error: 'not_found' }, 404);
  const res = await env.DB.prepare(`DELETE FROM login_tokens WHERE email = ? AND purpose = 'invite' AND used_at IS NULL`)
    .bind(user.email)
    .run();
  return reply(c, { ok: true, revoked: res.meta.changes ?? 0 });
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
  if (p.repo && p.repo_error) return { state: 'failed', detail: `Nodes cannot clone ${p.repo}: ${p.repo_error}` };
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
  const scope = projectScope(c.get('user'), 'p.id');
  const ticketScope = projectScope(c.get('user'));
  const [{ sitesDomain }, projects, slugs, counts, sites, installations, links] = await Promise.all([
    getSettings(c.env),
    c.env.DB.prepare(
      `SELECT p.id, p.slug, p.name, p.kind, p.brief, p.repo, p.repo_kind, p.repo_wanted, p.repo_error, p.repo_claim_node, p.repo_claim_at,
              p.github_installation_id, p.created_by, p.owner_user_id, p.onboarded_at, p.created_at, p.solutions,
              u.email AS owner_email
         FROM projects p LEFT JOIN users u ON u.id = p.owner_user_id WHERE ${scope.sql} ORDER BY p.name`,
    ).bind(...scope.bindings).all<ProjectRow & { repo_wanted: number; repo_error: string | null; repo_claim_node: string | null; repo_claim_at: number | null; github_installation_id: number | null } & { owner_email: string | null }>(),
    onlineSlugs(c.env),
    c.env.DB.prepare(
      `SELECT project_id, count(*) AS n FROM tickets t WHERE project_id IS NOT NULL AND ${ticketScope.sql} GROUP BY project_id`,
    ).bind(...ticketScope.bindings).all<{ project_id: string; n: number }>(),
    sitesByProject(c.env, c.get('user')),
    c.env.DB.prepare(`SELECT i.id, i.user_id, i.account_login FROM github_installations i WHERE EXISTS (
      SELECT 1 FROM projects p WHERE ${scope.sql} AND (p.github_installation_id=i.id OR p.owner_user_id=i.user_id OR EXISTS(SELECT 1 FROM user_projects up WHERE up.project_id=p.id AND up.user_id=i.user_id)))`).bind(...scope.bindings).all<{
      id: number;
      user_id: string | null;
      account_login: string;
    }>(),
    c.env.DB.prepare(
      `SELECT up.project_id, up.copy_mail, u.id, u.email, u.name, u.invited_at, u.verified_at
         FROM user_projects up JOIN users u ON u.id = up.user_id JOIN projects p ON p.id=up.project_id WHERE ${scope.sql} ORDER BY u.email`,
    ).bind(...scope.bindings).all<{ project_id: string; copy_mail: number; id: string; email: string; name: string | null; invited_at: number | null; verified_at: number | null }>(),
  ]);
  const filed = new Map((counts.results ?? []).map((row) => [row.project_id, row.n]));
  const installationsById = new Map((installations.results ?? []).map((row) => [row.id, row]));
  const installationsByUser = new Map(
    (installations.results ?? []).filter((row) => row.user_id).map((row) => [row.user_id as string, row]),
  );
  const usersByProject = new Map<string, string[]>();
  const clientsByProject = new Map<string, { id: string; email: string; name: string | null; pending: boolean; copy: boolean }[]>();
  for (const link of links.results ?? []) {
    usersByProject.set(link.project_id, [...(usersByProject.get(link.project_id) ?? []), link.id]);
    clientsByProject.set(link.project_id, [
      ...(clientsByProject.get(link.project_id) ?? []),
      {
        id: link.id,
        email: link.email,
        name: link.name,
        pending: link.invited_at !== null && link.verified_at === null,
        copy: link.copy_mail === 1,
      },
    ]);
  }

  // The same setup the client sees, so the admin view is not guessing at it.
  return reply(c, {
    projects: (projects.results ?? []).map((project) => {
      const kind = isProjectKind(project.kind) ? project.kind : 'existing';
      const repoKind = isRepoKind(project.repo_kind) ? project.repo_kind : 'none';
      const brief = parseBrief(project.brief);
      const rows = sites.get(project.id) ?? [];
      const site = siteView(rows[0], sitesDomain);
      // For a project never linked, offer the installation of a client who is
      // linked to it: that is the account the repo can now be created in.
      const clientInstallation = (usersByProject.get(project.id) ?? [])
        .map((userId) => installationsByUser.get(userId))
        .find(Boolean);
      const installation = project.github_installation_id
        ? installationsById.get(project.github_installation_id)
        : clientInstallation;
      return {
        ...project,
        solutions: parseSolutions(project.solutions),
        brief,
        kind,
        repoKind,
        site,
        sites: rows.map((row) => siteView(row, sitesDomain)),
        githubAccount: installation?.account_login ?? null,
        githubInstallationId: project.github_installation_id ?? clientInstallation?.id ?? null,
        // Who can see this project: the clients Ali linked to it.
        clients: clientsByProject.get(project.id) ?? [],
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

/** The interface translations: the last run, and whether one is asked for or under way. */
portal.get('/admin/i18n', async (c) => reply(c, await i18nStatus(c.env)));

/** The auto switch: off (the default) means translations only run from the button. */
portal.put('/admin/i18n', async (c) => {
  const body = await readJson<{ auto?: unknown }>(c);
  if (typeof body?.auto !== 'boolean') return reply(c, { error: 'bad_auto' }, 400);
  await setI18nAuto(c.env, body.auto);
  return reply(c, await i18nStatus(c.env));
});

/** Translate now: the next five-minute tick translates what is missing and commits it to master. */
portal.post('/admin/i18n/sync', async (c) => {
  const status = await i18nStatus(c.env);
  if (!status.ready) return reply(c, { error: 'not_configured' }, 409);
  await requestI18nSync(c.env);
  return reply(c, await i18nStatus(c.env));
});

/** Move any site to another project (Ali's view). */
portal.patch('/admin/sites/:id', async (c) => {
  const site = await c.env.DB.prepare('SELECT id, project_id, is_primary FROM sites WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ id: string; project_id: string; is_primary: number }>();
  if (!site) return reply(c, { error: 'not_found' }, 404);
  const body = await readJson<{ projectId?: unknown }>(c);
  if (typeof body?.projectId !== 'string' || !body.projectId) return reply(c, { error: 'bad_project' }, 400);
  const target = await c.env.DB.prepare('SELECT 1 FROM projects WHERE id = ?').bind(body.projectId).first();
  if (!target) return reply(c, { error: 'bad_project' }, 400);
  if (!await canWorkProject(c.env, c.get('user'), body.projectId)) return reply(c, { error: 'forbidden' }, 403);
  if (site.project_id !== body.projectId) {
    const old = site.project_id;
    await c.env.DB.prepare('UPDATE sites SET project_id = ?, is_primary = 0, updated_at = ? WHERE id = ?')
      .bind(body.projectId, now(), site.id)
      .run();
    if (site.is_primary === 1) await promotePrimary(c.env, old);
    await promotePrimary(c.env, body.projectId);
  }
  return reply(c, { ok: true });
});

/** Retry a stopped site: back to allocating, so whatever it waited for is tried again. */
portal.post('/admin/projects/:id/site/retry', async (c) => {
  const env = c.env;
  const body = await readJson<{ siteId?: unknown }>(c);
  const site =
    typeof body?.siteId === 'string' && body.siteId
      ? await getSiteById(env, body.siteId)
      : await getSite(env, c.req.param('id'));
  if (!site || site.project_id !== c.req.param('id')) return reply(c, { error: 'not_found' }, 404);
  await env.DB.prepare(
    `UPDATE sites SET state = 'allocating', error = NULL, failure_alerted_at = NULL, created_at = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(now(), now(), site.id)
    .run();
  const { sitesDomain } = await getSettings(env);
  return reply(c, { site: siteView(await advanceSite(env, site.project_id, site.id), sitesDomain) });
});

/** The deploy history of a site: what publish and rollback point at. */
portal.get('/admin/projects/:id/site/deploys', async (c) => {
  const siteId = c.req.query('siteId');
  const site = siteId ? await getSiteById(c.env, siteId) : await getSite(c.env, c.req.param('id'));
  if (!site || site.project_id !== c.req.param('id')) return reply(c, { error: 'not_found' }, 404);
  return reply(c, { deploys: await listDeploys(c.env, site.project_id, 50, site.id) });
});

portal.post('/admin/projects/:id/site/publish', async (c) => {
  const body = await readJson<{ siteId?: unknown }>(c);
  const out = await publishSite(c.env, c.req.param('id'), typeof body?.siteId === 'string' ? body.siteId : null);
  if ('error' in out) return siteError(c, out);
  await recordPublish(c, { id: c.req.param('id'), name: null }, out, 'publish');
  return reply(c, {
    ok: true,
    productionUrl: out.productionUrl,
    ...(out.cloudflareError ? { cloudflareError: out.cloudflareError } : {}),
  });
});

portal.post('/admin/projects/:id/site/rollback', async (c) => {
  const body = await readJson<{ deployId?: unknown; siteId?: unknown }>(c);
  const out = await rollbackSite(
    c.env,
    c.req.param('id'),
    typeof body?.deployId === 'string' ? body.deployId : '',
    typeof body?.siteId === 'string' ? body.siteId : null,
  );
  if ('error' in out) return siteError(c, out);
  await recordPublish(c, { id: c.req.param('id'), name: null }, out, 'rollback');
  return reply(c, {
    ok: true,
    productionUrl: out.productionUrl,
    ...(out.cloudflareError ? { cloudflareError: out.cloudflareError } : {}),
  });
});

/** An account id, or the address of one — the owner lookup create and PATCH share. */
const userRef = (env: Env, identifier: string) =>
  env.DB.prepare('SELECT id FROM users WHERE id = ? OR email = ?').bind(identifier, identifier).first<{ id: string }>();

/**
 * Where a project's code comes from, as the admin form asks it:
 *   create  a node makes a private repo (the default — work needs something to clone)
 *   repo    this URL
 *   folder  a folder that already exists on a node; that node shares its origin
 * `ownerUserId` (an account id or the address of one, like PATCH takes) names
 * the owner in the same request: they are attached through `user_projects`
 * and `owner_user_id` is set, so their connections carry deploys from the
 * start (rule 2). No owner is allowed — an internal project.
 */
portal.post('/admin/projects', async (c) => {
  const body = await readJson<{ name?: unknown; slug?: unknown; code?: unknown; repo?: unknown; kind?: unknown; solutions?: unknown; ownerUserId?: unknown }>(c);
  if (body?.solutions !== undefined && !Array.isArray(body.solutions)) return reply(c, { error: 'bad_solutions' }, 400);
  const solutions = cleanSolutions(body?.solutions);
  const name = cleanText(body?.name, MAX_NAME_CHARS);
  const slug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  // The slug is what the local runner maps to a folder — keep it path-safe.
  if (!name || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return reply(c, { error: 'bad_project' }, 400);
  const code = body?.code === 'repo' || body?.code === 'folder' ? body.code : 'create';
  const repo = code === 'repo' ? cleanRepo(body?.repo) : null;
  if (code === 'repo' && !repo) return reply(c, { error: 'bad_repo' }, 400);
  const kind = body?.kind === 'new' ? 'new' : 'existing';
  let ownerId: string | null = null;
  if (body?.ownerUserId !== undefined && body.ownerUserId !== null) {
    if (typeof body.ownerUserId !== 'string' || !body.ownerUserId.trim()) return reply(c, { error: 'bad_owner' }, 400);
    const owner = await userRef(c.env, body.ownerUserId.trim());
    if (!owner) return reply(c, { error: 'owner_not_found' }, 400);
    ownerId = owner.id;
  }
  const id = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO projects (id, slug, name, kind, repo, repo_kind, repo_wanted, owner_user_id, created_at, solutions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, slug, name, kind, repo, repo ? 'repo' : 'none', code === 'create' ? 1 : 0, ownerId, now(), JSON.stringify(solutions)),
      ...(ownerId ? [c.env.DB.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').bind(ownerId, id)] : []),
    ]);
  } catch {
    return reply(c, { error: 'slug_taken' }, 409);
  }
  return reply(c, { id, slug, name, solutions, ownerUserId: ownerId }, 201);
});

/**
 * Ali's hand edits to a project: its name and whether it is new or existing.
 * The slug stays: nodes map it to a folder and the first site is named after it.
 */
portal.get('/admin/projects/:id', async (c) => {
  const project = await c.env.DB.prepare('SELECT p.id,p.slug,p.name,p.kind,p.brief,p.repo,p.owner_user_id,p.solutions,u.email AS owner_email FROM projects p LEFT JOIN users u ON u.id=p.owner_user_id WHERE p.id=?').bind(c.req.param('id')).first<{brief:string;solutions:string;owner_email:string|null}>();
  return project ? reply(c,{project:{...project,brief:parseBrief(project.brief),solutions:parseSolutions(project.solutions)}}) : reply(c,{error:'not_found'},404);
});

/**
 * What the project can deploy to on the client's Cloudflare: the owner's
 * Worker scripts (and Pages projects, where the credential may read them) and
 * the deploy target already chosen.
 *
 * The credential is the project owner's OAuth grant from the portal's
 * Connections page — `?connection=` may name one of the owner's grants, never
 * another user's — or, failing that, an account id and token stored on the
 * project. A project with no owner has no client credential to read with
 * (rule 2). Tokens are used here, server side, and never returned.
 */
portal.get('/admin/projects/:id/cloudflare', async (c) => {
  const id = c.req.param('id');
  const project = await c.env.DB.prepare(
    'SELECT p.id, p.owner_user_id, p.deploy_target, p.repo, u.email AS owner_email FROM projects p LEFT JOIN users u ON u.id = p.owner_user_id WHERE p.id = ?',
  )
    .bind(id)
    .first<{ id: string; owner_user_id: string | null; deploy_target: string | null; repo: string | null; owner_email: string | null }>();
  if (!project) return reply(c, { error: 'not_found' }, 404);
  const target = readDeployTarget(project.deploy_target);
  const projectRepo = normalizeRepo(project.repo);
  c.header('Cache-Control', 'no-store');
  // Without an owner there is no client credential to read with, and no
  // grant of another user may stand in (rule 2).
  if (!project.owner_user_id) return reply(c, { connected: false, needsOwner: true, connections: [], owner: null, projectRepo, detected: null, target });
  const grants = (await c.env.DB.prepare(
    'SELECT cc.id, cc.accounts FROM cloudflare_connections cc WHERE cc.user_id = ? AND cc.revoked_at IS NULL ORDER BY cc.created_at DESC',
  )
    .bind(project.owner_user_id)
    .all<{ id: number; accounts: string }>()).results ?? [];
  const connections: ConnectionSummary[] = grants.map((g) => ({ id: g.id, email: project.owner_email ?? '', accounts: grantedAccounts(g) }));
  const requested = Number(c.req.query('connection')) || null;
  if (requested && !connections.some((conn) => conn.id === requested)) return reply(c, { error: 'connection_not_owned' }, 400);
  const chosen = pickConnection(connections, { requested, target });
  if (chosen) {
    const token = await cloudflareAccess(c.env, chosen.id).catch(() => null);
    if (!token) return reply(c, { connected: false, via: 'oauth', lapsed: true, connectionId: chosen.id, connections, owner: project.owner_email, projectRepo, detected: null, target });
    const accountId = (requested ? null : target?.connectionId === chosen.id ? target.accountId : null) ?? chosen.accounts[0]?.id ?? '';
    // A grant from before Pages was asked for answers "not allowed": the client reconnects.
    const [pages, workers, domains] = await Promise.all([listPages(accountId, token), listWorkers(accountId, token), listDomains(accountId, token)]);
    // When the provider itself builds the site from a Git repo, say so: such a
    // site deploys by pushing branches, not by handing a run a deploy token.
    const detected = detectProviderBuild(pages.ok ? pages.items : null, projectRepo, { served: servedPages(domains), target });
    return reply(c, { connected: true, via: 'oauth', connectionId: chosen.id, accountId, connections, owner: project.owner_email, projectRepo, detected, pages, workers, domains, target });
  }
  const rows = (await c.env.DB.prepare(`SELECT name, value_enc FROM project_secrets WHERE project_id=? AND name IN ('CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN')`)
    .bind(id).all<{ name: string; value_enc: string }>()).results ?? [];
  if (rows.length < 2) return reply(c, { connected: false, connections, owner: project.owner_email, projectRepo, detected: null, target });
  if (!c.env.SESSION_SECRET) return reply(c, { error: 'secrets_unavailable' }, 503);
  let accountId = '';
  let token = '';
  try {
    for (const row of rows) {
      const value = await openProjectSecret(c.env, id, row.name, row.value_enc);
      if (row.name === 'CLOUDFLARE_ACCOUNT_ID') accountId = value.trim();
      else token = value.trim();
    }
  } catch {
    return reply(c, { error: 'secrets_unavailable' }, 503);
  }
  const [pages, workers, domains] = await Promise.all([listPages(accountId, token), listWorkers(accountId, token), listDomains(accountId, token)]);
  const detected = detectProviderBuild(pages.ok ? pages.items : null, projectRepo, { served: servedPages(domains), target });
  return reply(c, { connected: true, via: 'token', accountId, connections, owner: project.owner_email, projectRepo, detected, pages, workers, domains, target });
});

/** Pages projects the account's DNS points one of its hosts at. */
const servedPages = (domains: Awaited<ReturnType<typeof listDomains>>) =>
  domains.ok ? domains.items.filter((d) => d.kind === 'pages').map((d) => d.name) : [];

/** Choose (or clear, with `null`) where this project's work goes live. */
portal.put('/admin/projects/:id/deploy-target', async (c) => {
  const id = c.req.param('id');
  const body = await readJson<{ target?: unknown }>(c);
  const parsed = parseDeployTarget(body?.target === undefined ? undefined : body.target);
  if (parsed && 'error' in parsed) return reply(c, { error: parsed.error }, 400);
  if (parsed?.connectionId) {
    const project = await c.env.DB.prepare('SELECT owner_user_id FROM projects WHERE id=?').bind(id).first<{ owner_user_id: string | null }>();
    if (!project) return reply(c, { error: 'not_found' }, 404);
    // Rule 2: a deploy target may only name the project owner's grant, and a
    // project with no owner has no client credential to deploy with.
    if (!project.owner_user_id) return reply(c, { error: 'owner_required' }, 400);
    const grant = await connectionRow(c.env, parsed.connectionId);
    if (!grant || grant.user_id !== project.owner_user_id) return reply(c, { error: 'connection_not_owned' }, 400);
    if (!grantedAccounts(grant).some((a) => a.id === parsed.accountId)) return reply(c, { error: 'account_not_in_grant' }, 400);
  }
  const result = await c.env.DB.prepare('UPDATE projects SET deploy_target=? WHERE id=?').bind(parsed ? JSON.stringify(parsed) : null, id).run();
  if (!result.meta.changes) return reply(c, { error: 'not_found' }, 404);
  return reply(c, { target: parsed });
});

portal.get('/admin/projects/:id/memberships', async (c) => {
  const id=c.req.param('id');
  const project=await c.env.DB.prepare('SELECT owner_user_id FROM projects WHERE id=?').bind(id).first<{owner_user_id:string|null}>();
  if (!project) return reply(c,{error:'not_found'},404);
  const members=await c.env.DB.prepare(`SELECT u.id AS userId,u.email,u.name,pm.member_type AS memberType,pm.created_at AS createdAt FROM project_memberships pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=? ORDER BY u.email`).bind(id).all();
  const clients=await c.env.DB.prepare('SELECT u.id,u.email,u.name FROM user_projects up JOIN users u ON u.id=up.user_id WHERE up.project_id=? ORDER BY u.email').bind(id).all();
  return reply(c,{ownerUserId:project.owner_user_id,memberships:members.results??[],clients:clients.results??[]});
});
portal.post('/admin/projects/:id/memberships', async (c) => {
  if (!isSuperAdmin(c.get('user'))) return reply(c,{error:'forbidden'},403);
  const body=await readJson<{userId?:unknown;email?:unknown}>(c);
  const email=cleanEmail(body?.email);
  const user=typeof body?.userId==='string'
    ? await c.env.DB.prepare('SELECT id FROM users WHERE id=? AND verified_at IS NOT NULL').bind(body.userId).first<{id:string}>()
    : email ? await c.env.DB.prepare('SELECT id FROM users WHERE email=? AND verified_at IS NOT NULL').bind(email).first<{id:string}>() : null;
  if (!user) return reply(c,{error:'account_required'},400);
  const exists=await c.env.DB.prepare('SELECT 1 FROM projects WHERE id=?').bind(c.req.param('id')).first();
  if (!exists) return reply(c,{error:'not_found'},404);
  await c.env.DB.prepare(`INSERT INTO project_memberships(project_id,user_id,member_type,granted_by,created_at) VALUES (?,?,'trusted_developer',?,?) ON CONFLICT(project_id,user_id) DO NOTHING`).bind(c.req.param('id'),user.id,c.get('user').id,now()).run();
  return reply(c,{ok:true});
});
portal.delete('/admin/projects/:id/memberships/:userId', async (c) => {
  if (!isSuperAdmin(c.get('user')) && !await ownsProject(c.env,c.get('user'),c.req.param('id'))) return reply(c,{error:'forbidden'},403);
  await c.env.DB.prepare('DELETE FROM project_memberships WHERE project_id=? AND user_id=?').bind(c.req.param('id'),c.req.param('userId')).run();
  return reply(c,{ok:true});
});
const secretName = (name:string) => /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(name);
const invalidateSecretChecks = (env: Env, id: string, name: string) => INTEGRATION_CATALOG
  .filter(entry => fieldBelongs(entry.id, name))
  .map(entry => env.DB.prepare('DELETE FROM project_integration_checks WHERE project_id=? AND integration=?').bind(id, entry.id));
portal.get('/admin/projects/:id/secrets', async (c) => {
  if (!c.env.SESSION_SECRET) return reply(c,{error:'secrets_unavailable'},503);
  const rows=await c.env.DB.prepare('SELECT name,updated_at AS updatedAt FROM project_secrets WHERE project_id=? ORDER BY name').bind(c.req.param('id')).all();
  return reply(c,{secrets:rows.results??[]});
});
portal.put('/admin/projects/:id/secrets/:name', async (c) => {
  if (!c.env.SESSION_SECRET) return reply(c,{error:'secrets_unavailable'},503);
  const name=c.req.param('name'),id=c.req.param('id');
  const body=await readJson<{value?:unknown}>(c);
  if (!secretName(name) || typeof body?.value!=='string' || body.value.length>16384) return reply(c,{error:'bad_secret'},400);
  const value=await sealProjectSecret(c.env,id,name,body.value);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO project_secrets(project_id,name,value_enc,updated_by,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(project_id,name) DO UPDATE SET value_enc=excluded.value_enc,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(id,name,value,c.get('user').id,now()),
    ...invalidateSecretChecks(c.env,id,name),
  ]);
  return reply(c,{ok:true});
});
portal.post('/admin/projects/:id/secrets/:name/reveal', async (c) => {
  if (!c.env.SESSION_SECRET) return reply(c,{error:'secrets_unavailable'},503);
  const id=c.req.param('id'),name=c.req.param('name');
  const row=await c.env.DB.prepare('SELECT value_enc FROM project_secrets WHERE project_id=? AND name=?').bind(id,name).first<{value_enc:string}>();
  if (!row) return reply(c,{error:'not_found'},404);
  c.header('Cache-Control','no-store');
  try { return reply(c,{value:await openProjectSecret(c.env,id,name,row.value_enc)}); }
  catch { return reply(c,{error:'secrets_unavailable'},503); }
});
portal.delete('/admin/projects/:id/secrets/:name', async (c) => {
  if (!c.env.SESSION_SECRET) return reply(c,{error:'secrets_unavailable'},503);
  const id=c.req.param('id'),name=c.req.param('name');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM project_secrets WHERE project_id=? AND name=?').bind(id,name),
    ...invalidateSecretChecks(c.env,id,name),
  ]);
  return reply(c,{ok:true});
});
/** Every time a fleet run took this project's credentials, latest first (worker/src/node.ts). */
portal.get('/admin/projects/:id/credential-access', async (c) => {
  const rows=await c.env.DB.prepare(
    'SELECT run_id AS runId, node_id AS nodeId, integrations, at FROM credential_access WHERE project_id=? ORDER BY id DESC LIMIT 50',
  ).bind(c.req.param('id')).all<{runId:number;nodeId:string|null;integrations:string;at:number}>();
  const access=(rows.results??[]).map(row=>{
    let integrations:string[]=[];
    try { const parsed=JSON.parse(row.integrations); if (Array.isArray(parsed)) integrations=parsed.filter((id):id is string=>typeof id==='string'); } catch { /* a bad row reads as none */ }
    return {runId:row.runId,nodeId:row.nodeId,integrations,at:row.at};
  });
  return reply(c,{access});
});
portal.post('/admin/projects/:id/git-token', async (c) => {
  const project=await c.env.DB.prepare('SELECT repo,github_installation_id FROM projects WHERE id=?').bind(c.req.param('id')).first<{repo:string|null;github_installation_id:number|null}>();
  const repo=project?.repo?.match(/^(?:https:\/\/github\.com\/|git@github\.com:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
  if (!repo || !project?.github_installation_id) return reply(c,{error:'github_installation_required'},409);
  const install=await c.env.DB.prepare('SELECT account_login FROM github_installations WHERE id=?').bind(project.github_installation_id).first<{account_login:string}>();
  if (!install || install.account_login.toLowerCase()!==repo[1].toLowerCase()) return reply(c,{error:'github_installation_required'},409);
  c.header('Cache-Control','no-store');
  try {
    const token=await installationToken(c.env,project.github_installation_id,[repo[2]]);
    return reply(c,{...token,repo:`${repo[1]}/${repo[2]}`});
  } catch { return reply(c,{error:'github_token_unavailable'},502); }
});

/**
 * One edit endpoint for a project. `ownerUserId` moves ownership (rule 2):
 * the owner must already be attached to the project through `user_projects`
 * — an account id or the address of one — and `null` clears it, after which
 * the project has no client credential until a new owner is set. An
 * administrator's field: nothing here ever attaches another user's grant;
 * ownership decides whose are used.
 */
portal.patch('/admin/projects/:id', async (c) => {
  const body = await readJson<{ name?: unknown; kind?: unknown; brief?: unknown; solutions?: unknown; ownerUserId?: unknown }>(c);
  const current = await c.env.DB.prepare('SELECT kind FROM projects WHERE id = ?').bind(c.req.param('id')).first<{kind:string}>();
  if (!current) return reply(c, { error: 'not_found' }, 404);
  const sets: [string, unknown][] = [];
  if (body?.solutions !== undefined) {
    if (!Array.isArray(body.solutions)) return reply(c, { error: 'bad_solutions' }, 400);
    sets.push(['solutions', JSON.stringify(cleanSolutions(body.solutions))]);
  }
  if (body?.brief !== undefined) {
    const kind = body.kind ?? current.kind;
    if (!isProjectKind(kind)) return reply(c, {error:'bad_kind'},400);
    const brief = cleanBrief(body.brief, kind);
    if (!brief) return reply(c, {error:'bad_brief'},400);
    sets.push(['brief', JSON.stringify(brief)]);
  }
  if (body?.name !== undefined) {
    const name = cleanText(body.name, MAX_NAME_CHARS);
    if (!name) return reply(c, { error: 'bad_name' }, 400);
    sets.push(['name', name]);
  }
  if (body?.kind !== undefined) {
    if (!isProjectKind(body.kind)) return reply(c, { error: 'bad_kind' }, 400);
    sets.push(['kind', body.kind]);
  }
  if (body?.ownerUserId !== undefined) {
    // Ownership decides whose connections the project deploys with (rule 2),
    // so like the deploy-target write it is an administrator's decision, not
    // a trusted developer's.
    if (!isSuperAdmin(c.get('user'))) return reply(c, { error: 'forbidden' }, 403);
    if (body.ownerUserId === null) {
      sets.push(['owner_user_id', null]);
    } else if (typeof body.ownerUserId === 'string' && body.ownerUserId.trim()) {
      const owner = await userRef(c.env, body.ownerUserId.trim());
      if (!owner) return reply(c, { error: 'owner_not_found' }, 400);
      const attached = await c.env.DB.prepare('SELECT 1 FROM user_projects WHERE user_id = ? AND project_id = ?')
        .bind(owner.id, c.req.param('id')).first();
      if (!attached) return reply(c, { error: 'owner_not_on_project' }, 400);
      sets.push(['owner_user_id', owner.id]);
    } else {
      return reply(c, { error: 'bad_owner' }, 400);
    }
  }
  if (!sets.length) return reply(c, { error: 'nothing_to_change' }, 400);
  const res = await c.env.DB.prepare(`UPDATE projects SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .bind(...sets.map(([, v]) => v), c.req.param('id'))
    .run();
  if (!res.meta.changes) return reply(c, { error: 'not_found' }, 404);
  const project = await c.env.DB.prepare(
    'SELECT p.id, p.slug, p.name, p.kind, p.brief, p.owner_user_id AS ownerUserId, u.email AS ownerEmail FROM projects p LEFT JOIN users u ON u.id = p.owner_user_id WHERE p.id = ?',
  ).bind(c.req.param('id')).first<{id:string;slug:string;name:string;kind:string;brief:string;ownerUserId:string|null;ownerEmail:string|null}>();
  return reply(c, { ok: true, project: project ? {...project,brief:parseBrief(project.brief)} : null });
});

/** Name the project's repo. Replaces whatever was there, and stops any pending creation. */
portal.put('/admin/projects/:id/repo', async (c) => {
  const body = await readJson<{ repo?: unknown }>(c);
  const repo = cleanRepo(body?.repo);
  if (!repo || /^https:\/\/[^/]*@/i.test(repo)) return reply(c, { error: 'bad_repo' }, 400);
  const res = await c.env.DB.prepare(
    `UPDATE projects SET repo = ?, repo_kind = 'repo', repo_wanted = 0, repo_error = NULL,
            repo_claim_node = NULL, repo_claim_at = NULL, github_installation_id = NULL WHERE id = ?`,
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
 * Create the project's repo in the client's own GitHub account. The account is
 * the project's installation, or one belonging to a client linked to it.
 */
portal.post('/admin/projects/:id/repo/github', async (c) => {
  const id = c.req.param('id');
  const body = await readJson<{ installationId?: unknown }>(c);
  const project = await c.env.DB.prepare('SELECT id, slug, name, github_installation_id FROM projects WHERE id = ?')
    .bind(id)
    .first<{ id: string; slug: string; name: string; github_installation_id: number | null }>();
  if (!project) return reply(c, { error: 'not_found' }, 404);
  const wanted = Number(body?.installationId);
  const installation =
    Number.isInteger(wanted) && wanted > 0
      ? await c.env.DB.prepare('SELECT id, account_login FROM github_installations WHERE id = ?')
          .bind(wanted)
          .first<{ id: number; account_login: string }>()
      : project.github_installation_id
        ? await c.env.DB.prepare('SELECT id, account_login FROM github_installations WHERE id = ?')
            .bind(project.github_installation_id)
            .first<{ id: number; account_login: string }>()
        : await c.env.DB.prepare(
            `SELECT i.id, i.account_login FROM github_installations i
               JOIN users u ON u.id = i.user_id
               JOIN user_projects up ON up.user_id = u.id
              WHERE up.project_id = ? AND u.role = 'client'
              ORDER BY i.account_login LIMIT 1`,
          )
            .bind(id)
            .first<{ id: number; account_login: string }>();
  if (!installation) return reply(c, { error: 'no_github' }, 400);
  const related = await c.env.DB.prepare(`SELECT 1 FROM github_installations i JOIN projects p ON p.id=? WHERE i.id=? AND (p.github_installation_id=i.id OR p.owner_user_id=i.user_id OR EXISTS (SELECT 1 FROM user_projects up WHERE up.project_id=p.id AND up.user_id=i.user_id))`).bind(id,installation.id).first();
  if (!related) return reply(c,{error:'no_github'},400);
  try {
    const out = await useClientRepo(c.env, project, installation);
    return reply(c, { ok: true, repo: out.repo, outcome: out.outcome, account: installation.account_login });
  } catch (error) {
    const message = (error as Error)?.message ?? 'Could not create the repo.';
    await c.env.DB.prepare(
      `UPDATE projects SET repo = NULL, repo_kind = 'none', repo_wanted = 1,
         github_installation_id = NULL, repo_error = NULL WHERE id = ?`,
    )
      .bind(id)
      .run();
    return reply(c, { error: 'github', message, fellBack: 'ours' }, 502);
  }
});

/** Move a site between our hosting and a client's Cloudflare account (Ali's switch). */
portal.post('/admin/projects/:id/site/host', async (c) => {
  const id = c.req.param('id');
  const body = await readJson<{ host?: unknown; connectionId?: unknown; accountId?: unknown; siteId?: unknown }>(c);
  if (body?.host !== 'ours' && body?.host !== 'cloudflare') return reply(c, { error: 'bad_host' }, 400);
  let target: { id: number; accountId: string } | null = null;
  if (body.host === 'cloudflare') {
    const wanted = Number(body?.connectionId);
    const connection = Number.isInteger(wanted) && wanted > 0 ? await connectionRow(c.env, wanted) : null;
    if (!connection) return reply(c, { error: 'no_cloudflare' }, 400);
    const related = await c.env.DB.prepare(`SELECT 1 FROM projects p WHERE p.id=? AND (p.owner_user_id=? OR EXISTS (SELECT 1 FROM user_projects up WHERE up.project_id=p.id AND up.user_id=?))`).bind(id,connection.user_id,connection.user_id).first();
    if (!related) return reply(c,{error:'no_cloudflare'},400);
    const accounts = grantedAccounts(connection);
    const account = body.accountId ? accounts.find((a) => a.id === body.accountId) : accounts[0];
    if (!account) return reply(c, { error: 'no_cloudflare_account' }, 400);
    target = { id: connection.id, accountId: account.id };
  }
  const site = await setSiteHost(
    c.env,
    id,
    body.host,
    target,
    typeof body?.siteId === 'string' ? body.siteId : null,
  );
  if (!site) return reply(c, { error: 'not_found' }, 404);
  const { sitesDomain } = await getSettings(c.env);
  return reply(c, { site: siteView(site, sitesDomain) });
});

/** Attach a hostname to the site's mirrored Worker and point its DNS at it. */
portal.post('/admin/projects/:id/site/domain', async (c) => {
  const body = await readJson<{ siteId?: unknown; hostname?: unknown; zoneId?: unknown }>(c);
  const site = typeof body?.siteId === 'string'
    ? await getSiteById(c.env, body.siteId)
    : await getSite(c.env, c.req.param('id'));
  if (!site || site.project_id !== c.req.param('id')) return reply(c, { error: 'not_found' }, 404);
  if (site.host !== 'cloudflare' || !site.cloudflare_connection_id || !site.cloudflare_account_id) {
    return reply(c, { error: 'not_cloudflare' }, 409);
  }
  if (!site.cloudflare_production_script) return reply(c, { error: 'not_deployed' }, 409);

  const hostname = typeof body?.hostname === 'string' ? body.hostname.trim().toLowerCase() : '';
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) {
    return reply(c, { error: 'bad_hostname' }, 400);
  }
  const token = await cloudflareAccess(c.env, site.cloudflare_connection_id);
  if (!token) return reply(c, { error: 'reconnect_cloudflare' }, 409);

  const cf = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${apiBase(c.env)}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => null)) as
      | { success?: boolean; result?: unknown; errors?: { message?: string; code?: number }[] }
      | null;
    return { ok: res.ok && data?.success !== false, status: res.status, data };
  };

  let zoneId = typeof body?.zoneId === 'string' ? body.zoneId : '';
  if (!zoneId) {
    const zones = await cf('/zones?per_page=100');
    const rows = (Array.isArray(zones.data?.result) ? zones.data.result : []) as {
      id?: string;
      name?: string;
      account?: { id?: string };
    }[];
    const match = rows
      .filter((z) => z.id && z.name && hostname.endsWith(`.${z.name}`) || hostname === z.name)
      .filter((z) => !z.account?.id || z.account.id === site.cloudflare_account_id)
      .sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0))[0];
    if (!match?.id) return reply(c, { error: 'no_zone', hostname }, 409);
    zoneId = match.id;
  } else {
    // A connection can cover several accounts. A supplied zone must still be
    // inside this site's selected account and contain the requested hostname.
    const zone = await cf(`/zones/${encodeURIComponent(zoneId)}`);
    const data = zone.data?.result as { name?: string; account?: { id?: string } } | undefined;
    if (!zone.ok || data?.account?.id !== site.cloudflare_account_id || !data.name ||
        !(hostname === data.name || hostname.endsWith(`.${data.name}`))) return reply(c, { error: 'no_zone', hostname }, 409);
  }

  const attach = () =>
    cf(`/accounts/${site.cloudflare_account_id}/workers/domains`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hostname,
        service: site.cloudflare_production_script,
        environment: 'production',
        zone_id: zoneId,
      }),
    });

  let attached = await attach();
  if (!attached.ok) {
    const message = attached.data?.errors?.map((e) => e.message).join('; ') ?? '';
    // A Pages/A record already owns the hostname. Replace only the record at
    // exactly this name (never a wildcard or another subdomain), then retry.
    if (/already exists|in use|conflict|externally managed|DNS record|100117/i.test(message)) {
      const records = await cf(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}`);
      const rows = (Array.isArray(records.data?.result) ? records.data.result : []) as {
        id?: string;
        type?: string;
        name?: string;
      }[];
      for (const record of rows) {
        if (!record.id || record.name?.toLowerCase() !== hostname) continue;
        if (!['A', 'AAAA', 'CNAME'].includes(String(record.type))) continue;
        await cf(`/zones/${zoneId}/dns_records/${record.id}`, { method: 'DELETE' });
      }
      attached = await attach();
    }
  }

  if (!attached.ok) {
    const message = attached.data?.errors?.map((e) => `${e.message} (${e.code})`).join('; ') || `Cloudflare answered ${attached.status}`;
    return reply(c, { error: 'cloudflare', message }, 502);
  }

  await c.env.DB.prepare('UPDATE sites SET custom_domain = ?, updated_at = ? WHERE id = ?')
    .bind(hostname, now(), site.id)
    .run();
  return reply(c, { ok: true, hostname, zoneId, url: `https://${hostname}` });
});

/** Delete one site of a project. */
portal.delete('/admin/projects/:id/site', async (c) => {
  const body = await readJson<{ siteId?: unknown }>(c);
  if (typeof body?.siteId !== 'string' || !body.siteId) return reply(c, { error: 'bad_site' }, 400);
  const out = await deleteSite(c.env, c.req.param('id'), body.siteId);
  if ('error' in out) return reply(c, out, out.error === 'not_found' ? 404 : 409);
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

  if (env.SITES) {
    // Every site under the project: each has its own prefix.
    for (const site of await getSites(env, id)) {
      let cursor: string | undefined;
      do {
        const page = await env.SITES.list({ prefix: `sites/${site.slug}/`, cursor });
        if (page.objects.length) await env.SITES.delete(page.objects.map((o) => o.key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    }
  }
  await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
  return reply(c, { ok: true });
});

/** Build the preview branch as it is and deploy it: a node holding the project does it on its next beat. */
portal.post('/admin/projects/:id/site/rebuild', async (c) => {
  const body = await readJson<{ siteId?: unknown }>(c);
  const site =
    typeof body?.siteId === 'string' && body.siteId
      ? await getSiteById(c.env, body.siteId)
      : await getSite(c.env, c.req.param('id'));
  if (!site || site.project_id !== c.req.param('id')) return reply(c, { error: 'not_found' }, 404);
  const res = await c.env.DB.prepare(
    `UPDATE sites SET rebuild_requested_at = ?, rebuild_error = NULL WHERE id = ? AND state = 'ready'`,
  )
    .bind(now(), site.id)
    .run();
  if (!res.meta.changes) return reply(c, { error: 'not_ready' }, 409);
  return reply(c, { ok: true });
});

/** Add a site to any project, the same as a client's "Add a site". */
portal.post('/admin/projects/:id/site', async (c) => {
  const project = await c.env.DB.prepare('SELECT id, name, slug FROM projects WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ id: string; name: string; slug: string }>();
  if (!project) return reply(c, { error: 'not_found' }, 404);
  const body = await readJson<{ name?: unknown; siteSlug?: unknown; host?: unknown; connectionId?: unknown; accountId?: unknown }>(c);
  const rawSlug = typeof body?.siteSlug === 'string' ? body.siteSlug : '';
  const wanted = rawSlug ? cleanSiteSlug(rawSlug) : null;
  if (rawSlug && !wanted) return reply(c, { error: 'bad_slug' }, 400);
  if (wanted && !(await siteSlugFree(c.env, wanted))) return reply(c, { error: 'slug_taken' }, 409);
  let host: SiteHost = 'ours';
  let connectionId: number | null = null;
  let accountId: string | null = null;
  if (body?.host === 'cloudflare') {
    const wantedConnection = Number(body?.connectionId);
    const connection = Number.isInteger(wantedConnection) && wantedConnection > 0 ? await connectionRow(c.env, wantedConnection) : null;
    if (!connection) return reply(c, { error: 'no_cloudflare' }, 400);
    const related = await c.env.DB.prepare(`SELECT 1 FROM projects p WHERE p.id=? AND (p.owner_user_id=? OR EXISTS (SELECT 1 FROM user_projects up WHERE up.project_id=p.id AND up.user_id=?))`).bind(project.id,connection.user_id,connection.user_id).first();
    if (!related) return reply(c,{error:'no_cloudflare'},400);
    const accounts = grantedAccounts(connection);
    const account = body.accountId ? accounts.find((a) => a.id === body.accountId) : accounts[0];
    if (!account) return reply(c, { error: 'no_cloudflare_account' }, 400);
    host = 'cloudflare';
    connectionId = connection.id;
    accountId = account.id;
  }
  try {
    const site = await startSite(c.env, c.get('user'), project, {
      name: typeof body?.name === 'string' ? body.name : null,
      siteSlug: wanted,
      host,
      connectionId,
      accountId,
    });
    const { sitesDomain } = await getSettings(c.env);
    return reply(c, { site: siteView(site, sitesDomain) }, 201);
  } catch (error) {
    return siteError(c, error);
  }
});

/** How a client's finished work reaches them: a preview link, or a PR in their repo. */
portal.patch('/admin/clients/:userId', async (c) => {
  const body = await readJson<{
    handoff?: unknown;
    locale?: unknown;
    translation?: unknown;
    firstPreviewLimitUsd?: unknown;
    grantFirstPreview?: unknown;
  }>(c);
  if (body?.handoff !== undefined && body.handoff !== 'preview' && body.handoff !== 'pull_request') {
    return reply(c, { error: 'bad_handoff' }, 400);
  }
  const language = cleanLanguage(body);
  if ('error' in language) return reply(c, { error: language.error }, 400);
  const sets: [string, unknown][] = [];
  if (body?.handoff !== undefined) sets.push(['handoff', body.handoff as string]);
  if (language.locale) sets.push(['locale', language.locale]);
  if (language.translation) sets.push(['translation', language.translation]);
  // The first preview's limit for this client, in dollars: null follows the
  // setting, 0 turns the feature off for them.
  if (body?.firstPreviewLimitUsd !== undefined) {
    const usd = body.firstPreviewLimitUsd;
    if (usd !== null && (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0 || usd > 1000)) {
      return reply(c, { error: 'bad_first_preview_limit' }, 400);
    }
    sets.push(['first_preview_limit_usd', usd === null ? null : Math.round(usd * 100) / 100]);
  }
  // Re-grant the account's one first preview.
  if (body?.grantFirstPreview === true) sets.push(['first_preview_at', null]);
  if (!sets.length) return reply(c, { error: 'nothing_to_change' }, 400);
  const res = await c.env.DB.prepare(`UPDATE users SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ? AND role = 'client'`)
    .bind(...sets.map(([, v]) => v), c.req.param('userId'))
    .run();
  if (!res.meta.changes) return reply(c, { error: 'not_found' }, 404);
  return reply(c, {
    ok: true,
    ...(body?.handoff !== undefined ? { handoff: body.handoff } : {}),
    ...(body?.grantFirstPreview === true ? { firstPreviewGranted: true } : {}),
    ...language,
  });
});

/**
 * Link a client to a project. `{ copy }` sets whether they get copies of the
 * project's request emails; without it an existing link keeps its setting.
 */
portal.put('/admin/clients/:userId/projects/:projectId', async (c) => {
  const { userId, projectId } = c.req.param();
  const body = await readJson<{ copy?: unknown }>(c);
  if (body?.copy !== undefined && typeof body.copy !== 'boolean') return reply(c, { error: 'bad_copy' }, 400);
  try {
    await c.env.DB.prepare('INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)')
      .bind(userId, projectId)
      .run();
  } catch {
    return reply(c, { error: 'not_found' }, 404); // FK violation: unknown user or project
  }
  if (typeof body?.copy === 'boolean') {
    await c.env.DB.prepare('UPDATE user_projects SET copy_mail = ? WHERE user_id = ? AND project_id = ?')
      .bind(body.copy ? 1 : 0, userId, projectId)
      .run();
  }
  const link = await c.env.DB.prepare('SELECT copy_mail FROM user_projects WHERE user_id = ? AND project_id = ?')
    .bind(userId, projectId)
    .first<{ copy_mail: number }>();
  return reply(c, { ok: true, copy: link?.copy_mail === 1 });
});

portal.delete('/admin/clients/:userId/projects/:projectId', async (c) => {
  const { userId, projectId } = c.req.param();
  await c.env.DB.prepare('DELETE FROM user_projects WHERE user_id = ? AND project_id = ?')
    .bind(userId, projectId)
    .run();
  // Removing the owning client removes their ownership too; ownership is never
  // transferred silently to another account.
  await c.env.DB.prepare('UPDATE projects SET owner_user_id = NULL WHERE id = ? AND owner_user_id = ?')
    .bind(projectId, userId)
    .run();
  return reply(c, { ok: true });
});

/**
 * Does the model key behind the site chat and the ticket bridge still answer?
 * It asks for DeepSeek first and falls back to Workers AI exactly as the
 * bridge does, so the answer says which one carried the call.
 */
portal.get('/admin/health/deepseek', async (c) => {
  const started = Date.now();
  const out = await translateText(c.env, 'The quick brown fox jumps over the lazy dog.', 'tr', {
    engine: 'deepseek',
    sourceHint: 'en-US',
  });
  // The fallback matters too: if it is broken, non-English clients lose the
  // ticket bridge as well as the chat. Report its own answer.
  let fallback: { text: string | null; error: string | null } = { text: null, error: null };
  try {
    const ai = c.env.AI;
    if (!ai) throw new Error('AI binding missing');
    const run = (await ai.run('@cf/meta/m2m100-1.2b', {
      text: 'Hello',
      source_lang: 'en',
      target_lang: 'tr',
    })) as { translated_text?: string };
    fallback = { text: run?.translated_text ?? null, error: null };
  } catch (error) {
    fallback = { text: null, error: error instanceof Error ? error.message : String(error) };
  }
  const deepseek = out?.engine === 'deepseek';
  return reply(c, {
    // The bridge is up when either engine answers; the chat is DeepSeek-only.
    ok: Boolean(out),
    bridge: Boolean(out),
    chat: deepseek,
    deepseek,
    engine: out?.engine ?? null,
    text: out?.text ?? null,
    fallback,
    ms: Date.now() - started,
  });
});
