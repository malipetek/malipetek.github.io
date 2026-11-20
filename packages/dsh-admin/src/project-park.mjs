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

/* ————— triage: filter the park, and list what each plot is waiting on ————— */

/** The park's filter pills, in the order they appear. */
export const PARK_FILTERS = Object.freeze([
  { key: 'all', label: 'All' },
  { key: 'needsYou', label: 'Needs you' },
  { key: 'failing', label: 'Failing' },
  { key: 'stalled', label: 'Stalled' },
  { key: 'running', label: 'Running' },
]);

/** Does a plot belong under a filter? 'all' (or an unknown key) keeps every plot. */
export function plotMatches(plot, filter) {
  if (!filter || filter === 'all') return true;
  return Number(plot?.counts?.[filter] ?? 0) > 0;
}

/** Live count per filter: how many plots each pill would keep. */
export function filterCounts(plots = []) {
  const out = { all: 0, needsYou: 0, failing: 0, stalled: 0, running: 0 };
  for (const plot of plots) {
    out.all += 1;
    for (const key of ['needsYou', 'failing', 'stalled', 'running']) {
      if (plotMatches(plot, key)) out[key] += 1;
    }
  }
  return out;
}

/** "45s", "12m", "3h", "4d": a compact age for one-line labels. */
export function shortAge(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const KIND_RANK = Object.freeze({ stalled: 0, needsYou: 1, running: 2, open: 3 });

function runStartsByTicket(runs) {
  const list = Array.isArray(runs) ? runs : Array.isArray(runs?.running) ? runs.running : [];
  const starts = new Map();
  for (const run of list) {
    if (!run || run.ticket_id === null || run.ticket_id === undefined) continue;
    if (run.finished_at || TERMINAL_RUN_STATUSES.has(String(run.status ?? '').toLowerCase())) continue;
    const started = toUnixSeconds(run.started_at ?? run.created_at);
    const key = String(run.ticket_id);
    if (started && (!starts.has(key) || started < starts.get(key))) starts.set(key, started);
  }
  return starts;
}

/**
 * The open tickets of one plot's project, most urgent first: stalled, then
 * waiting on the operator, then running, then merely open. Each carries why it
 * is listed, how long it has been in that state and, when the client's
 * assistant filed it, which assistant (the field may be absent on older data).
 */
export function plotTickets(plot, tickets = [], runs = [], now = Date.now(), recent = []) {
  if (!plot) return [];
  const nowSeconds = toUnixSeconds(now) || Date.now() / 1000;
  const running = activeRunTicketKeys(runs);
  const starts = runStartsByTicket(runs);
  const rows = [];
  for (const ticket of Array.isArray(tickets) ? tickets : []) {
    if (!ticket || isClosedTicket(ticket)) continue;
    if (String(ticket.project_id ?? '') !== String(plot.id)) continue;
    const key = String(ticket.id);
    const kind = isStalledTicket(ticket, nowSeconds)
      ? 'stalled'
      : isNeedsYouTicket(ticket)
        ? 'needsYou'
        : ticket.status === 'in_progress' && running.has(key)
          ? 'running'
          : 'open';
    const since = kind === 'running' ? starts.get(key) : toUnixSeconds(ticket.updated_at ?? ticket.created_at);
    const app = typeof ticket.assistant_app === 'string' && ticket.assistant_app.trim() ? ticket.assistant_app.trim() : null;
    rows.push({
      id: ticket.id,
      title: typeof ticket.title === 'string' && ticket.title.trim() ? ticket.title.trim() : `#${ticket.id}`,
      status: ticket.status ?? 'open',
      kind,
      age: since ? shortAge(nowSeconds - since) : null,
      ageSeconds: since ? Math.max(0, nowSeconds - since) : 0,
      via: app,
      wait: ticketWait(ticket, recent, now),
    });
  }
  rows.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.ageSeconds - a.ageSeconds);
  return rows;
}

