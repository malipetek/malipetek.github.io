-- The weekly content cycle: a fleet agent writes the social posts.
--
-- 0  not a cycle ticket
-- 1  a cycle ticket, waiting for its run's outbox
-- 2  processed — its posts are queued (or it was tried and gave nothing)
--
-- The column is on the ticket because the ticket is where the run, its
-- report, and the note to Ali already live; the posts themselves go into
-- marketing_messages like every other post.

ALTER TABLE tickets ADD COLUMN marketing_cycle INTEGER NOT NULL DEFAULT 0;

CREATE INDEX tickets_marketing_cycle ON tickets(marketing_cycle, status, created_at);
