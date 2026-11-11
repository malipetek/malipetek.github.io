-- Invitations: Ali can add a client to one or more existing projects before
-- that person has ever signed in. The invite is an ordinary magic-link token
-- with its own purpose and a week to live, so /auth/verify claims it the same
-- way and cannot tell it apart from a sign-in except by how long it lasted.
--
-- login_tokens.purpose     'signin' (15 minutes) or 'invite' (7 days)
-- login_tokens.invited_by  the admin who sent the invite, for the record
-- users.invited_at         when Ali first invited this address
-- users.invited_by         who invited them
--
-- Additive only: existing tokens read as 'signin'.

ALTER TABLE login_tokens ADD COLUMN purpose TEXT NOT NULL DEFAULT 'signin'
  CHECK (purpose IN ('signin', 'invite'));
ALTER TABLE login_tokens ADD COLUMN invited_by TEXT;

ALTER TABLE users ADD COLUMN invited_at INTEGER;
ALTER TABLE users ADD COLUMN invited_by TEXT;

-- Resending and revoking look tokens up by address and purpose.
CREATE INDEX login_tokens_invite ON login_tokens(email, purpose, used_at);
