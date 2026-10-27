/*
 * Fleet node API — the machine-to-machine side of the work queue.
 *
 *   GET  /node/projects             the portal's project slugs, so a node can say
 *                                   which ones it has no folder for — plus the
 *                                   repo to clone and the ref to start from,
 *                                   when the portal knows them.
 *   POST /node/projects/:slug/repo  { repo } → fill a project's blank repo from a
 *                                   node's local folder, so other nodes can clone.
 *   POST /node/heartbeat            { node, running: [runId] } → upsert the node,
 *                                   renew its leases; answers { draining, cancel }.
 *   POST /node/claim                { nodeId } → lease the best eligible approved
 *                                   item (queue.ts), or { ticket: null, reason }.
 *   POST /node/runs/:runId/result   { ok, summary, branch?, diffStat?, diff?,
 *                                   costUsd?, executor?, model?, files? } → private
 *                                   run note, status → review, Ali gets an email.
 *                                   `files` (full contents of changed files) go
 *                                   to the project's preview branch when it has
 *                                   a hosted site — never to production.
 *                                   `commit`, `sharedTo` ('origin' | 'bundle') and
 *                                   `sharedRef` say where the next run, on any
 *                                   node, picks the work up.
 *   PUT  /node/runs/:runId/bundle   raw git bundle of the run's commits, for a repo
 *                                   the node cannot push to. Stored in R2.
 *   GET  /node/runs/:runId/bundle   that bundle, for a node holding a run on the
 *                                   same ticket.
 *   PUT  /node/runs/:runId/session  the run's Harness session log (jsonl, zstd),
 *                                   stored in R2; the result's `sessionLog: true`
 *                                   is only kept when it is there. `sessionId` and
 *                                   `sessionDir` name the session.
 *
 * Auth is a single shared secret (RUNNER_TOKEN, a Worker secret) held by each
 * node. A node can never approve: claim only matches status = 'approved', which
 * only the admin role can set (portal.ts).
 */
import { Hono } from 'hono';
import { encoder, type HonoEnv } from './shared.ts';
import { mailAli, siteUrl } from './portal.ts';
import { finishRun, normalizeReport, sessionKey, sharedLine } from './runs.ts';
import { claimForNode, cleanNodeReport, getSettings, heartbeat } from './queue.ts';
import { cleanPreviewFiles, pushToPreview } from './sites.ts';
import { cleanRepo } from './setup.ts';
import { fileResponse } from './files.ts';
import { now } from './shared.ts';
import { appendSteps, cleanSteps } from './steps.ts';

export const node = new Hono<HonoEnv>();

/** Constant-time string compare via HMAC digests of both sides. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [x, y] = await Promise.all([
    crypto.subtle.sign('HMAC', key, encoder.encode(a)),
    crypto.subtle.sign('HMAC', key, encoder.encode(b)),
  ]);
  const ua = new Uint8Array(x);
  const ub = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ua.length; i += 1) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

node.use('/node/*', async (c, next) => {
  const expected = c.env.RUNNER_TOKEN;
  if (!expected) return c.json({ error: 'nodes_disabled' }, 503);
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !(await sameSecret(token, expected))) return c.json({ error: 'unauthorized' }, 401);
  return next();
});

/**
 * The portal's project slugs. Repo paths are deliberately never stored in the
 * Worker, so this is how a node learns which projects it should look for.
 */
