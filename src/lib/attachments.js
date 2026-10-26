/*
 * What a ticket attachment may be. Shared by the Worker (worker/src/files.ts),
 * the portal and the admin workbench, so a file picker never offers what the
 * Worker would refuse.
 */

export const FILE_LIMITS = {
  /** Per file. */
  bytes: 10 * 1024 * 1024,
  /** Per message. */
  perMessage: 5,
  /** Per ticket, over its whole life. */
  perTicket: 30,
};

/** Allowed types, by extension. Nothing scriptable: no SVG, no HTML. */
export const FILE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** For `<input type="file" accept>`. */
export const ACCEPT = Object.keys(FILE_TYPES)
  .map((ext) => `.${ext}`)
  .join(',');

/** "820 B", "14 KB", "2.3 MB". */
export function sizeText(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The problem with a set of files the user picked, in words, or null. */
export function checkPicked(files) {
  if (files.length > FILE_LIMITS.perMessage) return `At most ${FILE_LIMITS.perMessage} files at a time.`;
  for (const f of files) {
    const ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '';
    if (!FILE_TYPES[ext]) return `${f.name}: that type is not accepted. Images, PDF, text, CSV, JSON, zip, Word and Excel are.`;
    if (f.size > FILE_LIMITS.bytes) return `${f.name} is over 10 MB.`;
  }
  return null;
}
