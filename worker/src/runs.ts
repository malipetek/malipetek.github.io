/*
 * Agentic run tracking.
 *
 * A ticket is the unit of client work; a run is one attempt at it by one
 * executor. Two callers use this module — the fleet nodes (`/node/*`, shared
 * secret; claims live in queue.ts) and the Harness admin session (`/admin/*`) —
 * so a run claimed from either place is recorded the same way and lands in one history.
 *
 * Mail is deliberately not sent from here: the caller owns notification, which
 * keeps this module free of imports from portal.ts (portal.ts imports it).
 */
import { now, type Env } from './shared.ts';
import { ADMIN_LEASE_SECONDS } from './queue.ts';
import { withFiles, type FileMeta } from './files.ts';

/** Bounds on what a run may report. A bad report must not be able to bill nonsense. */
export const MAX_SUMMARY = 8000;
export const MAX_DIFFSTAT = 4000;
export const MAX_DIFF = 40000;
export const MAX_RUN_COST_USD = 50;
export const MAX_EXECUTOR = 40;
export const MAX_MODEL = 80;

/** One message of the brief an executor works from. */
export interface BriefMessage {
  id?: number;
  files?: FileMeta[];
  author: string;
  body: string;
  internal: number;
  created_at: number;
}

/**
 * An earlier run on the same ticket, as the next run needs to know it: what
 * was done, where the work is, and whether it worked. Without this a follow-up
 * ("now change the logo") looks like the whole task again, and every run
 * redoes the first one.
 */
export interface PriorRun {
  id: number;
  status: string;
  executor: string;
  node_id: string | null;
  branch: string | null;
  commit_sha: string | null;
  shared_to: 'origin' | 'bundle' | null;
  shared_ref: string | null;
  /** The Harness session it worked in, and whether its log is in R2. */
  session_id: string | null;
  session_dir: string | null;
  session_log: number;
  summary: string;
  finished_at: number | null;
}

const PRIOR_SUMMARY_CHARS = 1500;

