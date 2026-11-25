/**
 * The first prompt and the title of a superagent conversation.
 *
 * The panel and the Ask actions on a ticket, project or client all start one.
 * The role and the write rule are not here: the desktop Host adds them to the
 * system prompt of every session in the Superagent folder, so the chat opens
 * on the operator's question. Pure: no React, no host.
 */

/** How far the conversation may go: one short line, read by the Host's scope rule. */
export function scopeLine(scope, label) {
  if (!scope || scope === 'all') return '';
  if (scope.startsWith('t:')) return `Scope: ticket ${label} (${scope})`;
  if (scope.startsWith('p:')) return `Scope: project “${label}” (${scope})`;
  return `Scope: client “${label}” (${scope})`;
}

/**
 * The first prompt of a conversation: the scope line when one was picked, then the ask.
 * @param {{scope?: string, label?: string, text: string}} options - scope id, its human label, and the ask.
 * @returns {string} the prompt, verbatim.
 */
export function superagentBrief({ scope = 'all', label = '', text }) {
  const line = scopeLine(scope, label);
  return line ? `${line}\n\n${String(text)}` : String(text);
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
