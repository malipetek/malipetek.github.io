-- The first preview: a new client's first request starts by itself.
--
-- When the intake assistant files the first request of a new project for a
-- verified account that has not used its first preview yet, that request is
-- approved at once and a node builds a rough first version onto the project's
-- preview. It is free to the client: no Ali time is billed, and the AI cost up
-- to the account's limit is carried by us.
--
-- tickets.first_preview           this request is a first preview (kind stays
--                                 'client', so every client path still works).
-- tickets.budget_cents            holds the AI limit while it runs: the queue
--                                 stops claiming it when the AI spend reaches it.
-- tickets.first_preview_done_at   the client was told it is ready (or stopped).
--
-- users.verified_at               when the account signed in with a magic link.
--                                 Only a verified sign-in gets a first preview.
-- users.first_preview_at          when the account used its one first preview;
--                                 NULL means still available. Ali re-grants by
--                                 clearing it in Admin -> Clients.
-- users.first_preview_limit_usd   this client's limit in dollars; NULL uses the
--                                 first_preview_limit_usd setting.

ALTER TABLE tickets ADD COLUMN first_preview INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN first_preview_done_at INTEGER;
CREATE INDEX tickets_first_preview ON tickets(first_preview, first_preview_done_at);

-- Every account made before this column existed signed in with a magic link,
-- and users.created_at is that sign-in, so it is the honest value.
ALTER TABLE users ADD COLUMN verified_at INTEGER;
UPDATE users SET verified_at = created_at WHERE verified_at IS NULL;

ALTER TABLE users ADD COLUMN first_preview_at INTEGER;
ALTER TABLE users ADD COLUMN first_preview_limit_usd REAL;
