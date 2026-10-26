-- Agent tokens: a client connects an AI assistant (any MCP client) to their
-- own account. A token acts as that client on the portal's client routes and
-- on the MCP server's portal_* tools — never on /admin/*, and it cannot mint
-- or revoke tokens itself. Only the SHA-256 is stored; the token is shown once.
CREATE TABLE agent_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  revoked_at    INTEGER
);
CREATE INDEX agent_tokens_user ON agent_tokens(user_id);
