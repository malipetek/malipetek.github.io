-- GitHub App: a client installs our app on their account or org; the
-- installation id is what we mint short-lived tokens against — nodes never
-- hold a standing credential.
--
--   github_installations            one row per GitHub installation linked to
--   id            the GitHub installation id     a user. user_id fills when the
--   user_id       our user (null until linked)   OAuth-during-install callback
--   github_login  their GitHub username          lands; before that the row is
--   account_login the account/org the app is on  unclaimed.
--   repository_selection           'all' or 'selected' on GitHub's side.
--
--   projects.github_installation_id the installation a project's repo is
--   reached through; null = a repo in our own org (the 'ours' default).
CREATE TABLE github_installations (
  id INTEGER PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  github_login TEXT,
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'User',
  repository_selection TEXT NOT NULL DEFAULT 'all',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_installations_user ON github_installations(user_id);

ALTER TABLE projects ADD COLUMN github_installation_id INTEGER REFERENCES github_installations(id);
