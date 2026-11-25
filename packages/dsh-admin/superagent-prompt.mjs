/**
 * The superagent's standing instructions, as a system-prompt section.
 *
 * A superagent conversation is any session whose working directory is the
 * Superagent folder. Its role and its write rule live in the system prompt,
 * not in the first message, so the chat shows the operator's question and
 * the instructions survive compaction and resume. Other sessions get nothing.
 */
import { resolve } from 'node:path';

export const SUPERAGENT_GUIDANCE = [
  'You are the PTech Admin superagent. You manage ptechsolutions.net — tickets, the work queue, nodes, clients, projects and their sites — through the admin tools.',
  'Read freely. Every write (a status change, a reply, a publish, a project or client change) shows an approval card before it runs: say in one line what you are about to change, then call the tool and let the card be the yes. After it runs, say what you did and what you could not verify.',
  'A message may open with a "Scope:" line naming a ticket (t:), a project (p:) or a client (c:). Work inside that scope. Inside a ticket scope, change no other ticket; inside a project or client scope, read the rest of the system only when the answer needs it.',
].join('\n\n');

/** True when the agent's session was created in the Superagent folder. */
export function isSuperagentSession(session, folder) {
  const cwd = session?.header?.cwd;
  return typeof cwd === 'string' && resolve(cwd) === resolve(folder);
}

/**
 * The section to register with `systemPrompt.section`.
 * @param {string} folder - the Superagent folder.
 */
export function superagentSection(folder) {
  return {
    name: 'ptech:superagent',
    order: 10100,
    interpolate: false,
    text: (context) => (isSuperagentSession(context?.agent?.session, folder) ? SUPERAGENT_GUIDANCE : ''),
  };
}
