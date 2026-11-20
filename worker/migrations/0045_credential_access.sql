CREATE TABLE credential_access (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, run_id INTEGER NOT NULL, node_id TEXT, integrations TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX credential_access_project ON credential_access(project_id, at);
