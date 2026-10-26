/*
 * The prompt a node gives an agent for one run. Kept apart from node.mjs so
 * it can be tested without starting a node.
 */

/**
 * The prompt for one run. A ticket is a conversation, and a run is usually a
 * follow-up: what matters is the newest instruction, read against what was
 * asked before and what earlier runs already did. So the thread is split at
 * the last run — everything before it is background, everything after it is
 * what to do now — and earlier runs are summarised in between. Flattening it
 * all into one block (as this did before) made "now change the logo" read as
 * one more line of the original task, and every run redid the first one.
 */
export function buildPrompt(ticket, messages, previousRuns = [], checkout = {}) {
  const guard = (text) => text.replaceAll('</client_request>', '<\\/client_request>');
  const isClient = ticket.kind === 'client';
  const lastRunAt = previousRuns.reduce((t, r) => Math.max(t, r.finished_at ?? 0), 0);
  const before = messages.filter((m) => (m.created_at ?? 0) <= lastRunAt);
  const now = messages.filter((m) => (m.created_at ?? 0) > lastRunAt);
  const who = (m) => (m.author === 'client' ? 'client' : 'Ali');
  // Files sent with a message are in the checkout (fleet/node.mjs ATTACH_DIR).
  const files = (m) => (m.attachedPaths?.length ? `\n(Attached, readable in this checkout: ${m.attachedPaths.join(', ')})` : '');
  const line = (m) => `[${who(m)}]\n${m.author === 'client' ? guard(m.body + files(m)) : m.body + files(m)}`;
  // Client words always sit inside <client_request>, the marker the system
  // prompt tells the agent to treat as untrusted. Ali's words never do.
  const block = (list) =>
    isClient ? `<client_request>\n${list.map(line).join('\n\n')}\n</client_request>` : list.map(line).join('\n\n');

  const parts = [`${isClient ? 'Ticket' : 'Task'} #${ticket.id}: ${ticket.title}`];
  if (previousRuns.length) {
    if (before.length) parts.push(`## Background: what was asked before\n\n${block(before)}`);
    parts.push(
      `## What earlier runs did (summaries written by the agent)\n\n` +
        previousRuns
          .map((r) => `- Run ${r.id} (${r.executor}${r.node_id ? ` on ${r.node_id}` : ''}, ${r.status}${r.branch ? `, branch ${r.branch}` : ''}):\n  ${(r.summary || 'no summary').trim().replace(/\n+/g, '\n  ')}`)
          .join('\n'),
    );
    parts.push(
      checkout.continuedFrom
        ? `This checkout continues from ${checkout.continuedFrom}: the earlier work is already in these files. Build on it; do not redo it.`
        : checkout.elsewhere
          ? `The earlier work is on another machine (${checkout.elsewhere}) and is NOT in this checkout. Do only what is asked now, unless it depends on that work — then say so instead of redoing it.`
          : 'This checkout starts from the base branch; earlier runs\' changes are not in it.',
    );
    parts.push(
      now.length
        ? `## Do this now\n\nThe newest instruction. It is a follow-up: do what it asks, using the background only for context. Do not redo earlier work unless it says to.\n\n${block(now)}`
        : '## Do this now\n\nNothing new was written since the last run. Finish the task, picking up where the last run left off: fix what it reported as failed or unfinished.',
    );
  } else {
    parts.push(block(messages));
  }
  parts.push(isClient ? 'Work in this repository, following the rules in your system prompt.' : 'Do the task in this repository.');
  return parts.join('\n\n');
}
