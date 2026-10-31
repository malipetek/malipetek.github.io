/*
 * Catalog loading. The portal loads only the reader's chain (lazy); the
 * Worker takes them all at build time (eager), since it mails every locale.
 */
import { createT } from '../lib/i18n.js';
import { fallbackChain, SOURCE_LOCALE } from '../lib/locales.js';
import en from './messages/en-US.json';

const lazy = import.meta.glob('./messages/*.json', { import: 'default' });

/** t for a locale, its catalogs fetched first. English is always there. */
export async function loadT(locale) {
  const chain = fallbackChain(locale);
  const catalogs = await Promise.all(
    chain.map((code) => (code === SOURCE_LOCALE ? en : lazy[`./messages/${code}.json`]?.().catch(() => undefined))),
  );
  return createT(catalogs, chain[0]);
}

/** English only, synchronous: the first paint, before a locale is known. */
export const englishT = createT([en], SOURCE_LOCALE);
