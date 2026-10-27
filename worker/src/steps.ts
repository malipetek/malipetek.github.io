/*
 * A run's live steps: what the agent is doing while it works.
 *
 * The node reads its agent's event stream (dsh --json, Claude Code's
 * stream-json, OpenCode's json) and sends the steps in small batches; the admin
 * views poll them while a run is live and fold them under the report after.
 * Steps are a view, not a record: bounded per run, trimmed per step, and the
 * session log (when there is one) stays the full account.
 */
import { now, type Env } from './shared.ts';

/** Steps kept per run; later ones are dropped, with one note saying so. */
export const STEP_LIMIT = 400;
/** Characters kept per step. */
export const STEP_TEXT = 600;
/** Steps accepted per batch. */
export const STEP_BATCH = 100;

export const STEP_KINDS = ['tool', 'text', 'error', 'node'] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export interface Step {
  at: number;
  kind: StepKind;
  text: string;
}

/** Read a batch off a request body, dropping anything malformed. */
export function cleanSteps(raw: unknown): Step[] {
  if (!Array.isArray(raw)) return [];
  const t = now();
  const out: Step[] = [];
  for (const item of raw.slice(0, STEP_BATCH)) {
    const step = item as Record<string, unknown>;
    if (!step || typeof step !== 'object') continue;
    const kind = (STEP_KINDS as readonly string[]).includes(String(step.kind)) ? (step.kind as StepKind) : null;
    const text = typeof step.text === 'string' ? step.text.trim().slice(0, STEP_TEXT) : '';
    if (!kind || !text) continue;
    // The node's clock, but never in the future and never before 2024.
    const at = typeof step.at === 'number' && Number.isFinite(step.at) && step.at > 1_700_000_000 && step.at <= t + 60 ? Math.floor(step.at) : t;
    out.push({ at, kind, text });
  }
  return out;
}

/**
 * Append steps to a running run the node holds. Past STEP_LIMIT the rest is
 * dropped, and one `node` step says how many were cut.
 * @returns how many were stored, or an error code.
 */
export async function appendSteps(env: Env, runId: number, nodeId: string, steps: Step[]): Promise<{ ok: true; stored: number } | { ok: false; error: string }> {
  const run = await env.DB.prepare(`SELECT id FROM ticket_runs WHERE id = ? AND node_id = ? AND status = 'running'`)
    .bind(runId, nodeId)
    .first();
  if (!run) return { ok: false, error: 'not_running' };
  if (!steps.length) return { ok: true, stored: 0 };
  const last = await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM run_steps WHERE run_id = ?').bind(runId).first<{ seq: number }>();
  let seq = last?.seq ?? 0;
  if (seq >= STEP_LIMIT) return { ok: true, stored: 0 };
  const room = STEP_LIMIT - seq;
  const kept = steps.length > room ? [...steps.slice(0, room - 1), { at: now(), kind: 'node' as const, text: `Step log full at ${STEP_LIMIT}; the rest is in the session log, if the run has one.` }] : steps;
  await env.DB.batch(
    kept.map((step) =>
      env.DB.prepare('INSERT INTO run_steps (run_id, seq, at, kind, text) VALUES (?, ?, ?, ?, ?)').bind(runId, (seq += 1), step.at, step.kind, step.text),
    ),
  );
  return { ok: true, stored: kept.length };
}

/** A run's steps after `after` (a seq), oldest first, and whether it still runs. */
export async function readSteps(env: Env, runId: number, after = 0) {
  const [{ results }, run] = await Promise.all([
    env.DB.prepare('SELECT seq, at, kind, text FROM run_steps WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?')
      .bind(runId, after, STEP_LIMIT)
      .all<{ seq: number; at: number; kind: StepKind; text: string }>(),
    env.DB.prepare('SELECT status FROM ticket_runs WHERE id = ?').bind(runId).first<{ status: string }>(),
  ]);
  return { found: run !== null, live: run?.status === 'running', steps: results ?? [] };
}