/** One line for a plot's tooltip: its most urgent ticket, e.g. "#910036 Update Christmas… · via Claude · 3d". */
export function plotHeadline(plot, tickets = [], runs = [], now = Date.now()) {
  const top = plotTickets(plot, tickets, runs, now)[0];
  if (!top) return null;
  const title = top.title.length > 28 ? `${top.title.slice(0, 27)}…` : top.title;
  return [`#${top.id} ${title}`, top.via ? `via ${top.via}` : null, top.age].filter(Boolean).join(' · ');
}

/* ————— run trail: what the agent has done on one ticket, run by run ————— */

const OK_RUN = new Set(['ok', 'done', 'completed', 'succeeded', 'success']);
const FAILED_RUN = new Set(['failed', 'error', 'errored', 'timeout', 'timed_out']);

function runKind(run) {
  const status = String(run?.status ?? '').toLowerCase();
  if (status === 'running' && !toUnixSeconds(run?.finished_at)) return 'running';
  if (OK_RUN.has(status)) return 'ok';
  if (FAILED_RUN.has(status)) return 'failed';
  return 'other';
}

/**
 * The runs of one ticket, oldest first, from the admin's active and recent run
 * lists (a run in both counts once). Each says how it went and how long it
 * took; a running one counts up to now. Durations come only from real
 * started/finished times. `summary` reads like "3 runs · 1 failed · 14m agent".
 */
export function runTrail(ticketId, running = [], recent = [], now = Date.now(), limit = 6) {
  if (ticketId === null || ticketId === undefined) return null;
  const key = String(ticketId);
  const nowSeconds = toUnixSeconds(now) || Date.now() / 1000;
  const seen = new Map();
  for (const run of [...(Array.isArray(recent) ? recent : []), ...(Array.isArray(running) ? running : [])]) {
    if (!run || String(run.ticket_id) !== key) continue;
    seen.set(String(run.id ?? `${run.started_at}`), run);
  }
  if (seen.size === 0) return null;
  const runs = [...seen.values()]
    .map((run) => {
      const kind = runKind(run);
      const started = toUnixSeconds(run.started_at);
      const finished = toUnixSeconds(run.finished_at);
      const seconds = started ? Math.max(0, (finished || (kind === 'running' ? nowSeconds : 0)) - started) : 0;
      return { id: run.id ?? null, kind, status: run.status ?? null, started, seconds: finished || kind === 'running' ? seconds : 0 };
    })
    .sort((a, b) => (a.started || 0) - (b.started || 0));
  const failed = runs.filter((r) => r.kind === 'failed').length;
  const agentSeconds = runs.reduce((sum, r) => sum + r.seconds, 0);
  const parts = [`${runs.length} ${runs.length === 1 ? 'run' : 'runs'}`];
  if (failed) parts.push(`${failed} failed`);
  if (runs.some((r) => r.kind === 'running')) parts.push('running now');
  if (agentSeconds > 0) parts.push(`${shortAge(agentSeconds)} agent`);
  return { runs: runs.slice(-limit), total: runs.length, failed, agentSeconds, summary: parts.join(' · ') };
}

/* ————— fleet ticker: what is running now, and what waits on a person ————— */

/**
 * One line for the top of the park. `running`: each running ticket with how
 * long its run has gone. `attention`: tickets whose latest run failed (and is
 * not being retried) or finished and now waits in review, oldest wait first.
 * `idle`: when nothing runs, how long ago the last run finished.
 */
