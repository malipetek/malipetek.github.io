-- Own hosting on malipetek.online; GPTflare is gone.
--
-- One hosted site per project. The site is static files in the
-- `malipetek-sites` R2 bucket, served by the malipetek-sites Worker:
--   <slug>.malipetek.online          production
--   <slug>--preview.malipetek.online preview
-- A deploy is immutable: files live as content-addressed blobs and the deploy
-- is a manifest of path → hash. Preview and production are just pointers to
-- deploy ids, so publish and rollback only move a pointer.
--
--   allocating  slug taken, placeholder deploy live, source repo on its way
--               (a fleet node creates it and reports it back)
--   ready       preview and production answer
--   failed      stopped; `error` says why, Ali was told, retry resets it
CREATE TABLE sites (
  project_id         TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  slug               TEXT NOT NULL UNIQUE,
  state              TEXT NOT NULL DEFAULT 'allocating'
                     CHECK (state IN ('allocating', 'ready', 'failed')),
  -- 'ours' = malipetek.online; 'cloudflare' = the client's own account (later).
  host               TEXT NOT NULL DEFAULT 'ours' CHECK (host IN ('ours', 'cloudflare')),
  template           TEXT,
  preview_deploy     TEXT,
  production_deploy  TEXT,
  -- Falls back to index.html for unknown paths (client-side routing).
  spa                INTEGER NOT NULL DEFAULT 0,
  custom_domain      TEXT,
  error              TEXT,
  failure_alerted_at INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX sites_state ON sites (state);
CREATE INDEX sites_slug ON sites (slug);

-- One row per recorded deploy. `id` is the sha-256 of the manifest, so the
-- same output is the same deploy and re-uploading is a no-op. `ticket_id` is
-- the request whose run produced it, when one did.
CREATE TABLE site_deploys (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ticket_id   INTEGER,
  commit_sha  TEXT,
  files       INTEGER NOT NULL,
  bytes       INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX site_deploys_project ON site_deploys (project_id, created_at);

DROP TABLE platform_accounts;
DROP TABLE project_sites;
