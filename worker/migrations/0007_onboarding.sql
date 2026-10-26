-- Self-serve onboarding: a client describes their project, and the portal
-- creates it. Before this, every project came from Ali by hand — `POST
-- /admin/projects` plus a manual `user_projects` row — which is the one part of
-- the funnel that could not run without him.
--
-- The brief is the point. It is the durable context for the project, not a
-- one-off ticket: every later run reads it alongside the thread, so the first
-- thing a client writes is what the agent knows on run twenty.

-- 'existing' = the client brings a site or a codebase.
-- 'new'      = nothing exists; we create the site when it is provisioned.
ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'existing';
-- JSON: { what, where?, manual?, goal }. See worker/src/setup.ts.
ALTER TABLE projects ADD COLUMN brief TEXT NOT NULL DEFAULT '{}';
-- The repo the client brought, when they brought one.
ALTER TABLE projects ADD COLUMN repo TEXT;
-- repo | zip | none. 'zip' means "they will send a copy"; 'none' means we create it.
ALTER TABLE projects ADD COLUMN repo_kind TEXT NOT NULL DEFAULT 'none';
-- The user who created it, when a client did. NULL for projects Ali created.
ALTER TABLE projects ADD COLUMN created_by TEXT;
-- When the client finished the interview. NULL for projects Ali created.
ALTER TABLE projects ADD COLUMN onboarded_at INTEGER;
