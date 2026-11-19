/*
 * The badge that marks a ticket filed by the client's AI assistant through
 * PTech's MCP server. The admin API's ticket objects carry `assistant_app`:
 * the assistant's name ("ChatGPT", "Claude", an MCP key label), or null when
 * a person filed the request in the portal.
 *
 * Pure, so the native Admin (packages/dsh-admin) and the shared workbench
 * (packages/admin-ui) show exactly the same words, and `source === 'assistant'`
 * — a change the assistant made itself — never leaks into this badge.
 */

/** Longest badge, counting the `via ` prefix and the ellipsis. */
export const ASSISTANT_BADGE_MAX = 24;

/** The assistant's name exactly as the API gives it, trimmed; null when absent. */
export function assistantName(ticket) {
  const value = ticket?.assistant_app;
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name === '' ? null : name;
}

/**
 * `via <name>` for the ticket's assistant, at most ASSISTANT_BADGE_MAX
 * characters (a longer name is cut and ends with `…`); null when a person
 * filed the ticket in the portal.
 */
export function assistantBadge(ticket) {
  const name = assistantName(ticket);
  if (name === null) return null;
  const chars = Array.from(`via ${name}`);
  return chars.length <= ASSISTANT_BADGE_MAX
    ? chars.join('')
    : `${chars.slice(0, ASSISTANT_BADGE_MAX - 1).join('')}…`;
}

/** Hover text for that badge, naming the assistant in full; null when no assistant. */
export function assistantBadgeTitle(ticket) {
  const name = assistantName(ticket);
  return name === null
    ? null
    : `Filed by the client's assistant (${name}) through PTech's MCP server`;
}
