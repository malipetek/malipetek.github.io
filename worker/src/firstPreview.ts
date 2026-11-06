/*
 * The first preview: a new client's first request starts by itself.
 *
 * Until now nothing ran until Ali approved a request. A client who described a
 * new site at /portal/start had to wait for him before seeing anything. With
 * this, the first request of a new project is approved the moment the intake
 * assistant files it, and a node builds a rough first version onto the
 * project's preview.
 *
 * Deliberately narrow:
 *   - only through intake (this module is called from intake.ts's file_request),
 *   - only the first request of a project whose goal is a new site or app
 *     (an existing codebase the client connected is not a first preview),
 *   - only for a verified sign-in, and only once per account: Ali re-grants it
 *     in Admin -> Clients by clearing users.first_preview_at,
 *   - never past the account's limit (users.first_preview_limit_usd, else the
 *     first_preview_limit_usd setting; 0 turns it off).
 *
 * Who pays: nobody but us. The client's bill for a first preview is zero
 * (`billOf` in src/lib/pricing.js), and the AI run is capped at the limit and
 * carried by malipetek. It never publishes; the preview is where it ends.
 */
import { now, type Env } from './shared.ts';
import { getSettings } from './queue.ts';
import { money } from '../../src/lib/pricing.js';
import { portalLinks } from './links.ts';
import { siteView, type SiteRow } from './sites.ts';
import { tFor } from '../../src/i18n/eager.js';
import { mailAli, mailClient, replyAddress, REPLY_MARKER, siteUrl } from './portal.ts';

/** The facts the rule reads. Pure, so the rule is testable. */
export interface FirstPreviewFacts {
  /** projects.kind: 'new' is a site or app we build, 'existing' a codebase the client connected. */
  projectKind: string;
  /** Client requests already on the project, not counting the one being filed. */
  projectRequests: number;
  /** The account used its one first preview (users.first_preview_at is set). */
  accountUsed: boolean;
  /** The account signed in with a magic link (users.verified_at is set). */
  verified: boolean;
  /** The project has a hosted site for the preview to land on. */
  hasSite: boolean;
  /** This client's limit in cents; 0 disables it. */
  limitCents: number;
}

/**
 * The budget a first preview starts with, in cents, or null when this request
 * is not one. The budget is the AI cap: the queue stops claiming the ticket
 * when the AI spend reaches it.
 */
export function firstPreviewDecision(facts: FirstPreviewFacts): number | null {
  if (!Number.isInteger(facts.limitCents) || facts.limitCents <= 0) return null;
  if (!facts.verified || facts.accountUsed) return null;
  if (facts.projectKind !== 'new') return null;
  if (facts.projectRequests !== 0) return null;
  if (!facts.hasSite) return null;
  return facts.limitCents;
}

/** This client's limit in cents: their own override, else the setting. */
export function limitCentsFor(overrideUsd: number | null, settingUsd: number): number {
  const usd = typeof overrideUsd === 'number' && Number.isFinite(overrideUsd) ? overrideUsd : settingUsd;
  return Math.round(Math.max(0, usd) * 100);
}

/** The thread line the client reads when it starts (English in the database; TicketView translates it). */
export const STARTED_LINE = (limitCents: number) =>
  `First preview started: this one is free, with up to ${money(limitCents)} of AI, and it stops at that limit. Nothing goes live until you decide.`;

/** The thread line when the preview is built. */
export const READY_LINE = (previewUrl: string, connections: string) =>
  `First preview ready: ${previewUrl}. This is a rough first version. To keep going, reply here and Ali approves the next request, billed as usual, or connect ChatGPT or Claude at ${connections} and keep building on this preview yourself, which costs Ali nothing.`;

/** The thread line when nothing reached the preview. */
export const STOPPED_LINE = 'The first preview stopped before it reached the preview. Ali sees why, and he writes here.';