/** Finished runs on a ticket, oldest first, excluding the one just opened. */
export async function priorRuns(env: Env, ticketId: number, currentRunId: number): Promise<PriorRun[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, status, executor, node_id, branch, commit_sha, shared_to, shared_ref, session_id, session_dir, session_log, substr(coalesce(summary, ''), 1, ?) AS summary, finished_at
       FROM ticket_runs
      WHERE ticket_id = ? AND id <> ? AND status IN ('ok', 'failed')
      ORDER BY id`,
  )
    .bind(PRIOR_SUMMARY_CHARS, ticketId, currentRunId)
    .all<PriorRun>();
  return results ?? [];
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
  /** Earlier runs on this ticket, oldest first. */
  previousRuns: PriorRun[];
  runId: number;
  executor: string;
  model: string | null;
}

/** A normalized run report. */
export interface RunReport {
  ok: boolean;
  summary: string;
  branch: string;
  /** The commit the run left, when it changed files. */
  commit: string;
  /** Where the next run can fetch it: the repo's remote, an R2 bundle, or nowhere. */
  sharedTo: 'origin' | 'bundle' | null;
  /** The branch on origin: the run's work branch, or the branch the project pushes to. */
  sharedRef: string;
  diffStat: string;
  diff: string;
  costUsd: number;
  executor: string;
  model: string | null;
  /** The Harness session the run worked in, when it ran through the Harness. */
  sessionId: string;
  /** That session's folder name under ~/.dsh/sessions/ on the node. */
  sessionDir: string;
  /** The node says it uploaded the session log (node.ts checks R2 before keeping it). */
  sessionLog: boolean;
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
    ...sharing(raw),
    diffStat: str(raw.diffStat, MAX_DIFFSTAT).trim(),
    diff: str(raw.diff, MAX_DIFF),
    costUsd,
    executor: cleanExecutor(raw.executor, fallbackExecutor),
    model: cleanModel(raw.model),
    ...session(raw),
  };
}

/*
 * The Harness session a run reports. Both values are stored, sent back in
 * headers and used by the Harness to name a folder, so they are held to a
 * strict shape: no slashes, no `..`, nothing a header or a path could misread.
 * A bad value is dropped, never a reason to reject the report.
 */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SESSION_DIR_RE = /^--[A-Za-z0-9._~-]{1,400}--$/;

export function cleanSessionId(value: unknown): string {
  return typeof value === 'string' && SESSION_ID_RE.test(value) && !value.includes('..') ? value : '';
}

export function cleanSessionDir(value: unknown): string {
  return typeof value === 'string' && SESSION_DIR_RE.test(value) && !value.includes('..') && !value.includes('/') ? value : '';
}

/** Where a run's session log lives in R2 (`FILES`). Written by node.ts, read by the admin download. */
export const sessionKey = (ticketId: number, runId: number) => `sessions/tickets/${ticketId}/run-${runId}.jsonl.zstd`;

function session(raw: Record<string, unknown>): Pick<RunReport, 'sessionId' | 'sessionDir' | 'sessionLog'> {
  return { sessionId: cleanSessionId(raw.sessionId), sessionDir: cleanSessionDir(raw.sessionDir), sessionLog: raw.sessionLog === true };
}

/*
 * A branch a run may report as shared: its own work branch, or the repo's
 * default branch. Bounded to what git accepts and a node would send — the
 * value is stored and printed, never used as a path.
 */
const SHARED_REF_RE = /^(?:malipetek\/(?:task|ticket)-\d+|[A-Za-z0-9][A-Za-z0-9._/-]{0,99})$/;

/** The commit and where it was shared, or nothing when any part is off. */
function sharing(raw: Record<string, unknown>): Pick<RunReport, 'commit' | 'sharedTo' | 'sharedRef'> {
  const commit = typeof raw.commit === 'string' && /^[0-9a-f]{40}$/.test(raw.commit) ? raw.commit : '';
  const sharedRef = typeof raw.sharedRef === 'string' && SHARED_REF_RE.test(raw.sharedRef) ? raw.sharedRef : '';
  const sharedTo = commit && (raw.sharedTo === 'origin' ? sharedRef !== '' : raw.sharedTo === 'bundle') ? (raw.sharedTo as 'origin' | 'bundle') : null;
  return { commit, sharedTo, sharedRef: sharedTo === 'origin' ? sharedRef : '' };
}

/** One line on where a run's work is, for the note and the email. */
export function sharedLine(report: Pick<RunReport, 'commit' | 'sharedTo' | 'sharedRef' | 'branch'>, nodeId?: string): string {
  const sha = report.commit.slice(0, 8);
  if (report.sharedTo === 'origin') {
    if (report.sharedRef.startsWith('malipetek/')) {
      return `Pushed to origin ${report.sharedRef} (${sha}); the next run starts from it on any node.`;
    }
    if (report.sharedRef === 'main' || report.sharedRef === 'master') {
      return `Pushed to origin ${report.sharedRef} (${sha}) — this run is on the project's main line.`;
    }
    return `Pushed to origin ${report.sharedRef} (${sha}) — visible there without touching production.`;
  }
  if (report.sharedTo === 'bundle') return `Saved as a git bundle in the portal (${sha}); the next run starts from it on any node.`;
  return report.branch ? `Only on ${nodeId ?? 'the node'}, branch ${report.branch}: not pushed, so a run on another node will not see it.` : '';
}

/**
 * The private note a finished run leaves on the ticket.
 * @param report - the normalized report.
 * @returns the note body.
 */
export function runNote(report: RunReport, nodeId?: string): string {
  return [
    report.ok
      ? `${report.executor} finished${report.branch ? ` on branch ${report.branch}` : ''}.`
      : `${report.executor} failed.`,
    sharedLine(report, nodeId),
    '',
    report.summary,
    report.diffStat && `\nChanged files:\n${report.diffStat}`,
    report.diff && `\nDiff${report.diff.length >= MAX_DIFF ? ' (truncated)' : ''}:\n${report.diff}`,
  ]
    .filter((part) => part !== '')
    .join('\n');
}

