/**
 * How long a social post counts as, per network.
 *
 * X charges 23 characters for any link however long it is, which is why a post
 * that looks short in a text box can still be refused. The desk's counter and
 * its send button use this, so what it shows is what X will count.
 */

/** The limit per channel, matching what each network accepts. */
export const POST_MAX = { x: 280, linkedin: 3000 };

const LINK = /https?:\/\/\S+/g;

/**
 * @param {string} body - the post as written.
 * @param {string} channel - `x`, `linkedin`, or anything else.
 * @returns {number} the length the network counts.
 */
export function postLength(body, channel) {
  const text = String(body ?? '');
  if (channel !== 'x') return text.length;
  // A short link counts as itself; a long one is capped at X's 23.
  return text.replace(LINK, (url) => 'x'.repeat(Math.min(url.length, 23))).length;
}
