/*
 * Local runner API — the machine-to-machine side of the portal.
 *
 *   POST /runner/claim               { slugs }  → the oldest APPROVED ticket for
 *                                    one of those project slugs, moved to
 *                                    in_progress atomically; or { ticket: null }.
 *   POST /runner/tickets/:id/result  { ok, summary, branch?, diffStat?, diff?,
 *                                    costUsd?, executor?, model? }
 *                                    → private run note, status → review,
 *                                    Ali gets an email. Client sees only the status.
 *
 * Auth is a single shared secret (RUNNER_TOKEN, a Worker secret) held by the
 * runner on Ali's machine. The runner can never approve: claim only matches
 * status = 'approved', which only the admin role can set (portal.ts).
 *
 * The transitions themselves live in runs.ts, shared with the Harness admin
 * path, so a run is recorded — and attributable — the same way whoever started
 * it. This module only adds the runner's own auth and notification.
 */
import { Hono } from 'hono';
import { encoder, type HonoEnv } from './shared.ts';
import { mailAli, siteUrl } from './portal.ts';
import { claimNextForSlugs, finishRun, normalizeReport } from './runs.ts';

const MAX_SLUGS = 50;

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
  const body = (await c.req.json().catch(() => null)) as { slugs?: unknown } | null;
  const slugs = Array.isArray(body?.slugs)
    ? body.slugs.filter((s): s is string => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(s)).slice(0, MAX_SLUGS)
    : [];
  if (!slugs.length) return c.json({ error: 'no_slugs' }, 400);

  const claimed = await claimNextForSlugs(c.env, slugs, { executor: 'runner' });
  if (!claimed) return c.json({ ticket: null });
  return c.json({ ticket: claimed.ticket, messages: claimed.messages, runId: claimed.runId });
});

runner.post('/runner/tickets/:id/result', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.json().catch(() => null);
  const report = normalizeReport(body, 'runner');
  const done = await finishRun(c.env, id, report);
  if (!done.ok) return c.json({ error: done.error }, done.error === 'not_found' ? 404 : 409);

  c.executionCtx.waitUntil(
    mailAli(c.env, {
      subject: `[#${id}] Runner ${report.ok ? 'finished' : 'failed'}: ${done.title}`,
      text:
        `${report.summary}\n\n${report.diffStat ? `${report.diffStat}\n\n` : ''}` +
        `${report.branch ? `Branch: ${report.branch} (local only, nothing pushed)\n` : ''}` +
        `Cost: $${report.costUsd.toFixed(4)} (${report.executor}${report.model ? ` · ${report.model}` : ''})\n` +
        `Review: ${siteUrl(c.env)}/portal/admin#ticket=${id}`,
    }),
  );
  return c.json({ ok: true, runCostUsd: report.costUsd });
});