/**
 * Approve this request as a first preview, when the rule allows it.
 * Called by intake's file_request, right after the request is filed.
 *
 * @returns the AI limit in cents, or null when it is not a first preview.
 */
export async function maybeFirstPreview(env: Env, ticketId: number): Promise<number | null> {
  const ticket = await env.DB.prepare(
    `SELECT t.id, t.kind, t.status, t.project_id, t.user_id,
            p.kind AS project_kind,
            u.verified_at, u.first_preview_at, u.first_preview_limit_usd
       FROM tickets t
       JOIN projects p ON p.id = t.project_id
       JOIN users u ON u.id = t.user_id
      WHERE t.id = ?`,
  )
    .bind(ticketId)
    .first<{
      id: number;
      kind: string;
      status: string;
      project_id: string;
      user_id: string;
      project_kind: string;
      verified_at: number | null;
      first_preview_at: number | null;
      first_preview_limit_usd: number | null;
    }>();
  // Only a request intake just filed, and only a client's own request.
  if (!ticket || ticket.kind !== 'client' || ticket.status !== 'new' || !ticket.project_id) return null;

  const [others, site, settings] = await Promise.all([
    env.DB.prepare(`SELECT count(*) AS n FROM tickets WHERE project_id = ? AND kind = 'client' AND id <> ?`)
      .bind(ticket.project_id, ticketId)
      .first<{ n: number }>(),
    env.DB.prepare(`SELECT 1 FROM sites WHERE project_id = ? LIMIT 1`).bind(ticket.project_id).first(),
    getSettings(env),
  ]);

  const limitCents = limitCentsFor(ticket.first_preview_limit_usd, settings.first_preview_limit_usd);
  const decision = firstPreviewDecision({
    projectKind: ticket.project_kind,
    projectRequests: others?.n ?? 0,
    accountUsed: ticket.first_preview_at !== null,
    verified: ticket.verified_at !== null,
    hasSite: Boolean(site),
    limitCents,
  });
  if (decision === null) return null;

  // One first preview per account: the claim is the lock, so two intake turns
  // filing at once cannot both start one.
  const t = now();
  const claimed = await env.DB.prepare(
    `UPDATE users SET first_preview_at = ? WHERE id = ? AND first_preview_at IS NULL RETURNING id`,
  )
    .bind(t, ticket.user_id)
    .first<{ id: string }>();
  if (!claimed) return null;

  const moved = await env.DB.prepare(
    `UPDATE tickets SET first_preview = 1, status = 'approved', budget_cents = ?, updated_at = ?, stalled_alerted_at = NULL
      WHERE id = ? AND status = 'new' RETURNING id`,
  )
    .bind(decision, t, ticketId)
    .first<{ id: number }>();
  if (!moved) {
    // The request moved on under us: give the account its first preview back.
    await env.DB.prepare(`UPDATE users SET first_preview_at = NULL WHERE id = ? AND first_preview_at = ?`)
      .bind(ticket.user_id, t)
      .run();
    return null;
  }

  await env.DB.prepare(
    `INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 0, ?)`,
  )
    .bind(ticketId, STARTED_LINE(decision), t)
    .run();
  return decision;
}

/** The project's preview address, once a real deploy is on it. */
async function previewUrlFor(env: Env, projectId: string): Promise<string | null> {
  const site = await env.DB.prepare(
    `SELECT * FROM sites WHERE project_id = ? AND is_primary = 1 AND state = 'ready'`,
  )
    .bind(projectId)
    .first<SiteRow>();
  if (!site || !site.preview_deploy || site.preview_deploy === 'placeholder') return null;
  const { sitesDomain } = await getSettings(env);
  return siteView(site, sitesDomain)?.previewUrl ?? null;
}

/**
 * Tell the client their first preview is ready (or that it stopped), once.
 *
 * Called after a run on the ticket reports, and by the five-minute cron for a
 * first preview whose budget ran out with no run left to report.
 */
