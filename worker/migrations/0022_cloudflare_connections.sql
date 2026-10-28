-- A client connects their own Cloudflare account (Cloudflare OAuth, our
-- client `malipetek`), so a site can later be hosted there instead of on
-- malipetek.online. One row per grant: the consent screen lets them pick one
-- or more accounts, which are kept as JSON [{ id, name }].
--
-- Tokens are encrypted (AES-GCM, key derived from SESSION_SECRET) and never
-- leave the Worker. Cloudflare may not issue a refresh token; without one the
-- grant lapses at `expires_at` and the portal asks the client to reconnect.
CREATE TABLE cloudflare_connections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accounts     TEXT NOT NULL DEFAULT '[]',
  scopes       TEXT NOT NULL DEFAULT '',
  access_enc   TEXT NOT NULL,
  refresh_enc  TEXT,
  expires_at   INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  revoked_at   INTEGER
);
CREATE INDEX cloudflare_connections_user ON cloudflare_connections (user_id);
