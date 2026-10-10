-- Client portal. Times are unix seconds. Local repo paths are deliberately
-- NOT stored here: the runner on Ali's machine maps project slug -> folder.

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT,
  role        TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'admin')),
  created_at  INTEGER NOT NULL
);

-- Magic-link tokens: only the SHA-256 of the token is stored.
CREATE TABLE login_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Ali links clients to projects by hand.
CREATE TABLE user_projects (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, project_id)
);

-- new -> approved (Ali only) -> in_progress -> review -> done; or declined.
-- Nothing downstream may act on a ticket that has not been approved.
CREATE TABLE tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new'
              CHECK (status IN ('new', 'approved', 'in_progress', 'review', 'done', 'declined')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX tickets_user ON tickets(user_id, updated_at DESC);
CREATE INDEX tickets_status ON tickets(status, updated_at DESC);

-- internal = 1 rows (Ali's notes, later runner output) are never sent to the client.
CREATE TABLE ticket_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author      TEXT NOT NULL CHECK (author IN ('client', 'ali', 'system')),
  body        TEXT NOT NULL,
  internal    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX ticket_messages_ticket ON ticket_messages(ticket_id, id);
