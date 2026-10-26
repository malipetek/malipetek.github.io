/*
 * The price of a ticket, in one place. The Worker bills with it, the portal
 * shows it, the homepage explains it — same arithmetic everywhere.
 *
 *   price = Ali's measured time × HOURLY_USD  +  what the AI run cost, at cost
 *
 * No tiers, no minimum, no markup on the AI. A request the agent finishes
 * almost unattended costs a minute or two of time; one Ali works through by
 * hand costs what an hour costs. Time is billed by the second.
 *
 * Money is integers: cents for prices, micro-dollars (1e-6 USD) for AI cost,
 * because a single run is often a fraction of a cent.
 */

export const HOURLY_USD = 100;

/**
 * How much of Ali the client asks for. It sets expectations and the estimate;
 * the bill is always the time actually spent.
 */
export const ATTENTION = [
  {
    key: 'auto',
    name: 'Autopilot',
    what: 'The agent does the work. I approve the request and check that it runs. I do not read every line.',
    for: 'Text and style changes, small fixes, anything easy to undo',
    typicalSeconds: 60,
  },
  {
    key: 'checked',
    name: 'Checked',
    what: 'The agent does the work and I read every changed line before it ships.',
    for: 'New pages, forms, features, anything customers touch',
    typicalSeconds: 300,
  },
  {
    key: 'hands_on',
    name: 'Hands-on',
    what: 'I work on it with the agent: decisions, hard problems, advice.',
    for: 'Architecture, debugging the weird one, consultation',
    typicalSeconds: null, // open-ended: by the clock
  },
];

export const ATTENTION_KEYS = ATTENTION.map((a) => a.key);
export const DEFAULT_ATTENTION = 'checked';

/** Cents for a stretch of Ali's time. Rounded up to the cent. */
export function timeCents(seconds) {
  return Math.ceil((Math.max(0, seconds) * HOURLY_USD * 100) / 3600);
}

/** Cents for AI cost held in micro-dollars. Rounded up to the cent, zero stays zero. */
export function aiCents(microUsd) {
  return Math.ceil(Math.max(0, microUsd) / 10000);
}

/** The bill for a ticket as it stands. */
export function priceOf({ humanSeconds = 0, aiMicroUsd = 0 }) {
  const time = timeCents(humanSeconds);
  const ai = aiCents(aiMicroUsd);
  return { timeCents: time, aiCents: ai, totalCents: time + ai };
}

/** "$1.67", "$0.04", "$120.00". */
export function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "45s", "1m 40s", "1h 05m". */
export function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

/** One line a client can read: "$2.82 — 1m 40s of my time ($2.78) + AI at cost ($0.04)". */
export function priceLine(ticket) {
  const p = priceOf(ticket);
  return `${money(p.totalCents)} — ${clock(ticket.humanSeconds ?? 0)} of my time (${money(p.timeCents)}) + AI at cost (${money(p.aiCents)})`;
}
