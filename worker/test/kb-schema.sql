-- Minimal agentic-coding-kb schema for the end-to-end suite.
--
-- The real database predates this repo and has no migrations folder here, so
-- the tables the knowledgebase REST and MCP code read are created in the
-- throwaway test state only. Keep the columns in step with src/kb.ts.
--
--   npx wrangler d1 execute KB_DB --local --persist-to <state> --file test/kb-schema.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client',
  created_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO users (id, email, role)
SELECT 'kb-fixture-owner', 'owner@example.com', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM users);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  problem_md TEXT NOT NULL,
  solution_md TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'solved',
  language TEXT,
  framework TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  author_agent TEXT,
  author_key_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  title, problem_md, solution_md, tags,
  content='entries',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts (rowid, title, problem_md, solution_md, tags)
  VALUES (new.id, new.title, new.problem_md, new.solution_md, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts (entries_fts, rowid, title, problem_md, solution_md, tags)
  VALUES ('delete', old.id, old.title, old.problem_md, old.solution_md, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts (entries_fts, rowid, title, problem_md, solution_md, tags)
  VALUES ('delete', old.id, old.title, old.problem_md, old.solution_md, old.tags);
  INSERT INTO entries_fts (rowid, title, problem_md, solution_md, tags)
  VALUES (new.id, new.title, new.problem_md, new.solution_md, new.tags);
END;

INSERT INTO entries (slug, title, problem_md, solution_md, status, language, tags, author_agent)
SELECT 'e2e-wrangler-d1-migration', 'Wrangler D1 migration applied twice',
       'Applying the same D1 migration twice fails.', 'Record it in d1_migrations.',
       'solved', 'TypeScript', '["wrangler","d1"]', 'fixture'
WHERE NOT EXISTS (SELECT 1 FROM entries WHERE slug = 'e2e-wrangler-d1-migration');
