-- More than one address on a project: everyone linked to a project already
-- reads its client requests (VISIBLE_TICKETS), but only the author was mailed.
-- With copy_mail on, that person also gets a copy of each request's client
-- emails on this project: a new request, Ali's replies and status changes.
-- Copies carry no Reply-To; a project-mate's request stays read-only for them.
--
-- Additive only: existing links read as 0, so nobody gets new mail by default.

ALTER TABLE user_projects ADD COLUMN copy_mail INTEGER NOT NULL DEFAULT 0;
