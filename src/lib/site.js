/*
 * The site's side of the catalogs. Pages are built ahead of time, so this is
 * build-time only: every locale's strings are read here, never shipped.
 *
 *   const t = siteT(locale);
 *   t('site.home.shelf.title')            the translation, or the key
 *   copy(t, 'offer.who', WHO)             the translation, or the English source
 *
 * English stays the source of truth in src/lib/offer.js; a missing translation
 * falls back to it rather than to a key, so a page never shows raw keys.
 */
import { createT } from './i18n.js';
import { LOCALES, SOURCE_LOCALE, fallbackChain } from './locales.js';

const files = import.meta.glob('../i18n/messages/*.json', { eager: true, import: 'default' });
const catalogs = Object.fromEntries(
  Object.entries(files).map(([path, catalog]) => [path.split('/').pop().replace('.json', ''), catalog]),
);

/** t for a locale, along its fallback chain (es-419 → es-ES → en-US). */
export function siteT(locale = SOURCE_LOCALE) {
  const chain = fallbackChain(locale);
  return createT(
    chain.map((code) => catalogs[code]),
    chain[0],
  );
}

/** The translation of `key`, or `english` when this locale has none. */
export function copy(t, key, english, vars) {
  const s = t(key, vars);
  return s === key ? english : s;
}

/** Every locale except the source, for the routes and the language picker. */
export const OTHER_LOCALES = LOCALES.filter((l) => l.code !== SOURCE_LOCALE);

/** The path of a page in a locale: `/` for English, `/tr/` for the rest. */
export const localePath = (code, path = '/') =>
  code === SOURCE_LOCALE ? path : `/${code}${path === '/' ? '/' : path}`;
