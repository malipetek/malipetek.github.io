/* The mail and status strings of every locale: for the Worker, which mails clients in any of them. */
import { createT } from '../lib/i18n.js';
import { fallbackChain } from '../lib/locales.js';
import catalogs from './mail.js';

/** t for a locale, synchronously. */
export function tFor(locale) {
  const chain = fallbackChain(locale);
  return createT(chain.map((code) => catalogs[code]), chain[0]);
}

/** Every string under `prefix` for a locale, prefix removed, falling back along the chain to English. */
function stringsUnder(prefix, locale) {
  const chain = fallbackChain(locale);
  const out = {};
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const catalog = catalogs[chain[i]];
    if (!catalog) continue;
    for (const [key, value] of Object.entries(catalog)) {
      if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
    }
  }
  return out;
}

/**
 * The preview widget's copy for a locale, with the `preview.` prefix removed.
 * The last resort is English, so a locale missing one string still shows that
 * string rather than a key.
 */
export function previewStrings(locale) {
  return stringsUnder('preview.', locale);
}

/**
 * The plugin card's copy (worker/src/boardUi.ts) for a locale: the `card.`
 * strings with the prefix removed, plus the request statuses as `status.<key>`.
 */
export function cardStrings(locale) {
  const out = stringsUnder('card.', locale);
  for (const [key, value] of Object.entries(stringsUnder('status.', locale))) out[`status.${key}`] = value;
  return out;
}
