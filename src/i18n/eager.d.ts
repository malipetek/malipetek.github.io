import type { T } from '../lib/i18n.js';
export function tFor(locale: string | null | undefined): T;
/** The preview widget's copy for a locale, `preview.` prefix removed. */
export function previewStrings(locale: string | null | undefined): Record<string, string>;
