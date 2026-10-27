-- Bring-your-own agent: a client's own agent (ChatGPT plugin, Claude, any MCP
-- client) can do the work on a request Ali approved, with our tools.
--
--   tickets.worked_by          'fleet' = our nodes did it; 'client_agent' =
--                              the client's own agent sent the change, so the
--                              AI cost on the ticket is $0 — the client's own
--                              subscription paid it.
--   tickets.build_requested_at set when a client's agent asks for a preview
--                              build; a node applies the pending change and
--                              deploys it, then this clears.
--   users.handoff              how finished work reaches the client:
--                              'preview' = a preview link and Publish;
--                              'pull_request' = a PR in their GitHub repo.
ALTER TABLE tickets ADD COLUMN worked_by TEXT NOT NULL DEFAULT 'fleet'
  CHECK (worked_by IN ('fleet', 'client_agent'));
ALTER TABLE tickets ADD COLUMN build_requested_at INTEGER;
ALTER TABLE users ADD COLUMN handoff TEXT NOT NULL DEFAULT 'preview'
  CHECK (handoff IN ('preview', 'pull_request'));
