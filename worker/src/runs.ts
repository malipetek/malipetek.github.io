/*
 * Agentic run tracking.
 *
 * A ticket is the unit of client work; a run is one attempt at it by one
 * executor. Two callers use this module — the local runner (`/runner/*`, shared
 * secret) and the Harness admin session (`/admin/*`) — so a run claimed from
 * either place is recorded the same way and lands in one history.
 *
 * Mail is deliberately not sent from here: the caller owns notification, which
 * keeps this module free of imports from portal.ts (portal.ts imports it).
 */
import { now, type Env } from './shared.ts';

/** Bounds on what a run may report. A bad report must not be able to bill nonsense. */
export const MAX_SUMMARY = 8000;
export const MAX_DIFFSTAT = 4000;
export const MAX_DIFF = 40000;
export const MAX_RUN_COST_USD = 50;
export const MAX_EXECUTOR = 40;
export const MAX_MODEL = 80;

/** One message of the brief an executor works from. */
export interface BriefMessage {
  author: string;
  body: string;
  internal: number;
}

/** What a claim hands back. */
export interface Claimed {
  ticket: {
    id: number;
    title: string;
    status: string;
    attention: string;
    budget_cents: number | null;
    slug: string | null;
    project_name: string | null;
  };
  messages: BriefMessage[];
  runId: number;
  executor: string;
  model: string | null;
}

/** A normalized run report. */
export interface RunReport {
  ok: boolean;
  summary: string;
  branch: string;
  diffStat: string;
  diff: string;
  costUsd: number;
  executor: string;
  model: string | null;
}

/** The claim options any caller may pass. */
export interface Executor {
  executor?: unknown;
  model?: unknown;
}

/**
 * Name the thing that did the work. Free text, bounded — a new executor should
 * not need a migration.
 */
export function cleanExecutor(value: unknown, fallback = 'runner'): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().slice(0, MAX_EXECUTOR);
  return trimmed.length > 0 ? trimmed : fallback;
}

/** A provider model id, when the executor can name one. */
export function cleanModel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MAX_MODEL);
  return trimmed.length > 0 ? trimmed : null;
}

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

/**
 * Read a report off a request body, bounding everything and keeping a bad cost
 * from being billed.
 * @param body - the parsed request body.
 * @param fallbackExecutor - used when the caller named no executor.
 * @returns the normalized report.
 */
export function normalizeReport(body: unknown, fallbackExecutor = 'runner'): RunReport {
  const raw = (body ?? {}) as Record<string, unknown>;
  const ok = raw.ok === true;
  const summary = str(raw.summary, MAX_SUMMARY).trim() || (ok ? 'Done, no summary.' : 'Failed, no details.');
  const costUsd =
    typeof raw.costUsd === 'number' && Number.isFinite(raw.costUsd) && raw.costUsd > 0 && raw.costUsd <= MAX_RUN_COST_USD
      ? raw.costUsd
      : 0;
  return {
    ok,
    summary,
    branch: str(raw.branch, 200),
    diffStat: str(raw.diffStat, MAX_DIFFSTAT).trim(),
    diff: str(raw.diff, MAX_DIFF),
    costUsd,
    executor: cleanExecutor(raw.executor, fallbackExecutor),
    model: cleanModel(raw.model),
  };
}

/**
 * The private note a finished run leaves on the ticket.
 * @param report - the normalized report.
 * @returns the note body.
 */
export function runNote(report: RunReport): string {
  return [
    report.ok
      ? `${report.executor} finished${report.branch ? ` on branch ${report.branch}` : ''}.`
      : `${report.executor} failed.`,
    '',
    report.summary,
    report.diffStat && `\nChanged files:\n${report.diffStat}`,
    report.diff && `\nDiff${report.diff.length >= MAX_DIFF ? ' (truncated)' : ''}:\n${report.diff}`,
  ]
    .filter((part) => part !== '')
    .join('\n');
}

