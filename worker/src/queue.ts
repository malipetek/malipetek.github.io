/*
 * The work queue: nodes, leases, and why an item is waiting.
 *
 * A node is a machine that runs work — this MacBook, the G500, later a
 * Cloudflare sandbox. It heartbeats every half minute with what it can do
 * (capabilities, executors, the project folders it holds, how many runs it will
 * hold at once), and claims one approved item at a time. A claim is a lease: the
 * node renews it on every heartbeat, and a run whose node goes quiet expires and
 * its item goes back to the queue.
 *
 * Everything that used to be invisible gets a name here. "No node is online",
 * "the node that has this folder is asleep", "nothing has the capability this
 * needs" — `queueView` says which, and the cron in cloudflare.ts mails Ali once
 * when an item has waited too long for a node that is not coming.
 */
import { now, type Env } from './shared.ts';
import { HOURLY_USD, money, priceOf } from '../../src/lib/pricing.js';
import { priorRuns, type PriorRun } from './runs.ts';
import { withFiles, type FileMeta } from './files.ts';

/**
 * What a ticket has cost so far, in cents, as SQL over `t` — the same rounding
 * as `priceOf` (time and AI each rounded up to the cent). Bind HOURLY_USD as ?6.
 */
const SPENT_CENTS_SQL = `((t.human_seconds * ?6 * 100 + 3599) / 3600 + (t.ai_micro_usd + 9999) / 10000)`;

/** The budget left, in cents, or null when the client set none. */
export function budgetLeft(item: { budget_cents: number | null; human_seconds: number; ai_micro_usd: number }): number | null {
  if (item.budget_cents === null) return null;
  return item.budget_cents - priceOf({ humanSeconds: item.human_seconds, aiMicroUsd: item.ai_micro_usd }).totalCents;
}

/** A node that has not heartbeated for this long is offline. Nodes beat every 30s. */
export const ONLINE_SECONDS = 90;
/** A claim lasts this long unless the node renews it. */
export const LEASE_SECONDS = 180;
/** An admin claim (an agent in the Harness) has no heartbeat, so it gets longer. */
export const ADMIN_LEASE_SECONDS = 4 * 3600;
/** A cancelled run gets this long to report before the reaper takes it. */
const CANCEL_GRACE_SECONDS = 60;
/* ——————————————————————— settings ——————————————————————— */

/**
 * System-wide settings, editable from both admin views. Defaults live here; the
 * `settings` table holds only what Ali changed.
 */
export const SETTING_DEFAULTS = {
  /** An approved item no node can take is mailed to Ali after this many minutes. 0 = never. */
  stallMinutes: 30,
  /** After this many expired leases an item goes to review instead of round again. */
  maxAttempts: 3,
  /** Mail Ali when a run finishes. Off leaves the admin views as the only signal. */
  notifyRunFinished: true,
  /** Priority a new system task gets when the form does not say. */
  defaultPriority: 0,
  /** The domain hosted sites live under: `<site>.<domain>`, `<site>-preview.<domain>`. */
  sitesDomain: 'gptflare.site',
  /** A client may publish their own preview to production. Off = only Ali publishes. */
  clientPublish: false,
};
export type Settings = typeof SETTING_DEFAULTS;

const SETTING_RULES: { [K in keyof Settings]: (v: unknown) => Settings[K] | undefined } = {
  stallMinutes: (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1440 ? v : undefined),
  maxAttempts: (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10 ? v : undefined),
  notifyRunFinished: (v) => (typeof v === 'boolean' ? v : undefined),
  defaultPriority: (v) => (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= 100 ? v : undefined),
  sitesDomain: (v) =>
    typeof v === 'string' && /^(?=.{3,100}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(v.trim().toLowerCase())
      ? v.trim().toLowerCase()
      : undefined,
  clientPublish: (v) => (typeof v === 'boolean' ? v : undefined),
};

export async function getSettings(env: Env): Promise<Settings> {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const row of results ?? []) {
    const rule = SETTING_RULES[row.key as keyof Settings];
    if (!rule) continue;
    try {
      const value = rule(JSON.parse(row.value));
      if (value !== undefined) out[row.key] = value;
    } catch {
      /* a bad row reads as the default */
    }
  }
  return out as Settings;
}

