export type Catalog = Record<string, string>;
export interface T {
  (key: string, vars?: Record<string, unknown>): string;
  locale: string;
}
export function format(template: string, vars?: Record<string, unknown>, locale?: string): string;
export function createT(catalogs: (Catalog | undefined)[], locale?: string): T;
