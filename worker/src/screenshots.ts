/*
 * Before/after pictures of a hosted site's preview.
 *
 * A node captures the preview as it was when it took the job, and again after
 * it deployed the change. The bytes live in R2 (never D1), and the admin page
 * gets a short-lived signed URL — an <img> cannot send the portal session
 * header, and a preview may be private to the client.
 */
import { encoder, now, toBase64Url, type Env } from './shared.ts';

/** One screenshot, as the node sends it (base64 PNG). */
export interface ShotInput {
  png?: unknown;
  url?: unknown;
}

export interface Shot {
  bytes: Uint8Array;
  url: string;
}

export interface ScreenshotRow {
  run_id: number;
  kind: 'before' | 'after';
  page_url: string | null;
  created_at: number;
}

const MAX_SHOT_BYTES = 3_000_000;
const SHOT_TTL_SECONDS = 60 * 60;

const keyOf = (ticketId: number, runId: number, kind: string) => `screenshots/tickets/${ticketId}/run-${runId}-${kind}.png`;

/** A base64 PNG within bounds, or null. */
export function cleanShot(value: unknown): Shot | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as ShotInput;
  if (typeof raw.png !== 'string' || raw.png.length < 100) return null;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(raw.png)) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(raw.png.replace(/[\r\n]/g, '')), (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes.length < 100 || bytes.length > MAX_SHOT_BYTES) return null;
  // PNG magic: anything else is not a screenshot.
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const url = typeof raw.url === 'string' ? raw.url.trim().slice(0, 500) : '';
  return { bytes, url };
}

/** Store the pictures a node sent for one run. Returns the kinds saved. */
export async function saveScreenshots(
  env: Env,
  ticketId: number,
  runId: number,
  body: { before?: unknown; after?: unknown },
): Promise<string[]> {
  if (!env.FILES) return [];
  const saved: string[] = [];
  for (const kind of ['before', 'after'] as const) {
    const shot = cleanShot(body?.[kind]);
    if (!shot) continue;
    await env.FILES.put(keyOf(ticketId, runId, kind), shot.bytes, {
      httpMetadata: { contentType: 'image/png' },
    });
    await env.DB.prepare(
      `INSERT INTO run_screenshots (run_id, ticket_id, kind, r2_key, page_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, kind) DO UPDATE SET r2_key = excluded.r2_key, page_url = excluded.page_url,
         created_at = excluded.created_at`,
    )
      .bind(runId, ticketId, kind, keyOf(ticketId, runId, kind), shot.url || null, now())
      .run();
    saved.push(kind);
  }
  return saved;
}

/* ——————————————————————— signed image URLs ——————————————————————— */

const shotSecret = (env: Env) => env.SESSION_SECRET || env.OPENROUTER_API_KEY || 'insecure-dev-secret';

async function sign(env: Env, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(shotSecret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

/** A token for `<img src>`: valid for an hour, tied to one run and one side. */
export async function shotToken(env: Env, runId: number, kind: string): Promise<string> {
  const exp = now() + SHOT_TTL_SECONDS;
  return `${exp}.${await sign(env, `${runId}|${kind}|${exp}`)}`;
}

export async function verifyShotToken(env: Env, runId: number, kind: string, token: string): Promise<boolean> {
  const [expiry, signature] = token.split('.');
  if (!expiry || !signature || Number(expiry) < now()) return false;
  return signature === (await sign(env, `${runId}|${kind}|${expiry}`));
}

/** Every picture on a ticket, newest run first, with a ready-to-use URL. */
export async function screenshotsFor(env: Env, ticketId: number, siteUrl: string) {
  const { results } = await env.DB.prepare(
    'SELECT run_id, kind, page_url, created_at FROM run_screenshots WHERE ticket_id = ? ORDER BY run_id DESC, kind',
  )
    .bind(ticketId)
    .all<ScreenshotRow>();
  return Promise.all(
    (results ?? []).map(async (row) => ({
      runId: row.run_id,
      kind: row.kind,
      pageUrl: row.page_url,
      createdAt: row.created_at,
      url: `${siteUrl}/api/shot/${row.run_id}/${row.kind}?t=${await shotToken(env, row.run_id, row.kind)}`,
    })),
  );
}

/** The bytes for one signed image request. */
export async function screenshotResponse(env: Env, runId: number, kind: string): Promise<Response | null> {
  if (!env.FILES || (kind !== 'before' && kind !== 'after')) return null;
  const row = await env.DB.prepare('SELECT r2_key FROM run_screenshots WHERE run_id = ? AND kind = ?')
    .bind(runId, kind)
    .first<{ r2_key: string }>();
  if (!row) return null;
  const object = await env.FILES.get(row.r2_key);
  if (!object) return null;
  return new Response(object.body, {
    headers: {
      'content-type': 'image/png',
      'content-length': String(object.size),
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
}
