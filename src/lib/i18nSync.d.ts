type Catalog = Record<string, string>;
type Meta = Record<string, { en: string; reviewed?: boolean }>;
export const MAIL_PREFIXES: string[];
export function shape(text: string): string;
export function translatePrompt(locale: { code: string; english: string }): string;
export function catalogWork(english: Catalog, catalog: Catalog, meta: Meta): { stale: string[]; removed: string[] };
export function acceptTranslations(
  english: Catalog,
  catalog: Catalog,
  meta: Meta,
  keys: string[],
  out: Record<string, unknown> | null | undefined,
): { written: string[]; rejected: string[] };
export function orderedCatalog(english: Catalog, catalog: Catalog, meta: Meta, removed: string[]): Catalog;
export function jsonFile(data: unknown): string;
export function mailBundleSource(catalogs: Record<string, Catalog>): string;
