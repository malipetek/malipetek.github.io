-- A trusted collaborator is not an administrator and is not a client link.
ALTER TABLE projects ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE TABLE project_memberships (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_type TEXT NOT NULL DEFAULT 'trusted_developer' CHECK (member_type = 'trusted_developer'),
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_memberships_user_project ON project_memberships(user_id, project_id);
CREATE TABLE project_secrets (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, name)
);
-- A verified client creator is an explicit provenance record, not a guess.
UPDATE projects SET owner_user_id = created_by
 WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = projects.created_by AND u.role = 'client' AND u.verified_at IS NOT NULL)
   AND EXISTS (SELECT 1 FROM user_projects up WHERE up.project_id = projects.id AND up.user_id = projects.created_by);
-- Legacy projects without a creator may have one unambiguous verified client.
UPDATE projects SET owner_user_id = (
  SELECT u.id FROM user_projects up JOIN users u ON u.id = up.user_id
   WHERE up.project_id = projects.id AND u.role = 'client' AND u.verified_at IS NOT NULL
) WHERE owner_user_id IS NULL AND created_by IS NULL
  AND (SELECT count(*) FROM user_projects up JOIN users u ON u.id = up.user_id
        WHERE up.project_id = projects.id AND u.role = 'client') = 1;
