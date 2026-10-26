/* Labels, formatting and the routing rules the views share. */
import { money, priceOf, clock, ATTENTION } from '../../../src/lib/pricing.js';

export { money, priceOf, clock, ATTENTION };

export const STATUSES = ['new', 'approved', 'in_progress', 'review', 'done', 'declined'];
export const STATUS_LABEL = {
  new: 'New',
  approved: 'Approved',
  in_progress: 'In progress',
  review: 'In review',
  done: 'Done',
  declined: 'Declined',
};
/** What a status means for the person looking at the board. */
export const STATUS_HINT = {
  new: 'Waiting for you to approve or decline',
  approved: 'In the queue; a node picks it up',
  in_progress: 'An agent is working on it',
  review: 'The agent finished; check its work',
  done: 'Closed',
  declined: 'Closed without work',
};
/** Moves the client is emailed about. */
export const CLIENT_VISIBLE = ['approved', 'declined', 'done'];

export const PRIORITIES = [
  { value: -10, label: 'Low' },
  { value: 0, label: 'Normal' },
  { value: 10, label: 'High' },
  { value: 50, label: 'Urgent' },
];
export const priorityName = (v) => PRIORITIES.find((p) => p.value === v)?.label ?? `p${v}`;
export const EXECUTORS = ['claude', 'opencode', 'dsh', 'devin'];

export function span(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
export const ago = (unix) => (unix ? span(Date.now() / 1000 - unix) : '—');
export const usd = (micro = 0) => `$${(micro / 1_000_000).toFixed(micro && micro < 10_000 ? 4 : 2)}`;
export const when = (unix) =>
  unix ? new Date(unix * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

/** A ticket's `requires`, which arrives as a JSON string or an array. */
export function listOf(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const slugify = (text) =>
  text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

const ERRORS = {
  network: 'Could not reach the portal.',
  offline: 'The portal endpoint is not configured.',
  unauthorized: 'Your session expired. Sign in again.',
  signed_out: 'Not signed in to the portal.',
  forbidden: 'This is not an admin session.',
  not_found: 'That no longer exists.',
  bad_status: 'That is not a status the portal accepts.',
  bad_message: 'Write something first.',
  bad_project: 'Pick a project.',
  bad_budget: 'That budget is not valid.',
  bad_routing: 'That routing is not valid.',
  bad_settings: 'One of those settings is not valid.',
  not_running: 'That run already finished.',
  meter_closed: 'The meter is closed on finished work.',
  file_type: 'That type of file is not accepted (no SVG or HTML).',
  file_too_large: 'A file is over 10 MB.',
  too_many_files: 'Too many files: 5 per message, 30 per ticket.',
  files_unavailable: 'Attachments are not set up on the Worker (no R2 binding).',
};
export function errorText(error) {
  const code = error?.code ?? error?.message;
  return ERRORS[code] ?? (typeof error?.message === 'string' && error.message !== code ? error.message : `Something went wrong (${code ?? 'unknown'}).`);
}

/** Where an item would go: the Worker's claim rule, run on the loaded state. */
export function predict(nodes, { slug, requires, executor, kind }) {
  if (!slug) return { state: 'bad', text: 'No project.' };
  if (!nodes.length) return { state: 'bad', text: 'No node has ever connected.' };
  const holders = nodes.filter((n) => n.slugs.includes(slug));
  if (!holders.length) return { state: 'bad', text: `No node has ${slug} yet. Nodes clone it once the portal knows its repo.` };
  const capable = holders.filter((n) => requires.every((r) => n.capabilities.includes(r)));
  if (!capable.length) return { state: 'bad', text: `No node with ${slug} has ${requires.join(' + ')}.` };
  const needs = kind === 'client' ? 'claude' : executor;
  const runnable = needs ? capable.filter((n) => n.executors.includes(needs)) : capable;
  if (!runnable.length) return { state: 'bad', text: `No capable node runs ${needs}.` };
  const live = runnable.filter((n) => n.online && !n.draining);
  if (!live.length) return { state: 'warn', text: `Waits for ${runnable.map((n) => n.id).join(' or ')} (offline or draining).` };
  const free = live.filter((n) => n.running.length < n.slots);
  if (!free.length) return { state: 'ok', text: `Queued behind work on ${live.map((n) => n.id).join(' or ')}.` };
  return { state: 'ok', text: `Starts on ${free.map((n) => n.id).join(' or ')} within 30s.` };
}

/** Anything that needs Ali, most urgent first. */
export function needsYou(data) {
  const t = Date.now() / 1000;
  const stuckRun = new Set(data.queue.filter((q) => !q.eligible.length).map((q) => q.id));
  return {
    // The client wrote last on a filed ticket and has had no answer.
    waiting: data.tickets.filter((x) => x.client_waiting_since && x.status !== 'new'),
    review: data.tickets.filter((x) => x.status === 'review'),
    new: data.tickets.filter((x) => x.status === 'new'),
    stalled: data.tickets.filter((x) => x.status === 'in_progress' && t - x.updated_at > 45 * 60),
    stuck: data.tickets.filter((x) => x.status === 'approved' && stuckRun.has(x.id)),
    offline: data.nodes.filter((n) => !n.online),
  };
}
