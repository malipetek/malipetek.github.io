/*
 * Moving work between projects and sites. A client may start a request in the
 * wrong place; these are the one place that decides whether the move is safe
 * and what it does to the thread, the approval and the site's primary flag.
 */
import { now, type Env } from './shared.ts';

type Result<T> = T | { error: string };

/** The oldest site of a project becomes primary when the current one leaves. */
export async function promotePrimary(env: Env, projectId: string): Promise<void> {
  const has = await env.DB.prepare('SELECT 1 FROM sites WHERE project_id = ? AND is_primary = 1 LIMIT 1')
    .bind(projectId)
    .first();
  if (has) return;
  await env.DB.prepare(
    `UPDATE sites SET is_primary = 1
      WHERE id = (SELECT id FROM sites WHERE project_id = ? ORDER BY created_at ASC, id ASC LIMIT 1)`,
  )
    .bind(projectId)
    .run();
}

/**
 * Move a client's request to another of their projects (and optionally one of
 * that project's sites). A running request is refused: a node holds a worktree
 * of the old project. Moving an approved request sends it back to Ali, because
 * the thing he approved changed.
 */
export async function moveTicket(
  env: Env,
  userId: string,
  ticketId: number,
  projectId: string,
  siteId?: string | null,
): Promise<Result<{ ok: true; status: string }>> {
  const ticket = await env.DB.prepare(
    'SELECT id, project_id, site_id, status, kind FROM tickets WHERE id = ? AND user_id = ?',
  )
    .bind(ticketId, userId)
    .first<{ id: number; project_id: string | null; site_id: string | null; status: string; kind: string }>();
  if (!ticket) return { error: 'not_found' };
  if (ticket.status === 'in_progress') return { error: 'in_progress' };

  const target = await env.DB.prepare(
    `SELECT p.id, p.name FROM projects p JOIN user_projects up ON up.project_id = p.id
      WHERE p.id = ? AND up.user_id = ?`,
  )
    .bind(projectId, userId)
    .first<{ id: string; name: string }>();
  if (!target) return { error: 'bad_project' };
  if (ticket.project_id === projectId && (ticket.site_id ?? null) === (siteId ?? null)) {
    return { ok: true, status: ticket.status };
  }

  let site = null;
  if (siteId) {
    site = await env.DB.prepare('SELECT id, project_id FROM sites WHERE id = ?')
      .bind(siteId)
      .first<{ id: string; project_id: string }>();
    if (!site || site.project_id !== projectId) return { error: 'bad_site' };
  }

  const from = ticket.project_id
    ? await env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(ticket.project_id).first<{ name: string }>()
    : null;
  const status = ticket.status === 'approved' ? 'new' : ticket.status;
  const t = now();
  const moved = from?.name && from.name !== target.name ? `${from.name} to ${target.name}` : `to ${target.name}`;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE tickets SET project_id = ?, site_id = ?, status = ?, land_requested_at = NULL,
         landed_ref = NULL, landed_sha = NULL, updated_at = ? WHERE id = ?`,
    ).bind(projectId, siteId ?? null, status, t, ticketId),
    env.DB.prepare(
      `INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 0, ?)`,
    ).bind(ticketId, `Moved ${moved}.`, t),
  ]);
  return { ok: true, status };
}

/**
 * Move a site to another of the client's projects. Its address, deploys and
 * host stay; only the project it belongs to changes. Both sides keep exactly
 * one primary site.
 */
export async function moveSite(
  env: Env,
  userId: string,
  siteId: string,
  projectId: string,
): Promise<Result<{ ok: true }>> {
  const site = await env.DB.prepare(
    `SELECT s.id, s.project_id, s.is_primary FROM sites s
       JOIN projects p ON p.id = s.project_id
       JOIN user_projects up ON up.project_id = p.id
      WHERE s.id = ? AND up.user_id = ?`,
  )
    .bind(siteId, userId)
    .first<{ id: string; project_id: string; is_primary: number }>();
  if (!site) return { error: 'not_found' };
  if (site.project_id === projectId) return { ok: true };
  const target = await env.DB.prepare(
    `SELECT p.id FROM projects p JOIN user_projects up ON up.project_id = p.id
      WHERE p.id = ? AND up.user_id = ?`,
  )
    .bind(projectId, userId)
    .first<{ id: string }>();
  if (!target) return { error: 'bad_project' };

  const oldProject = site.project_id;
  await env.DB.prepare('UPDATE sites SET project_id = ?, is_primary = 0, updated_at = ? WHERE id = ?')
    .bind(projectId, now(), site.id)
    .run();
  if (site.is_primary === 1) await promotePrimary(env, oldProject);
  await promotePrimary(env, projectId);
  return { ok: true };
}
