/*
 * The portal session, in one place.
 *
 * A sign-in route proves an address and then calls `createSession`: the token
 * is opaque, only its SHA-256 is stored, and it lives for 30 days. Magic link,
 * email code, reviewer demo and device PKCE all share this so they cannot drift
 * apart on lifetime, storage or housekeeping.
 */
import { now, randomToken, sha256, type Env } from './shared.ts';

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Mint a session for an existing user row. The raw token is returned to the
 * caller; the database keeps only its hash. Expired links and sessions are
 * swept in the same batch.
 */
export async function createSession(env: Env, user: { id: string }): Promise<string> {
  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(session), user.id, now() + SESSION_TTL_SECONDS, now()),
    // Housekeeping while we're here.
    env.DB.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now() - 86400),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()),
  ]);
  return session;
}
