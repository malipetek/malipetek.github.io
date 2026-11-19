import { basename, dirname, isAbsolute, normalize } from 'node:path';

const validId = id => Number.isSafeInteger(id) && id > 0;
// Worker project ids are D1 text UUIDs; older fixtures used integers.
const validProjectId = id => validId(id) || (typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u.test(id));
const named = /^(?:(?:Task|Ticket)\s+)?#(\d+)(?: · run \d+)?\s*(?:—|$)/u;
const legacyFolder = /^.+-(?:task|ticket)-(\d+)(?:-run\d+)?$/u;

/** Identify a historical Fleet slot without ever inspecting or trusting its contents. */
export function fleetWorkspaceCandidate(header, title, roots) {
  if (typeof header?.cwd !== 'string' || !isAbsolute(header.cwd)) return undefined;
  const cwd = header.cwd.replace(/\/+$/u, '');
  if (normalize(cwd) !== cwd || !roots.some(root => root && normalize(root).replace(/\/+$/u, '') === dirname(cwd))) return undefined;
  const folder = basename(cwd);
  const id = Number((legacyFolder.exec(folder) ?? named.exec(typeof title === 'string' ? title.trim() : ''))?.[1]);
  return { ticketId: validId(id) ? id : null, folder, sessionDir: `-${cwd.replaceAll('/', '-')}--` };
}

/** Title/folder only select a candidate request. The scoped Worker rows prove the binding. */
export function verifiedTicketWorkspace(header, candidate, detail, rootForSlug) {
  const ticket = detail?.ticket;
  const slug = ticket?.project_slug;
  if (!validId(candidate?.ticketId) || ticket?.id !== candidate.ticketId || !validProjectId(ticket.project_id) ||
      typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/u.test(slug) ||
      (candidate.folder !== slug && !candidate.folder.startsWith(`${slug}-`)) ||
      !Array.isArray(detail.runs) || typeof header?.id !== 'string') return null;
  const matches = detail.runs.filter(run => run?.session_id === header.id);
  if (matches.length === 0 || matches.some(run => run.session_dir !== candidate.sessionDir)) return null;
  return { ticketId: ticket.id, projectId: ticket.project_id, projectRoot: rootForSlug(slug), runs: detail.runs };
}
