-- Feedback from a preview site.
--
-- A preview is where a client sees work before it goes live, and that is where
-- they notice what is wrong. The preview host carries a feedback widget; its
-- script posts back with the site's `feedback_token`, which is how the Worker
-- knows which project (and which client) the note belongs to without a portal
-- session on another origin.
--
-- The token is a capability: it only files a request, nothing else. It is
-- handed out to the client in the portal's preview links and never rendered on
-- the page itself.
ALTER TABLE sites ADD COLUMN feedback_token TEXT;

UPDATE sites SET feedback_token = lower(hex(randomblob(18))) WHERE feedback_token IS NULL;

CREATE UNIQUE INDEX sites_feedback_token ON sites(feedback_token);
