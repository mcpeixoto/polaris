-- End→start dependencies between projects. One row means the blocking project must finish
-- before the blocked project may start.

CREATE TABLE project_dependency (
  id                   uuid PRIMARY KEY,
  workspace_id         uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  blocking_project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  blocked_project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_dependency_not_self
    CHECK (blocking_project_id <> blocked_project_id),
  CONSTRAINT project_dependency_unique
    UNIQUE (blocking_project_id, blocked_project_id)
);

CREATE INDEX project_dependency_blocking_idx ON project_dependency (blocking_project_id);
CREATE INDEX project_dependency_blocked_idx ON project_dependency (blocked_project_id);
CREATE INDEX project_dependency_workspace_idx ON project_dependency (workspace_id, id);
