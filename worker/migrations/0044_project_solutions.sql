ALTER TABLE projects ADD COLUMN solutions TEXT NOT NULL DEFAULT '[]';

CREATE TABLE project_integration_checks (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  integration TEXT NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  detail TEXT,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, integration)
);
