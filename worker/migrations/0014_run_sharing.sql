-- Where a run's work can be picked up by the next run, whichever node takes it.
--   commit_sha  the commit the run left (40 hex), when it changed files
--   shared_to   'origin' (pushed to the repo's remote) | 'bundle' (git bundle in R2) | NULL (only on the node)
--   shared_ref  the branch on origin, e.g. malipetek/task-7
ALTER TABLE ticket_runs ADD COLUMN commit_sha TEXT;
ALTER TABLE ticket_runs ADD COLUMN shared_to TEXT;
ALTER TABLE ticket_runs ADD COLUMN shared_ref TEXT;
