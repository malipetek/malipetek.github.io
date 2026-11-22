/*
 * The one status grammar (06-design-system.md §5.1). Every domain state maps to
 * exactly one tone and one sentence-case label, on every screen. Tones are the
 * semantic tokens: ok · warn · bad · info · neutral.
 *
 * Kept free of React so hosts and tests can read it directly.
 */

const S = (tone, label, extra = {}) => Object.freeze({ tone, label, ...extra });

export const STATE_MAP = Object.freeze({
  // tickets
  new: S('info', 'New'),
  approved: S('neutral', 'Approved', { ring: true }),
  queued: S('neutral', 'Queued', { ring: true }),
  in_progress: S('info', 'Running', { live: true }),
  running: S('info', 'Running', { live: true }),
  review: S('warn', 'In review'),
  check: S('warn', 'Check'),
  stalled: S('bad', 'Stalled'),
  done: S('ok', 'Done'),
  declined: S('neutral', 'Declined', { dashed: true }),
  unknown: S('neutral', 'Unknown', { dashed: true }),
  // runs and checks
  failed: S('bad', 'Failed'),
  ok: S('ok', 'Passed'),
  passed: S('ok', 'Passed'),
  // nodes
  online: S('ok', 'Online'),
  offline: S('bad', 'Offline'),
  // contacts
  replied: S('ok', 'Replied'),
  opted_out: S('bad', 'Opted out'),
  bounced: S('bad', 'Bounced'),
});

export const TONES = Object.freeze(['ok', 'warn', 'bad', 'info', 'neutral']);

/** `auto_paused` → `Auto paused`: never show a raw enum. */
export function humanize(value) {
  const text = String(value ?? '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/**
 * Resolve a domain state to `{ key, tone, label, live, ring, dashed }`.
 * Unknown states get a neutral tone and a humanized label.
 */
export function resolveState(state, overrides = {}) {
  const key = String(state ?? 'unknown').trim().toLowerCase().replace(/[\s-]+/g, '_') || 'unknown';
  const known = STATE_MAP[key];
  const base = known ?? { tone: 'neutral', label: humanize(key) };
  const tone = TONES.includes(overrides.tone) ? overrides.tone : base.tone;
  return {
    key,
    tone,
    label: overrides.label ?? base.label,
    live: overrides.live ?? Boolean(base.live),
    ring: Boolean(base.ring),
    dashed: Boolean(base.dashed),
  };
}
