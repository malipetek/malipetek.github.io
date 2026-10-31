/*
 * t for a locale: English at once, the locale's catalog as soon as it has
 * loaded. Used by the portal app and by the onboarding wizard, which are two
 * separate pages but should speak the same language.
 */
import { useEffect, useState } from 'react';
import { englishT, loadT } from '../../i18n/index.js';
import { fromAcceptLanguage } from '../../lib/locales.js';

/** The language to start in before the account is known: the browser's. */
export const browserLocale = () =>
  fromAcceptLanguage(navigator.languages?.join(',') || navigator.language);

export function useTranslator(locale) {
  const [t, setT] = useState(() => englishT);
  useEffect(() => {
    let live = true;
    document.documentElement.lang = locale;
    loadT(locale).then((next) => live && setT(() => next));
    return () => {
      live = false;
    };
  }, [locale]);
  return t;
}
