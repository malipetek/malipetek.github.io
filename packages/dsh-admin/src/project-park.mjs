/**
 * Pure isometric "Project park" model: computes per-project operator counts,
 * urgency state/order, isometric floor coordinates, and accessible descriptions.
 *
 * Reads only fields exposed by /admin/projects, /admin/tickets, and /admin/runs.
 */

export const STALL_SECONDS = 45 * 60;

/** Default 2:1 isometric tile geometry (px). */
export const ISO_TILE = Object.freeze({ width: 120, height: 60 });

const CLOSED_STATUSES = new Set(['done', 'declined']);
const TERMINAL_RUN_STATUSES = new Set(['done', 'failed', 'cancelled', 'canceled', 'completed']);
const STATE_RANK = Object.freeze({ calm: 0, active: 1, attention: 2, bad: 3 });

/**
 * Project 3D isometric coordinates (x, y, z) to 2D SVG coordinates.
 * Moving +x goes down-right, +y goes down-left, and +z goes straight up.
 */
export function iso(x, y, z = 0, options = {}) {
  const tileW = Number.isFinite(options?.tileW) ? options.tileW : ISO_TILE.width;
  const tileH = Number.isFinite(options?.tileH) ? options.tileH : ISO_TILE.height;
  const originX = Number.isFinite(options?.originX) ? options.originX : 0;
  const originY = Number.isFinite(options?.originY) ? options.originY : 0;
  const nx = Number.isFinite(x) ? x : 0;
  const ny = Number.isFinite(y) ? y : 0;
  const nz = Number.isFinite(z) ? z : 0;
  return {
    x: originX + (nx - ny) * (tileW / 2),
    y: originY + (nx + ny) * (tileH / 2) - nz,
  };
}

function toUnixSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e11 ? n / 1000 : n;
}

function isClosedTicket(ticket) {
  return CLOSED_STATUSES.has(ticket?.status);
}

/** Matches NeedsYouPage's `isWaiting` classifier. */
function isWaitingTicket(ticket) {
  return (
    Boolean(ticket) &&
    Number(ticket.client_waiting_since ?? 0) > 0 &&
    !isClosedTicket(ticket) &&
    ticket.status !== 'new'
  );
}

/** Matches NeedsYouPage's approvals + reviews + clients-waiting buckets. */
function isNeedsYouTicket(ticket) {
  if (!ticket || typeof ticket !== 'object') return false;
  return ticket.status === 'new' || ticket.status === 'review' || isWaitingTicket(ticket);
}

/** Matches NeedsYouPage's Stalled group (in_progress for 45+ minutes without report). */
function isStalledTicket(ticket, nowSeconds) {
  if (!ticket || ticket.status !== 'in_progress') return false;
  const updated = toUnixSeconds(ticket.updated_at);
  return updated > 0 && nowSeconds - updated > STALL_SECONDS;
}

function activeRunTicketKeys(runs) {
  const list = Array.isArray(runs)
    ? runs
    : Array.isArray(runs?.running)
      ? runs.running
      : [];
  const keys = new Set();
  for (const run of list) {
    if (!run || typeof run !== 'object') continue;
    if (typeof run.status === 'string' && TERMINAL_RUN_STATUSES.has(run.status)) continue;
    if (toUnixSeconds(run.finished_at) > 0) continue;
    if (run.ticket_id === null || run.ticket_id === undefined || run.ticket_id === '') continue;
    keys.add(String(run.ticket_id));
  }
  return keys;
}

function countFailingSites(project) {
  const sites = Array.isArray(project?.sites)
    ? project.sites
    : project?.site && typeof project.site === 'object'
      ? [project.site]
      : [];
  let failing = 0;
  for (const site of sites) {
    if (!site || typeof site !== 'object') continue;
    const failedState = site.state === 'failed';
    const rebuildFailed = typeof site.rebuildError === 'string' && site.rebuildError.trim().length > 0;
    if (failedState || rebuildFailed) failing += 1;
  }
  return failing;
}

function clientLabelFor(project, projectTickets) {
  const names = [];
  const seen = new Set();
  const push = (raw) => {
    if (typeof raw !== 'string') return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(trimmed);
  };
  if (Array.isArray(project?.clients)) {
    for (const person of project.clients) {
      if (!person || typeof person !== 'object') continue;
      push(person.name || person.email);
    }
  }
  if (names.length === 0) {
    for (const ticket of projectTickets) {
      if (ticket?.kind === 'system') continue;
      push(ticket?.client_name || ticket?.client_email);
    }
  }
  if (names.length === 0) return '';
  if (names.length <= 2) return names.join(', ');
  return `${names[0]} +${names.length - 1}`;
}

function stateFromCounts(counts) {
  if (counts.failing > 0 || counts.stalled > 0) return 'bad';
  if (counts.needsYou > 0) return 'attention';
  if (counts.running > 0) return 'active';
  return 'calm';
}

