-- "Rebuild preview" from the admin view: a node holding the project builds the
-- preview branch as it is and deploys it, with no agent run. Needed when a
-- build failed for a reason outside the code (a missing tool on the node), or
-- after someone pushed to the preview branch by hand.
ALTER TABLE sites ADD COLUMN rebuild_requested_at INTEGER;
-- Why the last rebuild failed, shown on the site panel until the next one works.
ALTER TABLE sites ADD COLUMN rebuild_error TEXT;
