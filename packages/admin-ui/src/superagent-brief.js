/**
 * The first prompt and the title of a superagent conversation.
 *
 * The panel and a ticket's "Ask the superagent" both start one, so the role,
 * the scope and the write rule are written once here. Pure: no React, no host.
 */

const ROLE =
  'You are the PTech Admin superagent. You manage ptechsolutions.net — tickets, the work queue, nodes, clients, projects and their sites — through the admin tools.';

const RULE =
  'Read freely. Every write (a status change, a reply, a publish, a project or client change) shows an approval card before it runs: say in one line what you are about to change, then call the tool and let the card be the yes. After it runs, say what you did and what you could not verify.';

/** How far the conversation may go, in the words the operator picked. */
export function scopeLine(scope, label) {
  if (!scope || scope === 'all') return 'Scope: the whole system.';
  if (scope.startsWith('t:')) {
    return `Scope: ticket ${label} (${scope}) — its thread, its runs and its project. Do not change other tickets.`;
  }
  if (scope.startsWith('p:')) {
    return `Scope: the project “${label}” (${scope}). Work only there unless the answer needs the rest of the system.`;
  }
  return `Scope: the client “${label}” (${scope}). Work only there unless the answer needs the rest of the system.`;
}

/**
 * The first prompt of a conversation.
 * @param {{scope?: string, label?: string, text: string}} options - scope id, its human label, and the ask.
 * @returns {string} the brief, verbatim.
 */
export function superagentBrief({ scope = 'all', label = '', text }) {
  return [ROLE, scopeLine(scope, label), RULE, '', String(text)].join('\n');
}

/**
 * A conversation's title: the scope, then the ask, so a list of them reads as
 * a list of questions. `Superagent · ` is the prefix the panel lists by.
 * @param {{scope?: string, label?: string, ask: string}} options - scope id, label, and the ask.
 * @returns {string} the title, at most about 80 characters.
 */
export function superagentTitle({ scope = 'all', label = '', ask }) {
  const where = !scope || scope === 'all' ? 'whole system' : label;
  return `Superagent · ${where} — ${shorten(ask)}`;
}

/** A conversation's title carries its first ask, so the list is scannable. */
export function shorten(ask, max = 48) {
  const line = String(ask).trim().split('\n')[0];
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
