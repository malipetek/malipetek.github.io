/*
 * Translated copy for the shared offer and price tables. offer.js and
 * pricing.js stay English (the homepage reads them); the portal reads the same
 * text through these helpers. Keys live in src/i18n/messages/en-US.json. A key
 * that is missing falls back to the English in the table.
 */

/** A pipeline step's `title` or `body` (STEPS in offer.js), in the reader's language. */
export function stepText(t, step, field) {
  const key = `offer.step.${step.key}.${field}`;
  const s = t(key);
  return s !== key ? s : step[field];
}

/** An attention level's `name`, `what` or `for` (ATTENTION in pricing.js), in the reader's language. */
export function attentionText(t, level, field) {
  const key = `pricing.attention.${level.key}.${field}`;
  const s = t(key);
  return s !== key ? s : level[field];
}