/** Save the settings in `patch` that pass their rule. Returns the keys it rejected. */
export async function saveSettings(env: Env, patch: Record<string, unknown>): Promise<string[]> {
  const rejected: string[] = [];
  const statements = [];
  for (const [key, raw] of Object.entries(patch)) {
    const rule = SETTING_RULES[key as keyof Settings];
    const value = rule ? rule(raw) : undefined;
    if (value === undefined) {
      rejected.push(key);
      continue;
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(key, JSON.stringify(value), now()),
    );
  }
  if (!rejected.length && statements.length) await env.DB.batch(statements);
  return rejected;
}

/**
 * Capabilities the admin views offer as buttons. Nodes may report others; the
 * views add whatever any node reports to this list.
 */
export const CAPABILITY_CATALOG = [
  { id: 'os:macos', label: 'macOS', hint: 'Xcode, iOS simulators, Apple tooling' },
  { id: 'os:linux', label: 'Linux', hint: 'the G500, servers' },
  { id: 'xcode', label: 'Xcode', hint: 'iOS / macOS builds' },
  { id: 'android', label: 'Android SDK', hint: 'Android builds and emulators' },
  { id: 'docker', label: 'Docker', hint: 'containers' },
  { id: 'gpu', label: 'GPU', hint: 'local models, rendering' },
  { id: 'always-on', label: 'Always on', hint: 'never sleeps — long jobs' },
  { id: 'sandbox', label: 'Cloud sandbox', hint: 'Cloudflare, later' },
];
export const EXECUTOR_CATALOG = [
  { id: 'claude', label: 'Claude Code', hint: 'sandboxed; the only one allowed for client work' },
  { id: 'opencode', label: 'OpenCode', hint: 'system tasks only' },
  { id: 'dsh', label: 'DeepSeek Harness', hint: 'system tasks only; the Harness in one shot' },
  { id: 'devin', label: 'Devin', hint: 'system tasks only; approves its own permissions' },
  { id: 'dsh-claude', label: 'Claude Code in the Harness', hint: 'system tasks only; Claude Code driven from a Harness session' },
  { id: 'dsh-opencode', label: 'OpenCode in the Harness', hint: 'system tasks only; OpenCode driven from a Harness session' },
  { id: 'dsh-devin', label: 'Devin in the Harness', hint: 'system tasks only; Devin (SWE-2) driven from a Harness session' },
];

export const EXECUTORS = ['claude', 'opencode', 'dsh', 'devin', 'dsh-claude', 'dsh-opencode', 'dsh-devin'] as const;
/**
 * System work with no pinned executor takes the first of these the node runs:
 * Harness executors first, so every run has a conversation to open. The node
 * falls back down the same order on a usage limit (fleet/executors.mjs).
 */
export const SYSTEM_ORDER = ['dsh-claude', 'dsh', 'devin', 'dsh-opencode', 'claude', 'opencode'];
/** Client work runs only on the sandboxed executor (worktree, allow-listed tools, no MCP). */
export const CLIENT_EXECUTOR = 'claude';

const MAX_LIST = 32;
const TOKEN_RE = /^[a-z0-9][a-z0-9:._-]{0,47}$/;

/* ——————————————————————— small parsers ——————————————————————— */

/** A bounded list of short lowercase tokens: capabilities, executors, slugs. */
export function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const token = item.trim().toLowerCase();
    if (TOKEN_RE.test(token)) out.add(token);
    if (out.size >= MAX_LIST) break;
  }
  return [...out];
}

