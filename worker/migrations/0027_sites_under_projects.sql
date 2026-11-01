-- Sites become a sub-entity of projects: one project can have several sites
-- (its main site, a landing page, docs), each with its own address, host and
-- deploy history. The project's code is still one repo; the first site is the
-- one ticket builds and previews target.
--
-- SQLite cannot add a PRIMARY KEY, so the table is rebuilt. Every existing row
-- becomes a main site with a fresh id; its deploys are pointed at it.
CREATE TABLE sites_new (
  id                          TEXT PRIMARY KEY,
  project_id                  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                        TEXT,
  slug                        TEXT NOT NULL UNIQUE,
  is_primary                  INTEGER NOT NULL DEFAULT 0,
  state                       TEXT NOT NULL DEFAULT 'allocating'
                              CHECK (state IN ('allocating', 'ready', 'failed')),
  host                        TEXT NOT NULL DEFAULT 'ours'
                              CHECK (host IN ('ours', 'cloudflare')),
  template                    TEXT,
  preview_deploy              TEXT,
  production_deploy           TEXT,
  spa                         INTEGER NOT NULL DEFAULT 0,
  custom_domain               TEXT,
  error                       TEXT,
  failure_alerted_at          INTEGER,
  rebuild_requested_at        INTEGER,
  rebuild_error               TEXT,
  cloudflare_connection_id    INTEGER REFERENCES cloudflare_connections(id),
  cloudflare_account_id       TEXT,
  cloudflare_preview_script   TEXT,
  cloudflare_production_script TEXT,
  cloudflare_preview_url      TEXT,
  cloudflare_production_url   TEXT,
  cloudflare_preview_deploy   TEXT,
  cloudflare_production_deploy TEXT,
  cloudflare_error            TEXT,
  cloudflare_deployed_at      INTEGER,
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL
);

INSERT INTO sites_new (
  id, project_id, name, slug, is_primary, state, host, template,
  preview_deploy, production_deploy, spa, custom_domain, error, failure_alerted_at,
  rebuild_requested_at, rebuild_error,
  cloudflare_connection_id, cloudflare_account_id,
  cloudflare_preview_script, cloudflare_production_script,
  cloudflare_preview_url, cloudflare_production_url,
  cloudflare_preview_deploy, cloudflare_production_deploy,
  cloudflare_error, cloudflare_deployed_at, created_at, updated_at
)
SELECT
  lower(hex(randomblob(16))), project_id, NULL, slug, 1, state, host, template,
  preview_deploy, production_deploy, spa, custom_domain, error, failure_alerted_at,
  rebuild_requested_at, rebuild_error,
  cloudflare_connection_id, cloudflare_account_id,
  cloudflare_preview_script, cloudflare_production_script,
  cloudflare_preview_url, cloudflare_production_url,
  cloudflare_preview_deploy, cloudflare_production_deploy,
  cloudflare_error, cloudflare_deployed_at, created_at, updated_at
FROM sites;

DROP TABLE sites;
ALTER TABLE sites_new RENAME TO sites;

CREATE INDEX sites_project ON sites(project_id);
CREATE INDEX sites_state ON sites(state);
CREATE INDEX sites_slug ON sites(slug);
-- Exactly one main site per project.
CREATE UNIQUE INDEX sites_one_primary ON sites(project_id) WHERE is_primary = 1;

-- A deploy belongs to the site it was built for. Old rows are pointed at the
-- project's main site.
ALTER TABLE site_deploys ADD COLUMN site_id TEXT REFERENCES sites(id) ON DELETE CASCADE;
UPDATE site_deploys
   SET site_id = (SELECT s.id FROM sites s WHERE s.project_id = site_deploys.project_id AND s.is_primary = 1 LIMIT 1);
CREATE INDEX site_deploys_site ON site_deploys(site_id, created_at);
