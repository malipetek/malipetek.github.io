/*
 * Device sign-in for the PTech Admin desktop app: a custom-scheme PKCE handoff.
 *
 *   1. The app makes a verifier (43–128 unreserved characters), hashes it with
 *      SHA-256 and base64url-encodes it. `POST /auth/device/start` receives
 *      that challenge and answers with a device code and a browser URL. Only
 *      sha256(deviceCode) and the challenge's digest are stored.
 *   2. A browser opens /portal/device?code=…, the person signs in as a portal
 *      admin and approves. `POST /portal/device/approve` mints a one-time
 *      authorization code (5 minutes) bound to that admin and the challenge.
 *   3. The app posts { code, verifier } to `/auth/device/token`. The code is
 *      claimed atomically, the verifier must hash to the stored challenge, and
 *      a normal portal session is issued.
 *
 * Nothing here ever stores or logs a raw device code, authorization code or
 * verifier, and no session exists until the app proves it wrote the challenge.
 */
import { fromBase64Url, now, randomToken, sha256, type Env } from './shared.ts';

/** How long the app has to get the person to the browser and approve. */
export const DEVICE_TTL_SECONDS = 10 * 60;
/** How long the app has to redeem the authorization code afterwards. */
export const DEVICE_CODE_TTL_SECONDS = 5 * 60;
/** The custom scheme the desktop app registers. */
export const DEVICE_REDIRECT = 'ptech-admin://auth';

const MAX_DEVICE_CODE_CHARS = 200;
const MAX_LABEL_CHARS = 80;
const MAX_STATE_CHARS = 200;

/** A base64url SHA-256 digest: exactly 43 characters, decoding to 32 bytes. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636 §4.1: 43–128 characters from the unreserved set. */
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

export interface DeviceUser {
  id: string;
  email: string;
  name: string | null;
  role: 'client' | 'admin';
  locale?: string | null;
}

export interface DeviceStart {
  deviceCode: string;
  expiresAt: number;
}

/**
 * The challenge as the app sent it (base64url SHA-256 of the verifier), turned
 * into the hex digest the rest of the portal stores. Keeping the hex form is
 * what lets /auth/device/token compare `sha256(verifier)` directly.
 */
function challengeDigest(challenge: string): string | null {
  if (!CHALLENGE_RE.test(challenge)) return null;
  try {
    const bytes = fromBase64Url(challenge);
    if (bytes.length !== 32) return null;
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** The app's PKCE challenge: a 43-character base64url SHA-256 digest. */
export function cleanChallenge(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const challenge = value.trim();
  return challengeDigest(challenge) ? challenge : null;
}

/** The verifier the app keeps secret until it redeems the code. */
export function cleanVerifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return VERIFIER_RE.test(value) ? value : null;
}

/** The app name the consent page shows; null when absent. Invalid → undefined. */
export function cleanDeviceLabel(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const label = value.trim();
  if (!label) return null;
  return label.slice(0, MAX_LABEL_CHARS);
}

/** The app's own state, echoed back in the redirect; null when absent. Invalid → undefined. */
export function cleanDeviceState(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  if (value.length > MAX_STATE_CHARS) return undefined;
  return value;
}

/** Where the browser hands the authorization code back to the desktop app. */
export function deviceRedirect(code: string, state?: string | null): string {
  const url = `${DEVICE_REDIRECT}?code=${encodeURIComponent(code)}`;
  return state ? `${url}&state=${encodeURIComponent(state)}` : url;
}

/**
 * Open a device authorization. The raw device code goes only in the response
 * (and the URL the app opens); the database keeps its hash. Expired rows from
 * earlier attempts are swept in the same batch.
 */
export async function startDevice(
  env: Env,
  input: { challenge: string; label?: string | null; state?: string | null },
): Promise<DeviceStart> {
  const deviceCode = randomToken();
  const created = now();
  const expiresAt = created + DEVICE_TTL_SECONDS;
  const challenge = challengeDigest(input.challenge);
  if (!challenge) throw new Error('bad_challenge');

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO device_authorizations (device_hash, challenge_hash, label, state, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(await sha256(deviceCode), challenge, input.label ?? null, input.state ?? null, created, expiresAt),
    env.DB.prepare('DELETE FROM device_authorizations WHERE expires_at < ?').bind(created - 86400),
  ]);
  return { deviceCode, expiresAt };
}

/** What the consent page may show before anyone signs in: the app's label, nothing else. */
export async function deviceInfo(env: Env, deviceCode: string): Promise<{ label: string | null; expiresAt: number } | null> {
  if (!deviceCode || deviceCode.length > MAX_DEVICE_CODE_CHARS) return null;
  const row = await env.DB.prepare(
    `SELECT label, expires_at FROM device_authorizations
      WHERE device_hash = ? AND used_at IS NULL AND expires_at > ?`,
  )
    .bind(await sha256(deviceCode), now())
    .first<{ label: string | null; expires_at: number }>();
  return row ? { label: row.label, expiresAt: row.expires_at } : null;
}

/**
 * A portal admin approves a pending device code: mint the one-time code and
 * bind it to their user id and the challenge. One approval per device code;
 * expired, used, unknown or already-approved codes resolve to null. A client
 * account can never approve.
 */
export async function approveDevice(
  env: Env,
  user: { id: string; role: string },
  deviceCode: string,
): Promise<{ code: string; state: string | null } | null> {
  if (user.role !== 'admin') return null;
  if (!deviceCode || deviceCode.length > MAX_DEVICE_CODE_CHARS) return null;
  const code = randomToken();
  const t = now();
  // The WHERE clause is the race: only an unapproved, unexpired row can move.
  const row = await env.DB.prepare(
    `UPDATE device_authorizations
        SET code_hash = ?, user_id = ?, code_expires_at = ?
      WHERE device_hash = ? AND used_at IS NULL AND code_hash IS NULL AND expires_at > ?
      RETURNING state`,
  )
    .bind(await sha256(code), user.id, t + DEVICE_CODE_TTL_SECONDS, await sha256(deviceCode), t)
    .first<{ state: string | null }>();
  return row ? { code, state: row.state ?? null } : null;
}

/**
 * Redeem an authorization code with the verifier. The atomic UPDATE marks the
 * code used only when every condition holds, so a wrong verifier does not burn
 * a good code and two callers cannot both win. Returns the approving admin's
 * user row (without the session; the caller mints that with createSession).
 */
export async function exchangeDevice(env: Env, code: string, verifier: string): Promise<DeviceUser | null> {
  if (!code || code.length > MAX_DEVICE_CODE_CHARS) return null;
  if (!cleanVerifier(verifier)) return null;
  const t = now();
  const claimed = await env.DB.prepare(
    `UPDATE device_authorizations
        SET used_at = ?
      WHERE code_hash = ? AND used_at IS NULL AND code_expires_at > ?
        AND user_id IS NOT NULL AND challenge_hash = ?
      RETURNING user_id`,
  )
    .bind(t, await sha256(code), t, await sha256(verifier))
    .first<{ user_id: string }>();
  if (!claimed) return null;
  return (
    (await env.DB.prepare('SELECT id, email, name, role, locale FROM users WHERE id = ?')
      .bind(claimed.user_id)
      .first<DeviceUser>()) ?? null
  );
}