/** Open a run row and return its id (0 when the insert failed). */
async function openRun(env: Env, ticketId: number, executor: string, model: string | null, startedAt: number): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO ticket_runs (ticket_id, executor, model, status, started_at)
     VALUES (?, ?, ?, 'running', ?) RETURNING id`,
  )
    .bind(ticketId, executor, model, startedAt)
    .first<{ id: number }>();
  return row?.id ?? 0;
}

/**
 * The brief an executor works from: what the client asked, plus Ali's guidance.
 * Status lines and earlier run output are noise for the agent doing the work.
 */
async function brief(env: Env, ticketId: number): Promise<BriefMessage[]> {
  const { results } = await env.DB.prepare(
    `SELECT author, body, internal FROM ticket_messages
      WHERE ticket_id = ? AND author IN ('client', 'ali') ORDER BY id`,
  )
    .bind(ticketId)
    .all<BriefMessage>();
  return results ?? [];
}

/** Everything a claim returns about the ticket it took. */
async function claimedTicket(env: Env, ticketId: number) {
  return env.DB.prepare(
    `SELECT t.id, t.title, t.status, t.attention, t.budget_cents, p.slug, p.name AS project_name
       FROM tickets t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.id = ?`,
  )
    .bind(ticketId)
    .first<Claimed['ticket']>();
}

/**
 * Claim one specific ticket for a named executor.
 *
 * The flip is a single statement guarded by `status = 'approved'`, so two
 * executors racing for the same ticket cannot both win.
 *
 * @returns the ticket, its brief, and the run that now owns it; or an error code.
 */
export async function claimTicketById(
  env: Env,
  ticketId: number,
  options: Executor = {},
): Promise<{ ok: true; claimed: Claimed } | { ok: false; error: string }> {
  const executor = cleanExecutor(options.executor);
  const model = cleanModel(options.model);
  const t = now();

  const row = await env.DB.prepare(
    `UPDATE tickets SET status = 'in_progress', updated_at = ?
      WHERE id = ? AND status = 'approved' RETURNING id`,
  )
    .bind(t, ticketId)
    .first<{ id: number }>();
  if (!row) return { ok: false, error: 'not_claimable' };

  await env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'system', ?, ?)`)
    .bind(ticketId, 'Status changed to “In progress”.', t)
    .run();

  const runId = await openRun(env, ticketId, executor, model, t);
  const ticket = await claimedTicket(env, ticketId);
  if (!ticket) return { ok: false, error: 'not_found' };

  return { ok: true, claimed: { ticket, messages: await brief(env, ticketId), runId, executor, model } };
}

/**
 * Claim the oldest approved ticket among a set of project slugs.
 *
 * This is the local runner's entry point: it never names a ticket, it names the
 * projects it holds folders for. The pick and the flip are one statement, so a
 * second runner — or a double poll — can never take the same ticket.
 *
 * @returns the claim, or null when nothing is approved for those projects.
 */
