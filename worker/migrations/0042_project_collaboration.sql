-- A request binds the caller's retry key to an immutable payload. Mentions are
-- unique per actual saved message/recipient, even if a client changes retry key.
CREATE TABLE project_mention_requests (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, actor_user_id, request_id)
);
CREATE TABLE project_mentions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES ticket_messages(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE (message_id, recipient_user_id)
);
CREATE INDEX project_mentions_project ON project_mentions(project_id, created_at);
CREATE TABLE project_mention_outbox (
  mention_id TEXT PRIMARY KEY REFERENCES project_mentions(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','cancelled')),
  attempted_at INTEGER,
  sent_at INTEGER,
  error_code TEXT
);
-- Do not retry a claimed delivery automatically: Email Sending has no provider
-- idempotency key. A crash/timeout after acceptance cannot safely be resent.
