/* The mail and status strings of every locale: for the Worker, which mails clients in any of them. */
import { createT } from '../lib/i18n.js';
import { fallbackChain } from '../lib/locales.js';
import catalogs from './mail.js';

/** t for a locale, synchronously. */
export function tFor(locale) {
  const chain = fallbackChain(locale);
  return createT(chain.map((code) => catalogs[code]), chain[0]);
}