export async function claimNextForSlugs(
  env: Env,
  slugs: string[],
  options: Executor = {},
): Promise<Claimed | null> {
  const executor = cleanExecutor(options.executor);
  const model = cleanModel(options.model);
  const t = now();

  const claimed = await env.DB.prepare(
    `UPDATE tickets SET status = 'in_progress', updated_at = ?
      WHERE status = 'approved' AND id = (
        SELECT t.id FROM tickets t JOIN projects p ON p.id = t.project_id
         WHERE t.status = 'approved' AND p.slug IN (${slugs.map(() => '?').join(',')})
         ORDER BY t.updated_at LIMIT 1)
      RETURNING id`,
  )
    .bind(t, ...slugs)
    .first<{ id: number }>();
  if (!claimed) return null;

  await env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'system', ?, ?)`)
    .bind(claimed.id, 'Status changed to “In progress”.', t)
    .run();

  const runId = await openRun(env, claimed.id, executor, model, t);
  const ticket = await claimedTicket(env, claimed.id);
  if (!ticket) return null;

  return { ticket, messages: await brief(env, claimed.id), runId, executor, model };
}

/**
 * Close the run that owns a ticket and move the ticket to review.
 *
 * Only an `in_progress` ticket may be reported on: a ticket Ali already moved
 * on wins over a late report. A report that arrives with no open run (a claim
 * from an older runner, or a crashed claim) still records one, so the history
 * has no holes.
 *
 * @returns the cost recorded, in micro-dollars, and the ticket title for the
 * caller's notification; or an error code.
 */
export async function finishRun(
  env: Env,
  ticketId: number,
  report: RunReport,
): Promise<{ ok: true; costMicroUsd: number; title: string } | { ok: false; error: string }> {
  const ticket = await env.DB.prepare(`SELECT id, title, status FROM tickets WHERE id = ?`)
    .bind(ticketId)
    .first<{ id: number; title: string; status: string }>();
  if (!ticket) return { ok: false, error: 'not_found' };
  if (ticket.status !== 'in_progress') return { ok: false, error: 'not_in_progress' };

  const t = now();
  const costMicroUsd = Math.round(report.costUsd * 1_000_000);
  const open = await env.DB.prepare(
    `SELECT id FROM ticket_runs WHERE ticket_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1`,
  )
    .bind(ticketId)
    .first<{ id: number }>();

  const statements = [];
  if (open) {
    statements.push(
      env.DB.prepare(
        `UPDATE ticket_runs
            SET executor = ?, model = ?, status = ?, cost_usd = ?, cost_micro_usd = ?,
                branch = ?, diff_stat = ?, diff = ?, summary = ?, finished_at = ?
          WHERE id = ?`,
      ).bind(
        report.executor,
        report.model,
        report.ok ? 'ok' : 'failed',
        report.costUsd,
        costMicroUsd,
        report.branch || null,
        report.diffStat || null,
        report.diff || null,
        report.summary,
        t,
        open.id,
      ),
    );
  } else {
    statements.push(
      env.DB.prepare(
        `INSERT INTO ticket_runs
           (ticket_id, executor, model, status, cost_usd, cost_micro_usd, branch, diff_stat, diff, summary, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        ticketId,
        report.executor,
        report.model,
        report.ok ? 'ok' : 'failed',
        report.costUsd,
        costMicroUsd,
        report.branch || null,
        report.diffStat || null,
        report.diff || null,
        report.summary,
        t,
        t,
      ),
    );
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'runner', ?, 1, ?)`,
    ).bind(ticketId, runNote(report), t),
    // Re-runs add up: the client pays for every run it took.
    env.DB.prepare(`UPDATE tickets SET status = 'review', ai_micro_usd = ai_micro_usd + ?, updated_at = ? WHERE id = ?`).bind(
      costMicroUsd,
      t,
      ticketId,
    ),
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'system', ?, ?)`).bind(
      ticketId,
      'Status changed to “In review”.',
      t,
    ),
  );

  await env.DB.batch(statements);
  return { ok: true, costMicroUsd, title: ticket.title };
}

/** Every run recorded for one ticket, oldest first. */
export async function ticketRuns(env: Env, ticketId: number) {
  const { results } = await env.DB.prepare(
    `SELECT id, executor, model, status, cost_micro_usd, cost_usd, branch, diff_stat, diff, summary, started_at, finished_at
       FROM ticket_runs WHERE ticket_id = ? ORDER BY id`,
  )
    .bind(ticketId)
    .all();
  return results ?? [];
}

/** Runs still going, for the fleet view. */
export async function openRuns(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.ticket_id, r.executor, r.model, r.started_at, t.title, t.status AS ticket_status, p.slug
       FROM ticket_runs r
       JOIN tickets t ON t.id = r.ticket_id
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE r.status = 'running' ORDER BY r.started_at`,
  ).all();
  return results ?? [];
}

/** The most recent runs across every ticket, newest first. */
export async function recentRuns(env: Env, limit = 40) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.ticket_id, r.executor, r.model, r.status, r.cost_micro_usd, r.started_at, r.finished_at,
            t.title, t.status AS ticket_status, p.slug
       FROM ticket_runs r
       JOIN tickets t ON t.id = r.ticket_id
       LEFT JOIN projects p ON p.id = t.project_id
      ORDER BY r.id DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return results ?? [];
}
