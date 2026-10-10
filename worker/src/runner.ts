/*
 * Local runner API — the machine-to-machine side of the portal.
 *
 *   POST /runner/claim               { slugs }  → the oldest APPROVED ticket for
 *                                    one of those project slugs, moved to
 *                                    in_progress atomically; or { ticket: null }.
 *   POST /runner/tickets/:id/result  { ok, summary, branch?, diffStat?, diff? }
 *                                    → private runner note, status → review,
 *                                    Ali gets an email. Client sees only the status.
 *
 * Auth is a single shared secret (RUNNER_TOKEN, a Worker secret) held by the
 * runner on Ali's machine. The runner can never approve: claim only matches
 * status = 'approved', which only the admin role can set (portal.ts).
 */
import { Hono } from 'hono';
import { encoder, type Env, type HonoEnv } from './shared.ts';
import { mailAli, now, siteUrl } from './portal.ts';

const MAX_SLUGS = 50;
const MAX_SUMMARY = 8000;
const MAX_DIFFSTAT = 4000;
const MAX_DIFF = 40000;

export const runner = new Hono<HonoEnv>();

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

runner.use('/runner/*', async (c, next) => {
  const expected = c.env.RUNNER_TOKEN;
  if (!expected) return c.json({ error: 'runner_disabled' }, 503);
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !(await sameSecret(token, expected))) return c.json({ error: 'unauthorized' }, 401);
  return next();
});

/**
 * The portal's project slugs. The runner calls this so it can say which portal
 * projects it has no local folder for — the one piece of project setup that
 * cannot live in the Worker, because repo paths are deliberately never stored
 * there.
 */
runner.get('/runner/projects', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, slug, name FROM projects ORDER BY slug`,
  ).all<{ id: string; slug: string; name: string }>();
  return c.json({ projects: results ?? [] });
});

runner.post('/runner/claim', async (c) => {
  const env = c.env;
  const body = (await c.req.json().catch(() => null)) as { slugs?: unknown } | null;
  const slugs = Array.isArray(body?.slugs)
    ? body.slugs.filter((s): s is string => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(s)).slice(0, MAX_SLUGS)
    : [];
  if (!slugs.length) return c.json({ error: 'no_slugs' }, 400);

  const t = now();
  // One statement: pick and flip in the same write, so two runners (or a
  // double poll) can never both get the same ticket.
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
  if (!claimed) return c.json({ ticket: null });

  await env.DB.prepare(
    `INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'system', ?, ?)`,
  )
    .bind(claimed.id, 'Status changed to “In progress”.', t)
    .run();

  const ticket = await env.DB.prepare(
    `SELECT t.id, t.title, p.slug FROM tickets t JOIN projects p ON p.id = t.project_id WHERE t.id = ?`,
  )
    .bind(claimed.id)
    .first<{ id: number; title: string; slug: string }>();
  // Client messages are the request; Ali's notes (public or private) are his
  // guidance. Status lines and earlier runner output are noise for the agent.
  const { results: messages } = await env.DB.prepare(
    `SELECT author, body, internal FROM ticket_messages
      WHERE ticket_id = ? AND author IN ('client', 'ali') ORDER BY id`,
  )
    .bind(claimed.id)
    .all<{ author: 'client' | 'ali'; body: string; internal: number }>();

  return c.json({ ticket, messages });
});

runner.post('/runner/tickets/:id/result', async (c) => {
  const env = c.env;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => null)) as {
    ok?: unknown;
    summary?: unknown;
    branch?: unknown;
    diffStat?: unknown;
    diff?: unknown;
  } | null;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const ok = body?.ok === true;
  const summary = str(body?.summary, MAX_SUMMARY).trim() || (ok ? 'Done, no summary.' : 'Failed, no details.');
  const branch = str(body?.branch, 200);
  const diffStat = str(body?.diffStat, MAX_DIFFSTAT).trim();
  const diff = str(body?.diff, MAX_DIFF);

  const ticket = await env.DB.prepare(`SELECT id, title, status FROM tickets WHERE id = ?`)
    .bind(id)
    .first<{ id: number; title: string; status: string }>();
  if (!ticket) return c.json({ error: 'not_found' }, 404);
  // Only the run that claimed it may report; a ticket Ali already moved on wins.
  if (ticket.status !== 'in_progress') return c.json({ error: 'not_in_progress' }, 409);

  const note = [
    ok ? `Runner finished${branch ? ` on branch ${branch}` : ''}.` : 'Runner failed.',
    '',
    summary,
    diffStat && `\nChanged files:\n${diffStat}`,
    diff && `\nDiff${diff.length >= MAX_DIFF ? ' (truncated)' : ''}:\n${diff}`,
  ]
    .filter((part) => part !== '')
    .join('\n');

  const t = now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'runner', ?, 1, ?)`)
      .bind(id, note, t),
    env.DB.prepare(`UPDATE tickets SET status = 'review', updated_at = ? WHERE id = ?`).bind(t, id),
    env.DB.prepare(`INSERT INTO ticket_messages (ticket_id, author, body, created_at) VALUES (?, 'system', ?, ?)`)
      .bind(id, 'Status changed to “In review”.', t),
  ]);

  c.executionCtx.waitUntil(
    mailAli(env, {
      subject: `[#${id}] Runner ${ok ? 'finished' : 'failed'}: ${ticket.title}`,
      text:
        `${summary}\n\n${diffStat ? `${diffStat}\n\n` : ''}` +
        `${branch ? `Branch: ${branch} (local only, nothing pushed)\n` : ''}` +
        `Review: ${siteUrl(env)}/portal/admin#ticket=${id}`,
    }),
  );
  return c.json({ ok: true });
});
