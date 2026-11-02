-- Who changed a site, and who took it live.
--
-- A client's own assistant (ChatGPT on their subscription) can change their
-- site itself, and the client can publish it without a review. That is their
-- call; this keeps the record of it.
--
-- tickets.assistant_app      the app that made a change ("ChatGPT"), for
--                            source = 'assistant' requests.
-- tickets.preview_built_at   its preview build succeeded: from then on the
--                            change is in the preview, so a publish takes it live.
-- tickets.review_skipped_at  the client chose to keep the change without review.
-- tickets.published_at       the change went to production (by a publish
--                            after it was built).
ALTER TABLE tickets ADD COLUMN assistant_app TEXT;
ALTER TABLE tickets ADD COLUMN preview_built_at INTEGER;
ALTER TABLE tickets ADD COLUMN review_skipped_at INTEGER;
ALTER TABLE tickets ADD COLUMN published_at INTEGER;

-- Every publish and rollback, by anyone. `unreviewed` lists the assistant
-- changes that went live without a review in that publish (JSON array of
-- ticket ids), so responsibility is on record per deploy.
CREATE TABLE site_publishes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  deploy_id   TEXT,
  action      TEXT NOT NULL,              -- 'publish' | 'rollback'
  user_id     TEXT,
  actor       TEXT NOT NULL,              -- the person's email
  role        TEXT NOT NULL,              -- 'client' | 'admin'
  via         TEXT NOT NULL,              -- 'portal', or the assistant app ("ChatGPT")
  unreviewed  TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL
);

CREATE INDEX site_publishes_project ON site_publishes(project_id, created_at DESC);