export function fleetTicker({ running = [], recent = [], tickets = [], now = Date.now(), limit = 4 } = {}) {
  const nowSeconds = toUnixSeconds(now) || Date.now() / 1000;
  const byTicket = new Map((Array.isArray(tickets) ? tickets : []).filter(Boolean).map((t) => [String(t.id), t]));
  const titleOf = (id, fallback) => {
    const t = byTicket.get(String(id));
    return (typeof t?.title === 'string' && t.title.trim()) || (typeof fallback === 'string' && fallback.trim()) || `#${id}`;
  };

  const runningNow = [];
  const runningIds = new Set();
  for (const run of Array.isArray(running) ? running : []) {
    if (!run || run.ticket_id === null || run.ticket_id === undefined || runKind(run) !== 'running') continue;
    const key = String(run.ticket_id);
    if (runningIds.has(key)) continue;
    runningIds.add(key);
    const started = toUnixSeconds(run.started_at);
    runningNow.push({ ticketId: run.ticket_id, title: titleOf(run.ticket_id, run.title), seconds: started ? Math.max(0, nowSeconds - started) : 0 });
  }
  runningNow.sort((a, b) => b.seconds - a.seconds);

  const latest = new Map();
  for (const run of Array.isArray(recent) ? recent : []) {
    if (!run || run.ticket_id === null || run.ticket_id === undefined) continue;
    const key = String(run.ticket_id);
    const prev = latest.get(key);
    if (!prev || toUnixSeconds(run.started_at) > toUnixSeconds(prev.started_at)) latest.set(key, run);
  }
  const attention = [];
  for (const [key, run] of latest) {
    if (runningIds.has(key)) continue;
    const ticket = byTicket.get(key);
    if (ticket && isClosedTicket(ticket)) continue;
    const kind = runKind(run);
    const finished = toUnixSeconds(run.finished_at);
    let reason = null;
    if (kind === 'failed') reason = 'failed';
    else if (kind === 'ok' && ticket?.status === 'review') reason = 'review';
    if (!reason) continue;
    attention.push({ ticketId: run.ticket_id, title: titleOf(run.ticket_id, run.title), reason, seconds: finished ? Math.max(0, nowSeconds - finished) : 0 });
  }
  attention.sort((a, b) => (a.reason === b.reason ? 0 : a.reason === 'failed' ? -1 : 1) || b.seconds - a.seconds);

  let idle = null;
  if (!runningNow.length) {
    const last = Math.max(0, ...[...latest.values()].map((r) => toUnixSeconds(r.finished_at)));
    idle = last ? `last run finished ${shortAge(nowSeconds - last)} ago` : null;
  }
  return { running: runningNow.slice(0, limit), attention: attention.slice(0, limit), attentionTotal: attention.length, idle };
}


/* ————— wait time: how long a ticket has been waiting on a person ————— */

/** "3h 10m", "45m", "2d 4h": two units, for waits shown in full. */
export function longAge(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) {
    const m = Math.floor((s % 3600) / 60);
    return `${Math.floor(s / 3600)}h${m ? ` ${m}m` : ''}`;
  }
  const h = Math.floor((s % 86400) / 3600);
  return `${Math.floor(s / 86400)}d${h ? ` ${h}h` : ''}`;
}

/**
 * Who a ticket is waiting on and since when, or null when it is not waiting
 * on a person. A review waits from the end of its latest finished run (when
 * that run is in the loaded window), else from the ticket's last update. A new
 * ticket waits for approval from when it was filed. A client reply waits from
 * `client_waiting_since`. Nothing is claimed without a timestamp.
 */
export function ticketWait(ticket, recent = [], now = Date.now()) {
  if (!ticket || isClosedTicket(ticket)) return null;
  const nowSeconds = toUnixSeconds(now) || Date.now() / 1000;
  const key = String(ticket.id);
  let since = 0;
  let label = null;
  if (ticket.status === 'review') {
    for (const run of Array.isArray(recent) ? recent : []) {
      if (!run || String(run.ticket_id) !== key) continue;
      const finished = toUnixSeconds(run.finished_at);
      if (finished > since) since = finished;
    }
    if (!since) since = toUnixSeconds(ticket.updated_at);
    label = 'on you';
  } else if (ticket.status === 'new') {
    since = toUnixSeconds(ticket.created_at ?? ticket.updated_at);
    label = 'for approval';
  } else if (isWaitingTicket(ticket)) {
    since = toUnixSeconds(ticket.client_waiting_since);
    label = 'on your reply';
  }
  if (!label || !since || since > nowSeconds) return null;
  const seconds = nowSeconds - since;
  return { seconds, text: `waiting ${longAge(seconds)} ${label}` };
}

/** The longest a ticket on this plot has waited on a person, e.g. "Needs you · 3h"; null when none waits. */
export function plotWaitLabel(plot, tickets = [], runs = [], now = Date.now(), recent = []) {
  const longest = plotTickets(plot, tickets, runs, now, recent).reduce((max, row) => Math.max(max, row.wait?.seconds ?? 0), 0);
  return longest > 0 ? `Needs you · ${shortAge(longest)}` : null;
}