node.get('/node/projects', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.repo, s.state AS site_state
       FROM projects p LEFT JOIN project_sites s ON s.project_id = p.id ORDER BY p.slug`,
  ).all<{ id: string; slug: string; name: string; repo: string | null; site_state: string | null }>();
  return c.json({
    projects: (results ?? []).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      // A node may clone this when it has no folder for the slug. The URL is
      // https or ssh only (setup.ts cleanRepo); the node's own git credentials
      // decide whether it can.
      ...(p.repo ? { repo: p.repo } : {}),
      // A hosted site's work starts from its preview branch, so a run never
      // overwrites changes that are on the preview but not yet published.
      ...(p.site_state === 'ready' ? { baseRef: 'origin/preview', preview: true } : {}),
    })),
  });
});

/**
 * A node that holds a folder for a project tells the portal where that folder's
 * origin lives, so every other node can clone it. Fills a blank repo only: a
 * repo the client or Ali named is never overwritten.
 */
node.post('/node/projects/:slug/repo', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { repo?: unknown } | null;
  const repo = cleanRepo(body?.repo);
  if (!repo || /^https:\/\/[^/]*@/i.test(repo)) return c.json({ error: 'bad_repo' }, 400);
  const row = await c.env.DB.prepare(
    `UPDATE projects SET repo = ? WHERE slug = ? AND (repo IS NULL OR repo = '') RETURNING id`,
  )
    .bind(repo, c.req.param('slug'))
    .first<{ id: string }>();
  return c.json({ ok: true, updated: Boolean(row) });
});

node.post('/node/heartbeat', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { node?: unknown; running?: unknown } | null;
  const report = cleanNodeReport(body?.node);
  if (!report) return c.json({ error: 'bad_node' }, 400);
  const running = Array.isArray(body?.running) ? body.running.filter((id): id is number => typeof id === 'number') : [];
  return c.json(await heartbeat(c.env, report, running));
});

node.post('/node/claim', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { nodeId?: unknown } | null;
  const nodeId = typeof body?.nodeId === 'string' ? body.nodeId.trim().toLowerCase() : '';
  if (!nodeId) return c.json({ error: 'bad_node' }, 400);
  const { claim, reason } = await claimForNode(c.env, nodeId);
  if (!claim) return c.json({ ticket: null, reason });
  // Tell the node to send changed files back, so they can reach the preview.
  const slug = (claim as { ticket?: { slug?: string | null } }).ticket?.slug;
  const site = slug
    ? await c.env.DB.prepare(
        `SELECT 1 FROM project_sites s JOIN projects p ON p.id = s.project_id WHERE p.slug = ? AND s.state = 'ready'`,
      )
        .bind(slug)
        .first()
    : null;
  return c.json({ ...claim, preview: Boolean(site) });
});

/**
 * The outcome of a land the admin asked for: record where it went, or why it
 * did not, and leave a private note so the ticket says what happened.
 */
node.post('/node/land/:ticketId/result', async (c) => {
  const id = Number(c.req.param('ticketId'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => null)) as
    | { ok?: unknown; ref?: unknown; sha?: unknown; error?: unknown }
    | null;
  const ok = body?.ok === true;
  const ref = typeof body?.ref === 'string' ? body.ref.slice(0, 100) : '';
  const sha = typeof body?.sha === 'string' && /^[0-9a-f]{40}$/.test(body.sha) ? body.sha : '';
  const reason = typeof body?.error === 'string' ? body.error.slice(0, 500) : 'unknown error';
  const note = ok ? `Landed on ${ref} (${sha.slice(0, 8)}).` : `Could not land: ${reason}`;
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE tickets SET land_requested_at = NULL, landed_ref = ?, landed_sha = ?, updated_at = ? WHERE id = ?`,
    ).bind(ok ? ref : null, ok ? sha : null, t, id),
    c.env.DB.prepare(
      `INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 1, ?)`,
    ).bind(id, note, t),
  ]);
  return c.json({ ok: true });
});

/**
 * A node that is shutting down hands its run back: the item returns to the
 * queue at once, and the run does not count as an attempt.
 */
node.post('/node/runs/:runId/release', async (c) => {
  const runId = Number(c.req.param('runId'));
  const body = (await c.req.json().catch(() => null)) as { nodeId?: unknown } | null;
  const nodeId = typeof body?.nodeId === 'string' ? body.nodeId.trim().toLowerCase() : '';
  if (!Number.isInteger(runId) || runId <= 0 || !nodeId) return c.json({ error: 'not_found' }, 404);
  const t = now();
  const run = await c.env.DB.prepare(
    `UPDATE ticket_runs SET status = 'failed', released = 1, finished_at = ?,
            summary = 'Handed back: ' || node_id || ' was restarting. Not counted as an attempt.'
      WHERE id = ? AND node_id = ? AND status = 'running' RETURNING ticket_id`,
  )
    .bind(t, runId, nodeId)
    .first<{ ticket_id: number }>();
  if (!run) return c.json({ error: 'not_running' }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE tickets SET status = 'approved', updated_at = ? WHERE id = ? AND status = 'in_progress'`).bind(t, run.ticket_id),
    c.env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 1, ?)`).bind(
      run.ticket_id,
      `Run ${runId} on ${nodeId} was interrupted by a node restart. Back in the queue; not counted as an attempt.`,
      t,
    ),
  ]);
  return c.json({ ok: true });
});

/**
 * An attachment on a ticket the node is working on. Only while one of its runs
 * holds the ticket: a node token is not a key to every client's files.
 */