function compareUrgency(a, b) {
  return (
    STATE_RANK[b.state] - STATE_RANK[a.state] ||
    b.counts.failing - a.counts.failing ||
    b.counts.stalled - a.counts.stalled ||
    b.counts.needsYou - a.counts.needsYou ||
    b.counts.running - a.counts.running ||
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
    String(a.id).localeCompare(String(b.id))
  );
}

/**
 * Build sorted isometric park plots for every client project.
 *
 * Most urgent plot is placed front-left (index 0). Plots fill a compact 2-row
 * isometric ribbon along a single floor so vertical height stays constant while
 * the park extends horizontally when there are many projects.
 */
export function parkPlots({ projects = [], tickets = [], runs = [], now = Date.now() } = {}) {
  const projectList = Array.isArray(projects) ? projects : [];
  if (projectList.length === 0) return [];

  const ticketList = Array.isArray(tickets) ? tickets : [];
  const nowSeconds = toUnixSeconds(now) || Date.now() / 1000;
  const activeRunTickets = activeRunTicketKeys(runs);

  const ticketsByProject = new Map();
  for (const ticket of ticketList) {
    if (!ticket || typeof ticket !== 'object') continue;
    if (ticket.project_id === null || ticket.project_id === undefined || ticket.project_id === '') continue;
    const key = String(ticket.project_id);
    let bucket = ticketsByProject.get(key);
    if (!bucket) {
      bucket = [];
      ticketsByProject.set(key, bucket);
    }
    bucket.push(ticket);
  }

  const seenIds = new Set();
  const rawPlots = [];
  for (const project of projectList) {
    if (!project || typeof project !== 'object') continue;
    const validId =
      (typeof project.id === 'string' && project.id.trim().length > 0) ||
      (typeof project.id === 'number' && Number.isFinite(project.id));
    if (!validId) continue;

    const idKey = String(project.id);
    if (seenIds.has(idKey)) continue;
    seenIds.add(idKey);

    const name =
      (typeof project.name === 'string' && project.name.trim()) ||
      (typeof project.slug === 'string' && project.slug.trim()) ||
      idKey;

    const ownTickets = ticketsByProject.get(idKey) ?? [];
    const needsYouIds = new Set();
    const stalledIds = new Set();
    const runningIds = new Set();

    for (let idx = 0; idx < ownTickets.length; idx += 1) {
      const ticket = ownTickets[idx];
      const ticketKey = ticket.id != null && ticket.id !== '' ? String(ticket.id) : `idx:${idx}`;
      if (isNeedsYouTicket(ticket)) needsYouIds.add(ticketKey);
      if (isStalledTicket(ticket, nowSeconds)) stalledIds.add(ticketKey);
      if (ticket.status === 'in_progress' && activeRunTickets.has(ticketKey)) runningIds.add(ticketKey);
    }

    const counts = {
      needsYou: needsYouIds.size,
      running: runningIds.size,
      stalled: stalledIds.size,
      failing: countFailingSites(project),
    };

    rawPlots.push({
      id: project.id,
      name,
      client: clientLabelFor(project, ownTickets),
      state: stateFromCounts(counts),
      counts,
    });
  }

  rawPlots.sort(compareUrgency);

  const rows = rawPlots.length > 1 ? 2 : 1;
  const cols = Math.ceil(rawPlots.length / rows);

  return rawPlots.map((plot, index) => {
    const band = Math.floor(index / rows);
    const depth = index % rows; // 0 = front row, 1 = back row
    const x = band;
    const y = (cols - 1) - band + (rows - 1 - depth);
    return {
      id: plot.id,
      name: plot.name,
      client: plot.client,
      state: plot.state,
      counts: plot.counts,
      x,
      y,
    };
  });
}

/** Human-readable count summary in words for tooltips and screen readers. */
export function countsSummary(counts) {
  if (!counts) return 'Calm, nothing waiting';
  const parts = [];
  if (counts.failing > 0) parts.push(`${counts.failing} failing ${counts.failing === 1 ? 'site' : 'sites'}`);
  if (counts.stalled > 0) parts.push(`${counts.stalled} stalled`);
  if (counts.needsYou > 0) parts.push(`${counts.needsYou} ${counts.needsYou === 1 ? 'needs' : 'need'} you`);
  if (counts.running > 0) parts.push(`${counts.running} running`);
  return parts.length > 0 ? parts.join(', ') : 'Calm, nothing waiting';
}

/** Accessible label for one plot button and the mirrored visually hidden list. */
export function plotAriaLabel(plot) {
  const who = plot.client ? `${plot.name} (${plot.client})` : plot.name;
  return `${who} — ${plot.state}: ${countsSummary(plot.counts)}`;
}
