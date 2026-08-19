-- Attached project views: saved filters shown as tabs on a project.

ALTER TABLE view ADD COLUMN project_id uuid REFERENCES project(id) ON DELETE CASCADE;

-- A project tab is shared and project-scoped — not a sidebar entry, not private, not team-anchored.
ALTER TABLE view ADD CONSTRAINT view_project_scope_check CHECK (
  project_id IS NULL OR (team_id IS NULL AND owner_id IS NULL)
);

CREATE INDEX view_project_idx ON view (project_id)
  WHERE project_id IS NOT NULL AND archived_at IS NULL;
