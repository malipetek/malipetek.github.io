-- OAuth for MCP clients that will not take a pasted key (ChatGPT connectors).
-- The access token an OAuth client receives is an ordinary agent token
-- (0009), so everything that bounds an agent token bounds it too, and the
-- client sees and revokes it in the portal like any other.

-- Clients registered by Dynamic Client Registration (RFC 7591). Anyone may
-- register; registering grants nothing until a signed-in client consents.
CREATE TABLE oauth_clients (
  client_id      TEXT PRIMARY KEY,
  client_name    TEXT NOT NULL,
  -- JSON array of exact redirect URIs; the authorize step matches one exactly.
  redirect_uris  TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);

-- Authorization codes: single-use, ten minutes, bound to the client, the
-- redirect URI, the consenting user and the PKCE challenge (S256 only).
CREATE TABLE oauth_codes (
  code_hash       TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri    TEXT NOT NULL,
  code_challenge  TEXT NOT NULL,
  expires_at      INTEGER NOT NULL,
  used_at         INTEGER,
  created_at      INTEGER NOT NULL
);

-- Which OAuth client a token was issued to, so reconnecting the same app
-- replaces its old token instead of piling up keys.
ALTER TABLE agent_tokens ADD COLUMN oauth_client_id TEXT;
