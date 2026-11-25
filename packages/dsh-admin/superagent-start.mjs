/**
 * Start the admin superagent conversation.
 *
 * The superagent is a Harness session, not a second chat: the Host registers
 * the admin tools, so starting one means creating a session, sending the admin
 * brief as its first prompt, and handing it to the main view. The reference is
 * released as soon as the prompt is accepted — the main view retains its own.
 *
 * @param {object} options
 * @param {object} options.sessions - The client Sessions service (`ctx.sessions`).
 * @param {(sessionId: string) => void} [options.open] - Opens the conversation in the main view.
 * @param {string} options.brief - The first prompt, verbatim.
 * @param {string} [options.title] - Names the conversation, so the tab and the
 *   session list do not show the brief's first line.
 * @param {(sessionId: string) => void} [options.remember] - Records the id for "continue".
 * @returns {Promise<string>} The conversation id.
 */
export async function startSuperagent({ sessions, open, brief, title, remember }) {
  if (typeof sessions?.create !== 'function') throw new Error('This host cannot start a conversation.');
  const sessionId = await sessions.create({});
  const reference = sessions.retain(sessionId, { source: 'workspaceOperation' });
  try {
    await reference.ready;
    const result = await reference.binding.session.prompt([{ type: 'text', text: String(brief) }], 'queue');
    if (result?.ok === false) throw new Error(result.error?.message ?? 'The conversation rejected the brief.');
    // A name is cosmetic: the brief still went out if the rename fails.
    if (title && typeof reference.binding.session.rename === 'function') {
      await reference.binding.session.rename(title).catch(() => undefined);
    }
    if (typeof open === 'function') open(sessionId);
  } finally {
    reference.release();
  }
  if (typeof remember === 'function') remember(sessionId);
  return String(sessionId);
}
