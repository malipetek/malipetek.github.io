/*
 * Ticket attachments: screenshots, PDFs, exports — whatever explains the request.
 *
 * A file belongs to one message, so it is seen by exactly the people who see
 * that message: a client's files and Ali's replies by both sides, Ali's private
 * notes by Ali and the agent only. The bytes live in R2 (`FILES`), the rows in
 * D1. Without the binding every upload is refused with `files_unavailable` and
 * text messages work as before.
 *
 * Only plain, inert types are accepted (no SVG, no HTML): a download is served
 * as an attachment with nosniff and a sandbox CSP, but the safest file is one
 * that cannot run at all.
 */
import { now, type Env } from './shared.ts';
import { FILE_LIMITS, FILE_TYPES as TYPES, sizeText } from '../../src/lib/attachments.js';

export { FILE_LIMITS, sizeText };

export interface Upload {
  name: string;
  type: string;
  data: ArrayBuffer;
}

export interface FileMeta {
  id: string;
  name: string;
  type: string;
  size: number;
}

/** A file name safe to show and to send back in Content-Disposition. */
export function cleanFileName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const base = raw.split(/[\\/]/).pop() ?? '';
  const name = base
    .replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-120);
  if (!name || name === '.' || name === '..') return null;
  return name;
}

/** The type a name is allowed to be, or null when it is not on the list. */
export function fileType(name: string): string | null {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return TYPES[ext] ?? null;
}

/**
 * Check a set of files against the limits. Returns the cleaned uploads, or the
 * error code and the offending name.
 */
export function checkUploads(
  files: { name: unknown; data: ArrayBuffer }[],
  alreadyOnTicket: number,
): { ok: true; uploads: Upload[] } | { ok: false; error: string; name?: string } {
  if (files.length > FILE_LIMITS.perMessage) return { ok: false, error: 'too_many_files' };
  if (alreadyOnTicket + files.length > FILE_LIMITS.perTicket) return { ok: false, error: 'too_many_files' };
  const uploads: Upload[] = [];
  for (const file of files) {
    const name = cleanFileName(file.name);
    if (!name) return { ok: false, error: 'bad_file' };
    const type = fileType(name);
    if (!type) return { ok: false, error: 'file_type', name };
    if (file.data.byteLength === 0) return { ok: false, error: 'bad_file', name };
    if (file.data.byteLength > FILE_LIMITS.bytes) return { ok: false, error: 'file_too_large', name };
    uploads.push({ name, type, data: file.data });
  }
  return { ok: true, uploads };
}

const objectKey = (ticketId: number, fileId: string) => `tickets/${ticketId}/${fileId}`;

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function fileCount(env: Env, ticketId: number): Promise<number> {
  const row = await env.DB.prepare('SELECT count(*) AS n FROM ticket_files WHERE ticket_id = ?').bind(ticketId).first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Put the bytes in R2 first, then the rows: a failed put leaves no row that
 * points at nothing. Returns what was stored.
 */
export async function storeFiles(env: Env, ticketId: number, messageId: number, uploads: Upload[]): Promise<FileMeta[]> {
  if (!uploads.length) return [];
  if (!env.FILES) throw new Error('files_unavailable');
  const t = now();
  const stored = uploads.map((u) => ({ id: randomId(), name: u.name, type: u.type, size: u.data.byteLength, data: u.data }));
  await Promise.all(
    stored.map((f) =>
      env.FILES!.put(objectKey(ticketId, f.id), f.data, {
        httpMetadata: { contentType: f.type },
        customMetadata: { ticket: String(ticketId), name: f.name },
      }),
    ),
  );
  await env.DB.batch(
    stored.map((f) =>
      env.DB.prepare(
        `INSERT INTO ticket_files (id, ticket_id, message_id, name, type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(f.id, ticketId, messageId, f.name, f.type, f.size, t),
    ),
  );
  return stored.map(({ id, name, type, size }) => ({ id, name, type, size }));
}

/** Files on a ticket by message id, for the thread. Private notes' files only when asked. */
export async function filesByMessage(env: Env, ticketId: number, includeInternal: boolean): Promise<Map<number, FileMeta[]>> {
  const { results } = await env.DB.prepare(
    `SELECT f.id, f.name, f.type, f.size, f.message_id
       FROM ticket_files f JOIN ticket_messages m ON m.id = f.message_id
      WHERE f.ticket_id = ? ${includeInternal ? '' : 'AND m.internal = 0'}
      ORDER BY f.created_at, f.id`,
  )
    .bind(ticketId)
    .all<FileMeta & { message_id: number }>();
  const out = new Map<number, FileMeta[]>();
  for (const { message_id, ...file } of results ?? []) {
    out.set(message_id, [...(out.get(message_id) ?? []), file]);
  }
  return out;
}

/** Messages with their files attached as `files` (empty when none). */
export async function withFiles<M extends { id: number }>(
  env: Env,
  ticketId: number,
  messages: M[],
  includeInternal: boolean,
): Promise<(M & { files: FileMeta[] })[]> {
  const files = await filesByMessage(env, ticketId, includeInternal);
  return messages.map((m) => ({ ...m, files: files.get(m.id) ?? [] }));
}

/**
 * Stream one file, when the caller may see it. `includeInternal` false hides
 * files on private notes, exactly like the thread does.
 */
export async function fileResponse(
  env: Env,
  ticketId: number,
  fileId: string,
  includeInternal: boolean,
  headers: Record<string, string> = {},
): Promise<Response | null> {
  if (!/^[0-9a-f]{24}$/.test(fileId) || !env.FILES) return null;
  const row = await env.DB.prepare(
    `SELECT f.name, f.type FROM ticket_files f JOIN ticket_messages m ON m.id = f.message_id
      WHERE f.id = ? AND f.ticket_id = ? ${includeInternal ? '' : 'AND m.internal = 0'}`,
  )
    .bind(fileId, ticketId)
    .first<{ name: string; type: string }>();
  if (!row) return null;
  const object = await env.FILES.get(objectKey(ticketId, fileId));
  if (!object) return null;
  return new Response(object.body, {
    headers: {
      ...headers,
      'content-type': row.type,
      'content-length': String(object.size),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, no-store',
    },
  });
}
