/*
 * The client's view of where a request is: the homepage machine with one
 * ticket parked at its real stage (src/lib/workshop3d.ts initTracker), a strip
 * of the four steps with when each happened, a plain "now / next" line, and a
 * budget gauge. Everything here is read from what the client's API already
 * returns: the ticket and its thread. Nothing about agents or machines that a
 * client is not shown elsewhere.
 */
import { priceOf, money } from './pricing.js';
import { STEPS } from './offer.js';
import { h, STATUS_LABEL, type Message, type Status, type Ticket } from './portal';

/** Which of the four steps a status is at: 0 request … 3 check, 4 shipped. */
export function stepOf(status: Status): number {
  return { new: 0, approved: 1, in_progress: 2, review: 3, done: 4, declined: 0 }[status];
}

/** When the ticket entered each step, from the thread's status lines. */
function stepTimes(ticket: Ticket, messages: Message[]): (number | null)[] {
  const times: (number | null)[] = [ticket.created_at, null, null, null];
  const byLabel = new Map(Object.entries(STATUS_LABEL).map(([status, label]) => [label, status as Status]));
  for (const m of messages) {
    if (m.author !== 'system') continue;
    const label = /Status changed to “([^”]+)”/.exec(m.body)?.[1];
    const status = label ? byLabel.get(label) : undefined;
    if (!status || status === 'new' || status === 'declined') continue;
    const step = Math.min(3, stepOf(status));
    // The latest pass through a step is the one that counts (a re-run goes back).
    times[step] = m.created_at;
  }
  return times;
}

const NOW: Record<Status, [string, string]> = {
  new: ['Waiting for me to read it. Nothing starts until I approve it.', 'Add details or files below while you wait, or withdraw it at no cost.'],
  approved: ['Approved. It starts as soon as a machine is free.', 'You can still add details; they reach the agent before it starts.'],
  in_progress: ['Being built now, on a sealed copy of your project. Nothing live is touched.', 'Replies you send now are read before the work ships.'],
  review: ['I am checking the result before it goes anywhere.', 'I will write here when it is ready, or ask you something.'],
  done: ['Done and shipped.', 'Something to add? Reply below and it opens again.'],
  declined: ['I declined this request. The reason is in the thread.', 'Reply below if something was misunderstood.'],
};

const when = (unix: number) =>
  new Date(unix * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The four steps, each marked done, current or ahead, with its time. */
export function stepStrip(ticket: Ticket, messages: Message[]) {
  const at = stepOf(ticket.status);
  const times = stepTimes(ticket, messages);
  return h(
    'ol',
    { class: `track-steps${ticket.status === 'declined' ? ' track-steps--declined' : ''}` },
    ...STEPS.map((step, i) => {
      const state = ticket.status === 'declined' ? (i === 0 ? 'done' : 'ahead') : i < at ? 'done' : i === at ? 'now' : 'ahead';
      return h(
        'li',
        { class: `track-step track-step--${state}`, 'aria-current': state === 'now' ? 'step' : undefined },
        h('span', { class: 'track-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'track-name' }, step.title),
        h('span', { class: 'track-time' }, times[i] && state !== 'ahead' ? when(times[i]!) : state === 'now' ? 'now' : ''),
      );
    }),
  );
}

/** Where it is, and what the client can do about it, in two short lines. */
export function nowLine(ticket: Ticket) {
  const [now, next] = NOW[ticket.status];
  return h('div', { class: 'track-now', role: 'status' }, h('p', null, h('strong', null, now)), h('p', null, next));
}

/** Cost so far against the budget, as a bar. No budget reads as an open bar. */
export function budgetGauge(ticket: Ticket) {
  const p = priceOf({ humanSeconds: ticket.human_seconds, aiMicroUsd: ticket.ai_micro_usd });
  const total = ticket.price_cents ?? p.totalCents;
  const budget = ticket.budget_cents;
  const share = budget ? Math.min(1, total / budget) : 0;
  const over = budget !== null && total > budget;
  const bar = h('span', { class: `gauge-bar${over ? ' gauge-bar--over' : ''}${budget === null ? ' gauge-bar--open' : ''}` });
  bar.append(h('span', { class: 'gauge-fill', style: `width: ${budget === null ? 0 : Math.max(2, share * 100)}%` }));
  return h(
    'div',
    { class: 'gauge' },
    h('span', { class: 'gauge-label' }, budget === null ? 'No budget set' : `${money(total)} of ${money(budget)}`),
    bar,
    h(
      'span',
      { class: 'gauge-note' },
      budget === null ? 'Set one and work pauses before it passes.' : over ? 'Over budget: work is paused until it is raised.' : `${Math.round(share * 100)}% used`,
    ),
  );
}


/** Four small dots for a list row: done, current, ahead. */
export function miniTrack(status: Status) {
  const at = stepOf(status);
  const label =
    status === 'declined' ? 'Declined' : at >= 4 ? 'Done: all four steps' : `Step ${at + 1} of 4: ${STEPS[at].title}`;
  return h(
    'span',
    { class: `mini-track${status === 'declined' ? ' mini-track--declined' : ''}`, role: 'img', 'aria-label': label, title: label },
    ...STEPS.map((_, i) =>
      h('span', { class: `mini-dot mini-dot--${status === 'declined' ? (i === 0 ? 'done' : 'ahead') : i < at ? 'done' : i === at ? 'now' : 'ahead'}` }),
    ),
  );
}
