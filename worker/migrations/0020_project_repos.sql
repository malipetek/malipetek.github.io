-- Every project gets a repo. Before this only a hosted site's project did: a
-- node made one while the site was allocating. Anything else — a project Ali
-- created in the admin view, a client's "new" project they never hosted, seeded
-- demo data — had no repo, so no node could clone it, and approved work waited
-- forever with "No node holds a folder".
--
-- `repo_wanted` says "a node should create this project's repo". A node claims
-- the job (`repo_claim_*`, a lease, so two nodes never both create it) and
-- either reports the repo or the reason it could not (`repo_error`). An error
-- stops the offer until Ali retries from the admin view.
ALTER TABLE projects ADD COLUMN repo_wanted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN repo_claim_node TEXT;
ALTER TABLE projects ADD COLUMN repo_claim_at INTEGER;
ALTER TABLE projects ADD COLUMN repo_error TEXT;

-- Client projects that are still waiting for a repo we were meant to make.
UPDATE projects SET repo_wanted = 1
 WHERE (repo IS NULL OR repo = '') AND github_installation_id IS NULL
   AND repo_kind = 'none' AND created_by IS NOT NULL;