/**
 * Open a run row and return its id (0 when the insert failed). An admin claim
 * has no node to heartbeat for it, so it gets one long lease: an agent in the
 * Harness that never reports still lets go of the item eventually.
 */
async function openRun(env: Env, ticketId: number, executor: string, model: string | null, startedAt: number): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO ticket_runs (ticket_id, executor, model, status, lease_expires_at, attempt, started_at)
     VALUES (?, ?, ?, 'running', ?, (SELECT count(*) + 1 FROM ticket_runs WHERE ticket_id = ? AND released = 0), ?) RETURNING id`,
  )
    .bind(ticketId, executor, model, startedAt + ADMIN_LEASE_SECONDS, ticketId, startedAt)
    .first<{ id: number }>();
  return row?.id ?? 0;
}

/**
 * The brief an executor works from: what the client asked, plus Ali's guidance,
 * with their times so the newest instruction can be told from the background.
 * Earlier runs travel separately (priorRuns), summarised, not as raw notes.
 */
async function brief(env: Env, ticketId: number): Promise<BriefMessage[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, author, body, internal, created_at FROM ticket_messages
      WHERE ticket_id = ? AND author IN ('client', 'ali') ORDER BY id`,
  )
    .bind(ticketId)
    .all<BriefMessage & { id: number }>();
  return withFiles(env, ticketId, results ?? [], true);
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

  return {
    ok: true,
    claimed: { ticket, messages: await brief(env, ticketId), previousRuns: await priorRuns(env, ticketId, runId), runId, executor, model },
  };
}

/**
 * Close the run that owns a ticket and move the ticket to review.
 *
 * A ticket Ali already moved on wins over a late report: the run is closed and
 * its cost counted, but the ticket stays where he put it. A report that arrives
 * with no open run (a claim from an older runner, or a crashed claim) still
 * records one while the ticket is in progress, so the history has no holes.
 *
 * A node names the run it holds. That report is only accepted while the run is
 * still running and still the node's — a node that slept through its lease
 * cannot report over the run that replaced it.
 *
 * @returns the cost recorded, in micro-dollars, and the ticket title for the
 * caller's notification; or an error code.
 */
