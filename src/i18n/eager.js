/* The mail and status strings of every locale: for the Worker, which mails clients in any of them. */
import { createT } from '../lib/i18n.js';
import { fallbackChain } from '../lib/locales.js';
import catalogs from './mail.js';

/** t for a locale, synchronously. */
export function tFor(locale) {
  const chain = fallbackChain(locale);
  return createT(chain.map((code) => catalogs[code]), chain[0]);
}

/**
 * The preview widget's copy for a locale, with the `preview.` prefix removed.
 * The last resort is English, so a locale missing one string still shows that
 * string rather than a key.
 */
export function previewStrings(locale) {
  const chain = fallbackChain(locale);
  const out = {};
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const catalog = catalogs[chain[i]];
    if (!catalog) continue;
    for (const [key, value] of Object.entries(catalog)) {
      if (key.startsWith('preview.')) out[key.slice('preview.'.length)] = value;
    }
  }
  return out;
}
