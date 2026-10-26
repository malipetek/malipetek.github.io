export const FILE_LIMITS: { bytes: number; perMessage: number; perTicket: number };
export const FILE_TYPES: Record<string, string>;
export const ACCEPT: string;
export function sizeText(bytes: number): string;
export function checkPicked(files: ArrayLike<{ name: string; size: number }> & Iterable<{ name: string; size: number }>): string | null;
