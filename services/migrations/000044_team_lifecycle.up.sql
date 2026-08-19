-- Index for the recently-deleted teams screen: workspace + deletion time, partial on deleted rows.
CREATE INDEX team_deleted_idx ON team (workspace_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;