function parseList(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  try {
    return cleanList(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** A pinned executor, or null for "let the node choose". undefined = invalid. */
export function cleanExecutorPin(value: unknown): string | null | undefined {
  if (value === null || value === '' || value === undefined) return null;
  return typeof value === 'string' && (EXECUTORS as readonly string[]).includes(value) ? value : undefined;
}

/* ——————————————————————— nodes ——————————————————————— */

export interface NodeReport {
  id: string;
  hostname: string;
  os: string;
  capabilities: string[];
  executors: string[];
  slugs: string[];
  slots: number;
  version: string;
  /** JSON, bounded. Whatever the node says about itself; the views render it. */
  health: string;
}

const MAX_HEALTH_CHARS = 16_000;

/** Node settings Ali may set from an admin view. */
export interface NodeOverrides {
  slots?: number;
  capabilities?: string[];
  executors?: string[];
  /** Mail Ali when this node has been offline this many minutes. 0 or absent = never. */
  alertOfflineMinutes?: number;
}

/** Validate an overrides patch. null values clear a setting. */
export function cleanOverrides(body: unknown, current: NodeOverrides): NodeOverrides | null {
  const raw = (body ?? {}) as Record<string, unknown>;
  const out: NodeOverrides = { ...current };
  if ('slots' in raw) {
    if (raw.slots === null) delete out.slots;
    else if (typeof raw.slots === 'number' && Number.isInteger(raw.slots) && raw.slots >= 1 && raw.slots <= 8) out.slots = raw.slots;
    else return null;
  }
  if ('capabilities' in raw) {
    if (raw.capabilities === null) delete out.capabilities;
    else if (Array.isArray(raw.capabilities)) out.capabilities = cleanList(raw.capabilities);
    else return null;
  }
  if ('executors' in raw) {
    if (raw.executors === null) delete out.executors;
    else if (Array.isArray(raw.executors)) out.executors = cleanList(raw.executors).filter((e) => (EXECUTORS as readonly string[]).includes(e));
    else return null;
  }
  if ('alertOfflineMinutes' in raw) {
    const v = raw.alertOfflineMinutes;
    if (v === null || v === 0) delete out.alertOfflineMinutes;
    else if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 10080) out.alertOfflineMinutes = v;
    else return null;
  }
  return out;
}

function parseObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** Read a node's self-description off a heartbeat body. null when it has no usable id. */
export function cleanNodeReport(body: unknown): NodeReport | null {
  const raw = (body ?? {}) as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return null;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const slots = typeof raw.slots === 'number' && Number.isInteger(raw.slots) ? Math.min(Math.max(raw.slots, 1), 8) : 1;
  return {
    id,
    hostname: str(raw.hostname, 80),
    os: str(raw.os, 20).toLowerCase(),
    capabilities: cleanList(raw.capabilities),
    executors: cleanList(raw.executors).filter((e) => (EXECUTORS as readonly string[]).includes(e)),
    slugs: cleanList(raw.slugs),
    slots,
    version: str(raw.version, 40),
    health: (() => {
      if (!raw.health || typeof raw.health !== 'object') return '{}';
      const text = JSON.stringify(raw.health);
      return text.length <= MAX_HEALTH_CHARS ? text : JSON.stringify({ error: 'health report too large' });
    })(),
  };
}

export interface NodeRow {
  id: string;
  hostname: string;
  os: string;
  capabilities: string;
  executors: string;
  slugs: string;
  slots: number;
  version: string;
  draining: number;
  last_seen_at: number;
  created_at: number;
  health: string;
  overrides: string;
  offline_alerted_at: number | null;
}

/**
 * Record a heartbeat and renew the leases of the runs the node says it holds.
 *
 * A run is only renewed for the node that owns it and only while it is still
 * running and not cancelled — so a node that comes back from sleep cannot
 * resurrect a run the reaper already handed to someone else.
 *
 * @returns whether the node is draining, and which of its runs to stop.
 */
export async function heartbeat(env: Env, node: NodeReport, running: number[]) {
  const t = now();
  const statements = [
    env.DB.prepare(
      `INSERT INTO nodes (id, hostname, os, capabilities, executors, slugs, slots, version, health, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET hostname = excluded.hostname, os = excluded.os,
         capabilities = excluded.capabilities, executors = excluded.executors, slugs = excluded.slugs,
         slots = excluded.slots, version = excluded.version, health = excluded.health,
         last_seen_at = excluded.last_seen_at, offline_alerted_at = NULL`,
    ).bind(
      node.id,
      node.hostname,
      node.os,
      JSON.stringify(node.capabilities),
      JSON.stringify(node.executors),
      JSON.stringify(node.slugs),
      node.slots,
      node.version,
      node.health,
      t,
      t,
    ),
  ];
  const ids = running.filter((id) => Number.isInteger(id) && id > 0).slice(0, 16);
  if (ids.length) {
    statements.push(
      env.DB.prepare(
        `UPDATE ticket_runs SET lease_expires_at = ?
          WHERE node_id = ? AND status = 'running' AND cancel_requested = 0
            AND id IN (${ids.map(() => '?').join(',')})`,
      ).bind(t + LEASE_SECONDS, node.id, ...ids),
    );
  }
  await env.DB.batch(statements);

  const [row, cancelled, lost] = await Promise.all([
    env.DB.prepare('SELECT draining, overrides FROM nodes WHERE id = ?').bind(node.id).first<{ draining: number; overrides: string }>(),
    env.DB.prepare(
      `SELECT id FROM ticket_runs WHERE node_id = ? AND status = 'running' AND cancel_requested = 1`,
    )
      .bind(node.id)
      .all<{ id: number }>(),
    // Runs the node thinks it holds but the queue no longer gives it: stop them.
    ids.length
      ? env.DB.prepare(
          `SELECT id FROM ticket_runs WHERE id IN (${ids.map(() => '?').join(',')})
             AND (node_id IS NOT ? OR status <> 'running')`,
        )
          .bind(...ids, node.id)
          .all<{ id: number }>()
      : Promise.resolve({ results: [] as { id: number }[] }),
  ]);
  // Work the admin asked to land on its main line, for the projects this node
  // holds. The node does the git; the Worker has no repo credentials.
  const { results: land } = node.slugs.length
    ? await env.DB.prepare(
        `SELECT t.id AS ticket_id, t.kind, p.slug
           FROM tickets t JOIN projects p ON p.id = t.project_id
          WHERE t.land_requested_at IS NOT NULL AND t.status <> 'in_progress'
            AND p.slug IN (${node.slugs.map(() => '?').join(',')})
          ORDER BY t.land_requested_at LIMIT 5`,
      )
        .bind(...node.slugs)
        .all<{ ticket_id: number; kind: string; slug: string }>()
    : { results: [] as { ticket_id: number; kind: string; slug: string }[] };

  return {
    draining: row?.draining === 1,
    cancel: [...(cancelled.results ?? []), ...(lost.results ?? [])].map((r) => r.id),
    leaseSeconds: LEASE_SECONDS,
    land: (land ?? []).map((item) => ({
      ticketId: item.ticket_id,
      slug: item.slug,
      shared: `malipetek/${item.kind === 'client' ? 'ticket' : 'task'}-${item.ticket_id}`,
    })),
    // Applied by the node on receipt, and reported back as its effective config
    // on the next beat — so what the views show is what the node is doing.
    overrides: parseObject(row?.overrides),
  };
}

/* ——————————————————————— the reaper ——————————————————————— */

/**
 * Close every run whose lease has lapsed and put its item back.
 *
 * Called on every claim, every admin queue read, and from the cron, so nothing
 * depends on any one of them running. A cancelled run goes to review (Ali asked
 * for it to stop, so it must not simply run again); an item that has expired
 * `maxAttempts` times (a setting) also goes to review rather than round the loop
 * for ever.
 *
 * @returns how many runs it closed.
 */
export async function reapExpired(env: Env): Promise<number> {
  const t = now();
  const { maxAttempts } = await getSettings(env);
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.ticket_id, r.node_id, r.attempt, r.cancel_requested, t.status AS ticket_status,
            EXISTS (SELECT 1 FROM ticket_runs n WHERE n.ticket_id = r.ticket_id AND n.status = 'running' AND n.id > r.id) AS superseded
       FROM ticket_runs r JOIN tickets t ON t.id = r.ticket_id
      WHERE r.status = 'running' AND r.lease_expires_at IS NOT NULL AND r.lease_expires_at < ?
      LIMIT 20`,
  )
    .bind(t)
    .all<{ id: number; ticket_id: number; node_id: string | null; attempt: number; cancel_requested: number; ticket_status: string; superseded: number }>();
  if (!results?.length) return 0;

  const statements = [];
  for (const run of results) {
    const where = run.node_id ? `on ${run.node_id}` : 'in the Harness';
    const toReview = run.cancel_requested === 1 || run.attempt >= maxAttempts;
    const why =
      run.cancel_requested === 1
        ? `Run ${run.id} ${where} was cancelled and did not report back.`
        : `Run ${run.id} ${where} stopped reporting (lease expired, attempt ${run.attempt}).`;
    statements.push(
      env.DB.prepare(
        `UPDATE ticket_runs SET status = 'failed', summary = ?, finished_at = ? WHERE id = ? AND status = 'running'`,
      ).bind(why, t, run.id),
    );
    // Only move the item if it is still the one this run held: not when Ali
    // moved it on, and not when a newer run has taken it since.
    if (run.ticket_status === 'in_progress' && !run.superseded) {
      const next = toReview ? 'review' : 'approved';
      statements.push(
        env.DB.prepare(`UPDATE tickets SET status = ?, updated_at = ? WHERE id = ? AND status = 'in_progress'`).bind(
          next,
          t,
          run.ticket_id,
        ),
        env.DB.prepare(
          `INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 1, ?)`,
        ).bind(
          run.ticket_id,
          `${why} ${toReview ? (run.cancel_requested === 1 ? 'Moved to review.' : `Gave up after ${run.attempt} attempts; moved to review.`) : 'Back in the queue.'}`,
          t,
        ),
      );
    }
  }
  await env.DB.batch(statements);
  return results.length;
}

/* ——————————————————————— claim ——————————————————————— */

export interface NodeClaim {
  ticket: {
    id: number;
    title: string;
    kind: string;
    source: string;
    priority: number;
    attention: string;
    budget_cents: number | null;
    slug: string;
    project_name: string;
  };
  /** With `files`: fetch each from GET /node/tickets/:id/files/:fileId while the run holds the ticket. */
  messages: { id: number; author: string; body: string; internal: number; created_at: number; files?: FileMeta[] }[];
  /** Earlier runs on this ticket, oldest first: what they did and where. */
  previousRuns: PriorRun[];
  runId: number;
  executor: string;
  attempt: number;
  leaseSeconds: number;
  /** The most this run may spend on AI, when the client set a budget: what is left of it. */
  maxBudgetUsd?: number;
}

/**
 * Lease the best approved item this node can take.
 *
 * Eligible means: its project is one the node holds a folder for, every
 * capability it requires is one the node has, its pinned executor (if any) is
 * one the node runs, and — for client work — the node runs the sandboxed
 * executor, and — when the client set a budget — some of it is left. Best
 * means highest priority, then longest waiting. The pick and the
 * flip are one statement, so two nodes can never take the same item.
 *
 * @returns the claim, or null with a reason a human can read.
 */
export async function claimForNode(env: Env, nodeId: string): Promise<{ claim: NodeClaim | null; reason?: string }> {
  await reapExpired(env);
  const node = await env.DB.prepare('SELECT * FROM nodes WHERE id = ?').bind(nodeId).first<NodeRow>();
  if (!node) return { claim: null, reason: 'unknown_node' };
  if (node.draining === 1) return { claim: null, reason: 'draining' };
  const busy = await env.DB.prepare(`SELECT count(*) AS n FROM ticket_runs WHERE node_id = ? AND status = 'running'`)
    .bind(nodeId)
    .first<{ n: number }>();
  if ((busy?.n ?? 0) >= node.slots) return { claim: null, reason: 'no_free_slot' };

  const t = now();
  const picked = await env.DB.prepare(
    `UPDATE tickets SET status = 'in_progress', updated_at = ?, stalled_alerted_at = NULL
      WHERE status = 'approved' AND id = (
        SELECT t.id FROM tickets t JOIN projects p ON p.id = t.project_id
         WHERE t.status = 'approved'
           AND p.slug IN (SELECT value FROM json_each(?2))
           AND NOT EXISTS (SELECT 1 FROM json_each(t.requires) r
                            WHERE r.value NOT IN (SELECT value FROM json_each(?3)))
           AND (t.executor IS NULL OR t.executor IN (SELECT value FROM json_each(?4)))
           AND (t.kind <> 'client' OR ?5 IN (SELECT value FROM json_each(?4)))
           AND (t.budget_cents IS NULL OR ${SPENT_CENTS_SQL} < t.budget_cents)
         ORDER BY t.priority DESC, t.updated_at LIMIT 1)
      RETURNING id, kind, executor, budget_cents, human_seconds, ai_micro_usd`,
  )
    .bind(t, node.slugs, node.capabilities, node.executors, CLIENT_EXECUTOR, HOURLY_USD)
    .first<{ id: number; kind: string; executor: string | null; budget_cents: number | null; human_seconds: number; ai_micro_usd: number }>();
  if (!picked) return { claim: null, reason: 'nothing_eligible' };

  const executors = parseList(node.executors);
  const executor =
    picked.kind === 'client'
      ? CLIENT_EXECUTOR
      : (picked.executor ?? SYSTEM_ORDER.find((e) => executors.includes(e)) ?? executors[0] ?? CLIENT_EXECUTOR);
  const prior = await env.DB.prepare('SELECT count(*) AS n FROM ticket_runs WHERE ticket_id = ? AND released = 0')
    .bind(picked.id)
    .first<{ n: number }>();
  const attempt = (prior?.n ?? 0) + 1;

  const [run] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ticket_runs (ticket_id, executor, status, node_id, lease_expires_at, attempt, started_at)
       VALUES (?, ?, 'running', ?, ?, ?, ?) RETURNING id`,
    ).bind(picked.id, executor, nodeId, t + LEASE_SECONDS, attempt, t),
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'system', ?, ?)`).bind(
      picked.id,
      'Status changed to “In progress”.',
      t,
    ),
  ]);
  const runId = (run.results?.[0] as { id?: number } | undefined)?.id ?? 0;

  const ticket = await env.DB.prepare(
    `SELECT t.id, t.title, t.kind, t.source, t.priority, t.attention, t.budget_cents, p.slug, p.name AS project_name
       FROM tickets t JOIN projects p ON p.id = t.project_id WHERE t.id = ?`,
  )
    .bind(picked.id)
    .first<NodeClaim['ticket']>();
  const { results: rows } = await env.DB.prepare(
    `SELECT id, author, body, internal, created_at FROM ticket_messages
      WHERE ticket_id = ? AND author IN ('client', 'ali') ORDER BY id`,
  )
    .bind(picked.id)
    .all<NodeClaim['messages'][number]>();
  // The agent reads private notes, so it gets their files too.
  const messages = await withFiles(env, picked.id, rows ?? [], true);
  const previousRuns = await priorRuns(env, picked.id, runId);
  if (!ticket) return { claim: null, reason: 'vanished' };
  const left = budgetLeft(picked);
  return {
    claim: {
      ticket,
      messages,
      previousRuns,
      runId,
      executor,
      attempt,
      leaseSeconds: LEASE_SECONDS,
      ...(left !== null ? { maxBudgetUsd: Math.max(0.01, left / 100) } : {}),
    },
  };
}

/* ——————————————————————— the views ——————————————————————— */

const isOnline = (node: NodeRow, t: number) => t - node.last_seen_at <= ONLINE_SECONDS;

/** Every node, with whether it is online and what it is running. */
export async function nodesView(env: Env) {
  const t = now();
  const [{ results: nodes }, { results: running }] = await Promise.all([
    env.DB.prepare('SELECT * FROM nodes ORDER BY id').all<NodeRow>(),
    env.DB.prepare(
      `SELECT r.id, r.node_id, r.ticket_id, r.executor, r.started_at, r.lease_expires_at, r.cancel_requested, t.title
         FROM ticket_runs r JOIN tickets t ON t.id = r.ticket_id WHERE r.status = 'running'`,
    ).all<{ id: number; node_id: string | null; ticket_id: number; executor: string; started_at: number; lease_expires_at: number | null; cancel_requested: number; title: string }>(),
  ]);
  return (nodes ?? []).map((node) => ({
    id: node.id,
    hostname: node.hostname,
    os: node.os,
    capabilities: parseList(node.capabilities),
    executors: parseList(node.executors),
    slugs: parseList(node.slugs),
    slots: node.slots,
    version: node.version,
    draining: node.draining === 1,
    online: isOnline(node, t),
    lastSeenAt: node.last_seen_at,
    health: parseObject(node.health),
    overrides: parseObject(node.overrides) as NodeOverrides,
    running: (running ?? []).filter((r) => r.node_id === node.id),
  }));
}

type QueueTicket = {
  id: number;
  title: string;
  kind: string;
  source: string;
  priority: number;
  requires: string;
  executor: string | null;
  updated_at: number;
  slug: string | null;
  client_email: string;
  budget_cents: number | null;
  human_seconds: number;
  ai_micro_usd: number;
};

/**
 * Every approved item, in claim order, with the nodes that could take it and —
 * when none can right now — the reason in words.
 */
export async function queueView(env: Env) {
  await reapExpired(env);
  const t = now();
  const [nodes, { results }] = await Promise.all([
    nodesView(env),
    env.DB.prepare(
      `SELECT t.id, t.title, t.kind, t.source, t.priority, t.requires, t.executor, t.updated_at, p.slug, u.email AS client_email,
              t.budget_cents, t.human_seconds, t.ai_micro_usd
         FROM tickets t LEFT JOIN projects p ON p.id = t.project_id JOIN users u ON u.id = t.user_id
        WHERE t.status = 'approved' ORDER BY t.priority DESC, t.updated_at`,
    ).all<QueueTicket>(),
  ]);

  return (results ?? []).map((item) => {
    const requires = parseList(item.requires);
    const { eligible, reason } = explainEligibility(item, requires, nodes, t);
    return {
      id: item.id,
      title: item.title,
      kind: item.kind,
      source: item.source,
      priority: item.priority,
      requires,
      executor: item.executor,
      slug: item.slug,
      clientEmail: item.client_email,
      budgetCents: item.budget_cents,
      waitingSeconds: t - item.updated_at,
      eligible,
      reason,
    };
  });
}

type NodeView = Awaited<ReturnType<typeof nodesView>>[number];

/** Which nodes could take an item now, and if none, the most useful reason why. */
function explainEligibility(item: QueueTicket, requires: string[], nodes: NodeView[], t: number) {
  if (!item.slug) return { eligible: [], reason: 'No project set — it cannot be claimed until it has one.' };
  const left = budgetLeft(item);
  if (left !== null && left <= 0) {
    return {
      eligible: [],
      reason: `Budget spent (${money(item.budget_cents! - left)} of ${money(item.budget_cents!)}). Ask the client to raise it, or raise it yourself.`,
    };
  }
  if (nodes.length === 0) return { eligible: [], reason: 'No node has ever connected. Start one: fleet/install.sh.' };

  const holders = nodes.filter((n) => n.slugs.includes(item.slug as string));
  if (holders.length === 0) return { eligible: [], reason: `No node holds a folder for ${item.slug}.` };

  const capable = holders.filter((n) => requires.every((r) => n.capabilities.includes(r)));
  if (capable.length === 0) return { eligible: [], reason: `No node with ${item.slug} has ${requires.join(', ')}.` };

  const needs = item.kind === 'client' ? CLIENT_EXECUTOR : item.executor;
  const runnable = needs ? capable.filter((n) => n.executors.includes(needs)) : capable;
  if (runnable.length === 0) return { eligible: [], reason: `No capable node runs ${needs}.` };

  const live = runnable.filter((n) => n.online && !n.draining);
  if (live.length === 0) {
    const last = runnable.reduce((a, b) => (a.lastSeenAt > b.lastSeenAt ? a : b));
    const state = last.online ? 'draining' : `offline, last seen ${since(t - last.lastSeenAt)} ago`;
    return { eligible: [], reason: `Waiting for ${runnable.map((n) => n.id).join(' or ')} (${state}).` };
  }
  const free = live.filter((n) => n.running.length < n.slots);
  const names = live.map((n) => n.id);
  if (free.length === 0) return { eligible: names, reason: `Waiting for a free slot on ${names.join(' or ')}.` };
  return { eligible: names, reason: `Next claim by ${free.map((n) => n.id).join(' or ')}.` };
}

function since(seconds: number): string {
  if (seconds < 120) return `${seconds}s`;
  if (seconds < 7200) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/**
 * Items that have waited past the `stallMinutes` setting with no node able to take them and
 * have not been reported yet. Marks them reported.
 */
export async function takeNewStalls(env: Env) {
  const { stallMinutes } = await getSettings(env);
  if (stallMinutes === 0) return [];
  const queue = await queueView(env);
  const stalled = queue.filter((item) => item.eligible.length === 0 && item.waitingSeconds >= stallMinutes * 60);
  if (!stalled.length) return [];
  const ids = stalled.map((item) => item.id);
  const { results } = await env.DB.prepare(
    `UPDATE tickets SET stalled_alerted_at = ?
      WHERE stalled_alerted_at IS NULL AND id IN (${ids.map(() => '?').join(',')}) RETURNING id`,
  )
    .bind(now(), ...ids)
    .all<{ id: number }>();
  const fresh = new Set((results ?? []).map((r) => r.id));
  return stalled.filter((item) => fresh.has(item.id));
}

/**
 * Nodes that asked to be watched (`alertOfflineMinutes`) and have been offline
 * longer than that, not yet reported for this outage. Marks them reported; the
 * next heartbeat clears the mark.
 */
export async function takeNewOutages(env: Env) {
  const t = now();
  const { results } = await env.DB.prepare(
    'SELECT id, last_seen_at, overrides, health FROM nodes WHERE offline_alerted_at IS NULL',
  ).all<{ id: string; last_seen_at: number; overrides: string; health: string }>();
  const due = (results ?? []).filter((node) => {
    const minutes = Number((parseObject(node.overrides) as NodeOverrides).alertOfflineMinutes ?? 0);
    return minutes > 0 && t - node.last_seen_at >= minutes * 60;
  });
  if (!due.length) return [];
  await env.DB.batch(due.map((node) => env.DB.prepare('UPDATE nodes SET offline_alerted_at = ? WHERE id = ?').bind(t, node.id)));
  return due.map((node) => ({ id: node.id, offlineSeconds: t - node.last_seen_at, lastHealth: parseObject(node.health) }));
}
