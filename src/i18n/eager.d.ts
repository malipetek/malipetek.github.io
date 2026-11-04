import type { T } from '../lib/i18n.js';
export function tFor(locale: string | null | undefined): T;
/** The preview widget's copy for a locale, `preview.` prefix removed. */
export function previewStrings(locale: string | null | undefined): Record<string, string>;
/** The plugin card's copy for a locale: `card.` strings without the prefix, plus `status.<key>`. */
export function cardStrings(locale: string | null | undefined): Record<string, string>;
