/*
 * The languages the portal, its emails and the ticket bridge speak.
 *
 * One list for the site, the portal, the admin UI and the Worker. English
 * (en-US) is the source: interface strings are written in it, and agents and
 * Ali always read tickets in it. Everything else is translated.
 *
 *   code      BCP-47, stored in users.locale and message_translations.locale
 *   native    what the picker shows
 *   english   what the translator prompt and the admin views show
 *   m2m       the Workers AI m2m100 code for the fallback engine; null when
 *             m2m100 cannot do the language (only DeepSeek then)
 *   beta      machine translation is clearly weaker here; the picker says so
 *   fallback  the next locale to try for interface strings (en-US is always last)
 */
export const SOURCE_LOCALE = 'en-US';

export const LOCALES = [
  { code: 'en-US', native: 'English (United States)', english: 'English (United States)', m2m: 'en' },
  { code: 'am', native: 'አማርኛ', english: 'Amharic', m2m: 'am', beta: true },
  { code: 'bn', native: 'বাংলা', english: 'Bangla', m2m: 'bn' },
  { code: 'bho', native: 'भोजपुरी', english: 'Bhojpuri', m2m: null, beta: true, fallback: 'hi-IN' },
  { code: 'zh-Hans', native: '中文（简体）', english: 'Chinese (Simplified)', m2m: 'zh' },
  { code: 'zh-Hant', native: '中文（繁體）', english: 'Chinese (Traditional)', m2m: null, fallback: 'zh-Hans' },
  { code: 'da', native: 'Dansk', english: 'Danish', m2m: 'da' },
  { code: 'nl', native: 'Nederlands', english: 'Dutch', m2m: 'nl' },
  { code: 'fil', native: 'Filipino', english: 'Filipino', m2m: 'tl', beta: true },
  { code: 'fi', native: 'Suomi', english: 'Finnish', m2m: 'fi' },
  { code: 'fr-FR', native: 'Français (France)', english: 'French (France)', m2m: 'fr' },
  { code: 'de-DE', native: 'Deutsch (Deutschland)', english: 'German (Germany)', m2m: 'de' },
  { code: 'gu', native: 'ગુજરાતી', english: 'Gujarati', m2m: 'gu' },
  { code: 'ha', native: 'Hausa', english: 'Hausa', m2m: 'ha', beta: true },
  { code: 'hi-IN', native: 'हिन्दी (भारत)', english: 'Hindi (India)', m2m: 'hi' },
  { code: 'id-ID', native: 'Indonesia (Indonesia)', english: 'Indonesian (Indonesia)', m2m: 'id' },
  { code: 'it-IT', native: 'Italiano (Italia)', english: 'Italian (Italy)', m2m: 'it' },
  { code: 'ja-JP', native: '日本語（日本）', english: 'Japanese (Japan)', m2m: 'ja' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada', m2m: 'kn' },
  { code: 'ko-KR', native: '한국어（대한민국）', english: 'Korean (South Korea)', m2m: 'ko' },
  { code: 'ml', native: 'മലയാളം', english: 'Malayalam', m2m: 'ml' },
  { code: 'mr', native: 'मराठी', english: 'Marathi', m2m: 'mr' },
  { code: 'nb', native: 'Norsk bokmål', english: 'Norwegian Bokmål', m2m: 'no' },
  { code: 'pt-BR', native: 'Português (Brasil)', english: 'Portuguese (Brazil)', m2m: 'pt' },
  { code: 'ru', native: 'Русский', english: 'Russian', m2m: 'ru' },
  { code: 'es-419', native: 'Español (Latinoamérica)', english: 'Spanish (Latin America)', m2m: 'es', fallback: 'es-ES' },
  { code: 'es-ES', native: 'Español (España)', english: 'Spanish (Spain)', m2m: 'es', fallback: 'es-419' },
  { code: 'sw', native: 'Kiswahili', english: 'Swahili', m2m: 'sw', beta: true },
  { code: 'sv', native: 'Svenska', english: 'Swedish', m2m: 'sv' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil', m2m: 'ta' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu', m2m: null },
  { code: 'th', native: 'ไทย', english: 'Thai', m2m: 'th' },
  { code: 'tr', native: 'Türkçe', english: 'Turkish', m2m: 'tr' },
  { code: 'uk', native: 'Українська', english: 'Ukrainian', m2m: 'uk' },
  { code: 'vi', native: 'Tiếng Việt', english: 'Vietnamese', m2m: 'vi' },
];

export const LOCALE_CODES = LOCALES.map((l) => l.code);

const BY_CODE = new Map(LOCALES.map((l) => [l.code.toLowerCase(), l]));

/** The registry entry for a code, matched case-insensitively; undefined if unknown. */
export function localeInfo(code) {
  return typeof code === 'string' ? BY_CODE.get(code.toLowerCase()) : undefined;
}

/** True for any English tag (en, en-US, en-GB…): no translation needed. */
export function isEnglish(code) {
  return typeof code === 'string' && /^en(-|$)/i.test(code);
}

/**
 * The supported locale closest to a tag: exact, then by script or region
 * rules (zh-TW → zh-Hant, es-MX → es-419), then by language alone.
 * null when nothing fits.
 */
export function closestLocale(tag) {
  if (typeof tag !== 'string' || !tag.trim()) return null;
  const clean = tag.trim().replace(/_/g, '-');
  const exact = localeInfo(clean);
  if (exact) return exact.code;
  const [lang, ...rest] = clean.toLowerCase().split('-');
  if (lang === 'en') return SOURCE_LOCALE;
  if (lang === 'zh') return rest.some((p) => ['hant', 'tw', 'hk', 'mo'].includes(p)) ? 'zh-Hant' : 'zh-Hans';
  if (lang === 'es') return rest.includes('es') ? 'es-ES' : 'es-419';
  if (lang === 'no' || lang === 'nn') return 'nb';
  if (lang === 'tl') return 'fil';
  const byLang = LOCALES.find((l) => l.code.toLowerCase().split('-')[0] === lang);
  return byLang ? byLang.code : null;
}

/** The best supported locale for an Accept-Language header; en-US when none fits. */
export function fromAcceptLanguage(header) {
  if (typeof header !== 'string') return SOURCE_LOCALE;
  const ranked = header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag, q: q ? Number(q.slice(2)) || 0 : 1, i };
    })
    .filter((x) => x.tag && x.tag !== '*' && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of ranked) {
    const code = closestLocale(tag);
    if (code) return code;
  }
  return SOURCE_LOCALE;
}

/** Locales to try for an interface string, ending with en-US. */
export function fallbackChain(code) {
  const chain = [];
  let info = localeInfo(code);
  while (info && !chain.includes(info.code)) {
    chain.push(info.code);
    info = info.fallback ? localeInfo(info.fallback) : undefined;
  }
  if (!chain.includes(SOURCE_LOCALE)) chain.push(SOURCE_LOCALE);
  return chain;
}

/** How a client's messages may be translated. 'off' sends nothing to a translator. */
export const TRANSLATION_ENGINES = ['deepseek', 'cloudflare', 'off'];
