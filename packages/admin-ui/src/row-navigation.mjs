/**
 * Keyboard movement between the ticket rows of one admin page.
 *
 * Kept pure and separate from the React code so the clamping rules are easy to
 * test: given the index of the focused row (-1 when none is focused), the
 * number of rows on the page, and a key, return the index to focus or null
 * when the key does not navigate.
 *
 * There is no wrap: the ends clamp. With no focused row both directions start
 * at the top, which is where the eye already is.
 */

const NEXT_KEYS = new Set(['j', 'ArrowDown']);
const PREV_KEYS = new Set(['k', 'ArrowUp']);

/**
 * @param {number} current Index of the focused row, or -1 when there is none.
 * @param {number} count Number of rows on the page.
 * @param {string} key The `KeyboardEvent.key` value.
 * @returns {number|null} The index to focus, or null when the key is not ours.
 */
export function nextRowIndex(current, count, key) {
  if (!Number.isInteger(count) || count <= 0) return null;
  const index = Number.isInteger(current) && current >= 0 && current < count ? current : -1;
  if (NEXT_KEYS.has(key)) return index < 0 ? 0 : Math.min(index + 1, count - 1);
  if (PREV_KEYS.has(key)) return index < 0 ? 0 : Math.max(index - 1, 0);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
