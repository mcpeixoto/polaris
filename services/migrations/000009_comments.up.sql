CREATE TABLE comment (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  issue_id     uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,

  -- Exactly one level of threading. Replies to replies attach to the thread root, which
  -- is what the UI shows anyway and what keeps the reply query a single index scan.
  parent_id    uuid REFERENCES comment(id) ON DELETE CASCADE,

  body         text NOT NULL,

  actor_type   text NOT NULL DEFAULT 'user',
  actor_id     uuid REFERENCES "user"(id) ON DELETE SET NULL,

  edited_at    timestamptz,
  -- Threads are resolvable; resolution is a property of the root comment.
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES "user"(id) ON DELETE SET NULL,

  archived_at  timestamptz,
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT comment_actor_type_check
    CHECK (actor_type IN ('user', 'app_user', 'integration', 'system')),
  CONSTRAINT comment_body_not_blank CHECK (length(btrim(body)) > 0),
  CONSTRAINT comment_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT comment_resolution_consistent
    CHECK ((resolved_at IS NULL) = (resolved_by IS NULL))
);

CREATE INDEX comment_issue_idx ON comment (issue_id, created_at)
  WHERE deleted_at IS NULL;
CREATE INDEX comment_parent_idx ON comment (parent_id, created_at)
  WHERE parent_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX comment_workspace_updated_idx ON comment (workspace_id, updated_at);

CREATE TRIGGER comment_set_updated_at
  BEFORE UPDATE ON comment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
