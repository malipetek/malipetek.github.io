-- Device sign-in for the PTech Admin desktop app: a custom-scheme PKCE handoff.
--
--   1. The app makes a verifier (43–128 unreserved characters), sends the
--      base64url SHA-256 of it as `challenge` to POST /auth/device/start, and
--      gets a device code and a browser URL back. No session exists yet.
--   2. The person opens /portal/device?code=…, signs in as a portal admin and
--      approves. POST /portal/device/approve mints a one-time authorization
--      code (5 minutes), bound to that admin's user id and the challenge.
--   3. The app POSTs { code, verifier } to /auth/device/token. The code is
--      claimed atomically, the verifier must hash to challenge_hash, and a
--      normal 30-day portal session is returned.
--
-- device_hash      sha256 of the device code handed to the app (never the code)
-- challenge_hash   sha256 of the app's verifier, in hex, so the token endpoint
--                  can compare sha256(verifier) directly
-- code_hash        sha256 of the one-time authorization code, NULL until approved
-- user_id          the admin who approved, NULL until approved
-- label            the app name the consent page shows ("PTech Admin")
-- state            the app's own correlation value, echoed in the redirect
-- created_at       when the device code was issued
-- expires_at       the 10-minute window to approve
-- code_expires_at  the 5-minute window to redeem after approval
-- used_at          when the code was exchanged; a row is dead after that
--
-- Additive only.

CREATE TABLE device_authorizations (
  device_hash TEXT PRIMARY KEY,
  challenge_hash TEXT NOT NULL,
  code_hash TEXT,
  user_id TEXT,
  label TEXT,
  state TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  code_expires_at INTEGER,
  used_at INTEGER
);

-- Redemption looks the authorization code up by its hash.
CREATE INDEX device_authorizations_code ON device_authorizations(code_hash);
