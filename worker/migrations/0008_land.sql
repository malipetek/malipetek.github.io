-- Landing a ticket's finished work on its main line, from the app.
--
-- Until now the only way was a shell command in the repo, so a finished task
-- could sit on its branch while a build waited for someone to run git. The
-- admin asks here; the node that holds the folder executes it on its next
-- heartbeat and reports back. Fast-forward only: the node pushes the work
-- branch onto the default branch and git refuses anything else.

-- When the admin asked; NULL when there is nothing to do.
ALTER TABLE tickets ADD COLUMN land_requested_at INTEGER;
-- Where it landed, when it did.
ALTER TABLE tickets ADD COLUMN landed_ref TEXT;
ALTER TABLE tickets ADD COLUMN landed_sha TEXT;
