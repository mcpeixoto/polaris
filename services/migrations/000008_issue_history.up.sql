-- The activity feed. NOT the same thing as change_log (000010).
--
--   change_log    mechanical, every field, 30-day retention, drives sync and webhooks.
--   issue_history curated, permanent, product-shaped: it obeys rules like "property
--                 changes in the first 3 minutes after creation are folded into the
--                 creation event and never shown".
--
-- Both are emitted from domain/events.go, in the same transaction, from the same call
-- site. Conflating them means either the sync stream is lossy or the activity feed is noise.

CREATE TABLE issue_history (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  issue_id     uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,

  -- Every event carries an actor. Adding a fourth actor type later is a migration across
  -- every event table, so all four exist from the first commit even though M0 only
  -- produces 'user' and 'system'.
  actor_type   text NOT NULL,
  actor_id     uuid,

  -- 'created' | 'state' | 'assignee' | 'priority' | 'title' | 'description' |
  -- 'archived' | 'unarchived' | 'deleted' | 'restored' | 'team'
  kind         text NOT NULL,

  -- Rendered by the client, which holds the referenced entities locally. Storing display
  -- strings instead would freeze them at write time and break renames.
  from_value   jsonb,
  to_value     jsonb,

  -- Consecutive same-kind events by the same actor within a short window collapse into
  -- one feed entry. Computed at write time so the feed does not have to re-derive it on
  -- every read.
  grouped_at   timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT issue_history_actor_type_check
    CHECK (actor_type IN ('user', 'app_user', 'integration', 'system'))
);

CREATE INDEX issue_history_issue_idx ON issue_history (issue_id, created_at);
CREATE INDEX issue_history_workspace_idx ON issue_history (workspace_id, created_at);