node.get('/node/tickets/:ticketId/files/:fileId', async (c) => {
  const ticketId = Number(c.req.param('ticketId'));
  const nodeId = (c.req.query('nodeId') ?? '').trim().toLowerCase();
  if (!Number.isInteger(ticketId) || ticketId <= 0 || !nodeId) return c.json({ error: 'not_found' }, 404);
  const holds = await c.env.DB.prepare(`SELECT 1 FROM ticket_runs WHERE ticket_id = ? AND node_id = ? AND status = 'running'`)
    .bind(ticketId, nodeId)
    .first();
  if (!holds) return c.json({ error: 'not_holding' }, 403);
  return (await fileResponse(c.env, ticketId, c.req.param('fileId'), true)) ?? c.json({ error: 'not_found' }, 404);
});

/** A run's git bundle: the work, for a node that cannot push it anywhere. */
const BUNDLE_LIMIT = 50 * 1024 * 1024;
const bundleKey = (ticketId: number, runId: number) => `bundles/tickets/${ticketId}/run-${runId}.bundle`;

node.put('/node/runs/:runId/bundle', async (c) => {
  const runId = Number(c.req.param('runId'));
  const nodeId = (c.req.query('nodeId') ?? '').trim().toLowerCase();
  if (!Number.isInteger(runId) || runId <= 0 || !nodeId) return c.json({ error: 'not_found' }, 404);
  if (!c.env.FILES) return c.json({ error: 'files_unavailable' }, 503);
  const size = Number(c.req.header('content-length') ?? NaN);
  if (!Number.isFinite(size) || size <= 0) return c.json({ error: 'length_required' }, 411);
  if (size > BUNDLE_LIMIT) return c.json({ error: 'too_large' }, 413);
  const run = await c.env.DB.prepare(`SELECT ticket_id FROM ticket_runs WHERE id = ? AND node_id = ? AND status = 'running'`)
    .bind(runId, nodeId)
    .first<{ ticket_id: number }>();
  if (!run) return c.json({ error: 'not_running' }, 409);
  const body = await c.req.arrayBuffer();
  if (body.byteLength > BUNDLE_LIMIT) return c.json({ error: 'too_large' }, 413);
  await c.env.FILES.put(bundleKey(run.ticket_id, runId), body, { httpMetadata: { contentType: 'application/octet-stream' } });
  return c.json({ ok: true });
});

node.get('/node/runs/:runId/bundle', async (c) => {
  const runId = Number(c.req.param('runId'));
  const nodeId = (c.req.query('nodeId') ?? '').trim().toLowerCase();
  if (!Number.isInteger(runId) || runId <= 0 || !nodeId || !c.env.FILES) return c.json({ error: 'not_found' }, 404);
  const run = await c.env.DB.prepare(`SELECT ticket_id FROM ticket_runs WHERE id = ? AND shared_to = 'bundle'`)
    .bind(runId)
    .first<{ ticket_id: number }>();
  if (!run) return c.json({ error: 'not_found' }, 404);
  // Only for a node working on the same ticket.
  const holds = await c.env.DB.prepare(`SELECT 1 FROM ticket_runs WHERE ticket_id = ? AND node_id = ? AND status = 'running'`)
    .bind(run.ticket_id, nodeId)
    .first();
  if (!holds) return c.json({ error: 'not_holding' }, 403);
  const object = await c.env.FILES.get(bundleKey(run.ticket_id, runId));
  if (!object) return c.json({ error: 'not_found' }, 404);
  return new Response(object.body, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(object.size) } });
});

/**
 * A run's Harness session log (zstd-compressed JSONL), so the admin views can
 * open the run's whole conversation from any machine. Same rules as the bundle.
 */
const SESSION_LIMIT = 50 * 1024 * 1024;

node.put('/node/runs/:runId/session', async (c) => {
  const runId = Number(c.req.param('runId'));
  const nodeId = (c.req.query('nodeId') ?? '').trim().toLowerCase();
  if (!Number.isInteger(runId) || runId <= 0 || !nodeId) return c.json({ error: 'not_found' }, 404);
  if (!c.env.FILES) return c.json({ error: 'files_unavailable' }, 503);
  const size = Number(c.req.header('content-length') ?? NaN);
  if (!Number.isFinite(size) || size <= 0) return c.json({ error: 'length_required' }, 411);
  if (size > SESSION_LIMIT) return c.json({ error: 'too_large' }, 413);
  const run = await c.env.DB.prepare(`SELECT ticket_id FROM ticket_runs WHERE id = ? AND node_id = ? AND status = 'running'`)
    .bind(runId, nodeId)
    .first<{ ticket_id: number }>();
  if (!run) return c.json({ error: 'not_running' }, 409);
  const body = await c.req.arrayBuffer();
  if (body.byteLength > SESSION_LIMIT) return c.json({ error: 'too_large' }, 413);
  await c.env.FILES.put(sessionKey(run.ticket_id, runId), body, { httpMetadata: { contentType: 'application/zstd' } });
  return c.json({ ok: true });
});

