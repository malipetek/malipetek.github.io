export const HOURLY_USD: number;
export interface AttentionLevel {
  key: 'auto' | 'checked' | 'hands_on';
  name: string;
  what: string;
  for: string;
  typicalSeconds: number | null;
}
export const ATTENTION: AttentionLevel[];
export const ATTENTION_KEYS: string[];
export const DEFAULT_ATTENTION: 'checked';
export function timeCents(seconds: number): number;
export function aiCents(microUsd: number): number;
export function priceOf(t: { humanSeconds?: number; aiMicroUsd?: number }): {
  timeCents: number;
  aiCents: number;
  totalCents: number;
};
export function money(cents: number): string;
export function clock(seconds: number): string;
export function priceLine(t: { humanSeconds?: number; aiMicroUsd?: number }): string;