export async function finishRun(
  env: Env,
  ticketId: number,
  report: RunReport,
  owner?: { runId: number; nodeId: string },
): Promise<{ ok: true; costMicroUsd: number; title: string; late: boolean } | { ok: false; error: string }> {
  const ticket = await env.DB.prepare(`SELECT id, title, status FROM tickets WHERE id = ?`)
    .bind(ticketId)
    .first<{ id: number; title: string; status: string }>();
  if (!ticket) return { ok: false, error: 'not_found' };

  const t = now();
  const costMicroUsd = Math.round(report.costUsd * 1_000_000);
  const open = owner
    ? await env.DB.prepare(
        `SELECT id FROM ticket_runs WHERE id = ? AND ticket_id = ? AND node_id = ? AND status = 'running'`,
      )
        .bind(owner.runId, ticketId, owner.nodeId)
        .first<{ id: number }>()
    : await env.DB.prepare(
        `SELECT id FROM ticket_runs WHERE ticket_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1`,
      )
        .bind(ticketId)
        .first<{ id: number }>();
  if (owner && !open) return { ok: false, error: 'lease_lost' };
  // A report with no run of its own only counts while the ticket is being worked on.
  if (!open && ticket.status !== 'in_progress') return { ok: false, error: 'not_in_progress' };

  // A run Ali moved past (he changed the status while it worked, or requeued it
  // and another run took it) is still recorded and its AI cost still counts —
  // the money was spent — but it does not move the ticket. Done and declined
  // tickets have a closed bill, so a late cost there is noted, not added.
  const superseded = open
    ? await env.DB.prepare(`SELECT 1 FROM ticket_runs WHERE ticket_id = ? AND status = 'running' AND id > ?`)
        .bind(ticketId, open.id)
        .first()
    : null;
  const late = ticket.status !== 'in_progress' || Boolean(superseded);
  const billable = ticket.status !== 'done' && ticket.status !== 'declined';

  const statements = [];
  if (open) {
    statements.push(
      env.DB.prepare(
        `UPDATE ticket_runs
            SET executor = ?, model = ?, status = ?, cost_usd = ?, cost_micro_usd = ?,
                branch = ?, commit_sha = ?, shared_to = ?, shared_ref = ?,
                session_id = ?, session_dir = ?, session_log = ?, diff_stat = ?, diff = ?, summary = ?, finished_at = ?
          WHERE id = ? AND status = 'running'`,
      ).bind(
        report.executor,
        report.model,
        report.ok ? 'ok' : 'failed',
        report.costUsd,
        costMicroUsd,
        report.branch || null,
        report.commit || null,
        report.sharedTo,
        report.sharedRef || null,
        report.sessionId || null,
        report.sessionDir || null,
        report.sessionLog ? 1 : 0,
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
           (ticket_id, executor, model, status, cost_usd, cost_micro_usd, branch, commit_sha, shared_to, shared_ref,
            session_id, session_dir, session_log, diff_stat, diff, summary, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        ticketId,
        report.executor,
        report.model,
        report.ok ? 'ok' : 'failed',
        report.costUsd,
        costMicroUsd,
        report.branch || null,
        report.commit || null,
        report.sharedTo,
        report.sharedRef || null,
        report.sessionId || null,
        report.sessionDir || null,
        report.sessionLog ? 1 : 0,
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
    ).bind(ticketId, runNote(report, owner?.nodeId), t),
  );
  if (late) {
    if (billable && costMicroUsd > 0) {
      statements.push(
        env.DB.prepare('UPDATE tickets SET ai_micro_usd = ai_micro_usd + ? WHERE id = ?').bind(costMicroUsd, ticketId),
      );
    }
    statements.push(
      env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 1, ?)`).bind(
        ticketId,
        `Run ${open!.id} reported after the ticket had moved on; the status was left as it is.` +
          (costMicroUsd > 0 ? (billable ? '' : ` Its AI cost ($${report.costUsd.toFixed(4)}) was not added: the bill is closed.`) : ''),
        t,
      ),
    );
    await env.DB.batch(statements);
    return { ok: true, costMicroUsd: billable ? costMicroUsd : 0, title: ticket.title, late: true };
  }
  statements.push(
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
  return { ok: true, costMicroUsd, title: ticket.title, late: false };
}

/** Every run recorded for one ticket, oldest first. */
export async function ticketRuns(env: Env, ticketId: number) {
  const { results } = await env.DB.prepare(
    `SELECT id, executor, model, status, cost_micro_usd, cost_usd, branch, commit_sha, shared_to, shared_ref, diff_stat, diff, summary, started_at, finished_at,
            node_id, attempt, cancel_requested, session_id, session_dir, session_log
       FROM ticket_runs WHERE ticket_id = ? ORDER BY id`,
  )
    .bind(ticketId)
    .all();
  return results ?? [];
}

/** Runs still going, for the fleet view. */
export async function openRuns(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.ticket_id, r.executor, r.model, r.started_at, r.node_id, r.lease_expires_at, r.attempt,
            r.cancel_requested, r.session_id, r.session_dir, r.session_log, t.title, t.status AS ticket_status, p.slug
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
            r.node_id, r.attempt, r.session_id, r.session_dir, r.session_log, t.title, t.status AS ticket_status, p.slug
       FROM ticket_runs r
       JOIN tickets t ON t.id = r.ticket_id
       LEFT JOIN projects p ON p.id = t.project_id
      ORDER BY r.id DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return results ?? [];
}