/**
 * Live steps from the agent the node is running: `{ nodeId, steps: [{ at,
 * kind, text }] }`, accepted only while the node still holds the run.
 */
node.post('/node/runs/:runId/steps', async (c) => {
  const runId = Number(c.req.param('runId'));
  const body = (await c.req.json().catch(() => null)) as { nodeId?: unknown; steps?: unknown } | null;
  const nodeId = typeof body?.nodeId === 'string' ? body.nodeId.trim().toLowerCase() : '';
  if (!Number.isInteger(runId) || runId <= 0 || !nodeId) return c.json({ error: 'not_found' }, 404);
  const result = await appendSteps(c.env, runId, nodeId, cleanSteps(body?.steps));
  if (!result.ok) return c.json({ error: result.error }, 409);
  return c.json(result);
});

node.post('/node/runs/:runId/result', async (c) => {
  const runId = Number(c.req.param('runId'));
  if (!Number.isInteger(runId) || runId <= 0) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const nodeId = typeof body?.nodeId === 'string' ? body.nodeId.trim().toLowerCase() : '';
  const run = await c.env.DB.prepare('SELECT ticket_id FROM ticket_runs WHERE id = ?')
    .bind(runId)
    .first<{ ticket_id: number }>();
  if (!run || !nodeId) return c.json({ error: 'not_found' }, 404);

  const report = normalizeReport(body, 'claude');
  // A bundle the node says it left must really be there.
  if (report.sharedTo === 'bundle' && !(await c.env.FILES?.head(bundleKey(run.ticket_id, runId)))) report.sharedTo = null;
  // So must a session log.
  if (report.sessionLog && !(await c.env.FILES?.head(sessionKey(run.ticket_id, runId)))) report.sessionLog = false;
  const done = await finishRun(c.env, run.ticket_id, report, { runId, nodeId });
  if (!done.ok) return c.json({ error: done.error }, done.error === 'not_found' ? 404 : 409);

  const id = run.ticket_id;
  if (report.ok && !done.late && body?.files !== undefined) c.executionCtx.waitUntil(toPreview(c.env, id, body.files, done.title));
  if ((await getSettings(c.env)).notifyRunFinished) c.executionCtx.waitUntil(
    mailAli(c.env, {
      subject: `[#${id}] ${report.executor} on ${nodeId} ${done.late ? 'stopped' : report.ok ? 'finished' : 'failed'}: ${done.title}`,
      text:
        `${report.summary}\n\n${report.diffStat ? `${report.diffStat}\n\n` : ''}` +
        `${sharedLine(report, nodeId) ? `${sharedLine(report, nodeId)}\n` : ''}` +
        `Cost: $${report.costUsd.toFixed(4)} (${report.executor}${report.model ? ` · ${report.model}` : ''})\n` +
        `Review: ${siteUrl(c.env)}/portal/admin#ticket=${id}`,
    }),
  );
  return c.json({ ok: true, runCostUsd: report.costUsd });
});

/**
 * Apply a finished run's files to its project's preview branch, and say what
 * happened in the thread. The client sees the preview link; production waits
 * for a publish. A failure is a private note for Ali — the run itself stands.
 */
async function toPreview(env: HonoEnv['Bindings'], ticketId: number, files: unknown, title: string) {
  const ticket = await env.DB.prepare('SELECT project_id FROM tickets WHERE id = ?').bind(ticketId).first<{ project_id: string | null }>();
  if (!ticket?.project_id) return;
  const note = (body: string, internal: boolean) =>
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, ?, ?)`)
      .bind(ticketId, body, internal ? 1 : 0, now())
      .run();
  const cleaned = cleanPreviewFiles(files);
  if ('error' in cleaned) {
    await note(`Not sent to the preview: ${cleaned.error}. The work is on the node's local branch.`, true);
    return;
  }
  try {
    const out = await pushToPreview(env, ticket.project_id, cleaned.files, `#${ticketId}: ${title}`);
    await note(
      `The preview has this change${out.previewUrl ? `: ${out.previewUrl}` : ''}. Nothing is live until it is published.`,
      false,
    );
  } catch (error) {
    await note(`Sending ${cleaned.files.length} file(s) to the preview failed: ${(error as Error).message}`, true);
  }
}
