-- Sign-in codes: every sign-in email carries a six-digit code next to the link,
-- so a person can finish signing in inside the window that asked (an
-- assistant's OAuth window, a phone reading the mail while the laptop waits)
-- instead of wherever their mail app opens the link.
--
-- login_tokens.code_hash   sha256 of "<email>:<code>", NULL for invites
-- login_tokens.code_tries  wrong codes typed for this address while it lived;
--                          at 5 the code is dead (the link still works)
--
-- Additive only.

ALTER TABLE login_tokens ADD COLUMN code_hash TEXT;
ALTER TABLE login_tokens ADD COLUMN code_tries INTEGER NOT NULL DEFAULT 0;