export async function completeFirstPreview(env: Env, ticketId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT t.id, t.title, t.status, t.first_preview_done_at, t.project_id, u.email, u.locale
       FROM tickets t JOIN users u ON u.id = t.user_id
      WHERE t.id = ? AND t.first_preview = 1`,
  )
    .bind(ticketId)
    .first<{
      id: number;
      title: string;
      status: string;
      first_preview_done_at: number | null;
      project_id: string | null;
      email: string;
      locale: string | null;
    }>();
  if (!row || row.first_preview_done_at !== null) return false;

  const t = now();
  const claimed = await env.DB.prepare(
    `UPDATE tickets SET first_preview_done_at = ? WHERE id = ? AND first_preview_done_at IS NULL RETURNING id`,
  )
    .bind(t, ticketId)
    .first<{ id: number }>();
  if (!claimed) return false;
  // A first preview Ali declined has nothing to announce.
  if (row.status === 'declined') return true;

  const previewUrl = row.project_id ? await previewUrlFor(env, row.project_id) : null;
  const connections = portalLinks(env).connections;

  if (!previewUrl) {
    // Nothing to look at: the thread says so, Ali has the run's own report.
    await env.DB.prepare(
      `INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 0, ?)`,
    )
      .bind(ticketId, STOPPED_LINE, t)
      .run();
    return true;
  }

  await env.DB.prepare(
    `INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 0, ?)`,
  )
    .bind(ticketId, READY_LINE(previewUrl, connections), t)
    .run();

  // The client reads it in their own language, through the same mail catalog
  // the rest of the portal mail uses.
  const tr = tFor(row.locale);
  const footer = tr('mail.footer.thread', { url: portalLinks(env).ticket(ticketId) });
  await mailClient(env, row.email, {
    subject: tr('mail.firstPreview.subject', { title: row.title }),
    text: `${REPLY_MARKER}\n\n${tr('mail.firstPreview.body', { url: previewUrl, agents: connections })}\n\n-- \n${footer}`,
    replyTo: await replyAddress(env, ticketId, 'c'),
  });
  return true;
}

/**
 * The cron's sweep: a first preview that finished without a report, or whose
 * limit was reached with no run left to claim it, still gets told.
 */
export async function sweepFirstPreviews(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.status FROM tickets t
      WHERE t.first_preview = 1 AND t.first_preview_done_at IS NULL AND t.status IN ('review', 'done', 'declined')
      LIMIT 20`,
  ).all<{ id: number; status: string }>();
  let done = 0;
  for (const row of results ?? []) if (await completeFirstPreview(env, row.id)) done += 1;

  // The limit is spent and no node will claim it again: close the loop.
  const { results: stuck } = await env.DB.prepare(
    `SELECT t.id FROM tickets t
      WHERE t.first_preview = 1 AND t.first_preview_done_at IS NULL AND t.status = 'approved'
        AND t.budget_cents IS NOT NULL AND (t.ai_micro_usd + 9999) / 10000 >= t.budget_cents
      LIMIT 20`,
  ).all<{ id: number }>();
  for (const row of stuck ?? []) if (await completeFirstPreview(env, row.id)) done += 1;
  return done;
}

/** Ali's mail about a first preview that started by itself: the new-request mail, with the limit. */
export async function mailAliFirstPreview(env: Env, to: string, ticketId: number, title: string, body: string, limitCents: number) {
  const link = siteUrl(env) + `/portal/admin#ticket=${ticketId}`;
  await mailAli(env, {
    subject: `[#${ticketId}] First preview started for ${to}: ${title}`,
    text:
      `${body}\n\n` +
      `This is ${to}'s first preview. It started automatically, with an AI limit of ${money(limitCents)}. ` +
      `Nothing goes live.\n\nOpen: ${link}`,
    replyTo: await replyAddress(env, ticketId, 'a'),
  });
}
