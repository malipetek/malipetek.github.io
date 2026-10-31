export interface LocaleInfo {
  code: string;
  native: string;
  english: string;
  m2m: string | null;
  beta?: boolean;
  fallback?: string;
}
export const SOURCE_LOCALE: 'en-US';
export const LOCALES: LocaleInfo[];
export const LOCALE_CODES: string[];
export function localeInfo(code: unknown): LocaleInfo | undefined;
export function isEnglish(code: unknown): boolean;
export function closestLocale(tag: unknown): string | null;
export function fromAcceptLanguage(header: unknown): string;
export function fallbackChain(code: unknown): string[];
export type TranslationEngine = 'deepseek' | 'cloudflare' | 'off';
export const TRANSLATION_ENGINES: TranslationEngine[];
