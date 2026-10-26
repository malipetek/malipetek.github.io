-- Provisioning: a "new" project gets a hosted site without Ali.
--
-- The site is created on the GPTflare control plane, under the CLIENT's own
-- platform account: the platform signs in by magic link to an email address,
-- and we only ever ask it for the address the client already verified with us.
-- So one client's sites are never reachable from another client's sign-in,
-- and the platform key stays a Worker secret.

-- One platform sign-in per user. `auth_request_id` is the platform's
-- per-conversation handle; it is reused until the platform calls it expired.
CREATE TABLE platform_accounts (
  user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  auth_request_id  TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'verified', 'expired')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

-- One hosted site per project, and where provisioning has got to.
--   signin       waiting for the client to open the platform's sign-in link
--   creating     the draft is being created (operation_id is polled)
--   provisioning the repo and build are being made (operation_id is polled)
--   ready        preview and editor exist
--   failed       stopped; `error` says why, Ali was told, retry resets it
CREATE TABLE project_sites (
  project_id      TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id),
  site_id         TEXT,
  state           TEXT NOT NULL DEFAULT 'signin'
                  CHECK (state IN ('signin', 'creating', 'provisioning', 'ready', 'failed')),
  operation_id    TEXT,
  platform_slug   TEXT,
  repo_url        TEXT,
  preview_url     TEXT,
  editor_url      TEXT,
  production_url  TEXT,
  custom_domain   TEXT,
  error           TEXT,
  -- The platform's last answer, trimmed, so a surprise in its shape is visible
  -- in the admin views rather than only in a log.
  last_payload    TEXT,
  -- When the preview branch last received a run's files.
  preview_updated_at INTEGER,
  -- When Ali was told about a failure, so it is said once.
  failure_alerted_at INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX project_sites_state ON project_sites (state);
