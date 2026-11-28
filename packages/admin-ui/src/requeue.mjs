/*
 * What sending a ticket back to the fleet actually gives the agent.
 *
 * A queued ticket is picked up by a fleet node, which resumes the last run's
 * session. The agent's new input is whatever was added to the thread since
 * that run started: client messages, our replies and private notes. With
 * nothing new it gets the same instructions again, so the confirmation says
 * so instead of letting the button look like a magic retry.
 *
 * Pure, so the board, the ticket page and the native Task tab say the same.
 */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A row's time in seconds. The portal stores Unix seconds; an ISO string is
 * read too. Anything else is NaN, which never counts as "after".
 */
export const seconds = (value) =>
  typeof value === 'number' ? value : typeof value === 'string' && value ? Date.parse(value) / 1000 : NaN;

/** The run that started last, or null. */
export function lastRun(runs = []) {
  let best = null;
  for (const run of runs) {
    if (!Number.isFinite(seconds(run?.started_at))) continue;
    if (!best || seconds(run.started_at) > seconds(best.started_at)) best = run;
  }
  return best;
}

/** Thread entries a resumed run would read for the first time. */
export function addedSince(messages = [], run = null) {
  const since = run ? seconds(run.started_at) : -Infinity;
  const added = { client: 0, replies: 0, notes: 0 };
  for (const m of messages) {
    const at = seconds(m?.created_at);
    // Whole seconds: a message in the run's own second counts as already read, like the server.
    if (!m || !(at > since)) continue;
    if (m.author === 'client') added.client += 1;
    else if (m.author === 'ali' && m.internal === 1) added.notes += 1;
    else if (m.author === 'ali') added.replies += 1;
  }
  return added;
}

/** The confirmation text, plus whether anything new reaches the agent. */
export function requeueBrief({ messages = [], runs = [] } = {}) {
  const run = lastRun(runs);
  if (!run) {
    return { fresh: true, text: 'A fleet node picks it up and works from the request and its thread. This can change the status and notify the client.' };
  }
  const added = addedSince(messages, run);
  const parts = [
    added.client ? plural(added.client, 'client message') : null,
    added.replies ? plural(added.replies, 'reply', 'replies') : null,
    added.notes ? plural(added.notes, 'private note') : null,
  ].filter(Boolean);
  if (!parts.length) {
    return {
      fresh: false,
      text: `Nothing was added since run #${run.id}, so the agent gets the same instructions as last time. Add a private note saying what to change first. This can change the status and notify the client.`,
    };
  }
  return {
    fresh: true,
    text: `A fleet node resumes run #${run.id} with what was added since: ${parts.join(', ')}. This can change the status and notify the client.`,
  };
}
