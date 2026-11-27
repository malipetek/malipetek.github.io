-- Where a project's work goes live on the client's own Cloudflare account:
-- JSON {provider, kind: pages|workers, name, productionBranch}, chosen by an
-- admin from what the project's stored Cloudflare credential can see.
ALTER TABLE projects ADD COLUMN deploy_target TEXT;
