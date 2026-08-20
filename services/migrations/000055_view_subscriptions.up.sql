-- Personal subscriptions to a saved view. The general-purpose alerting primitive:
-- "tell me when an issue is added to this filter, or completed/canceled inside it".
--
-- Slack-channel subscriptions stay out: they need the Slack install. A row here is
-- one person, one view, and two independent event flags. Self-triggered changes do
-- not notify — that rule lives in the fan-out, not in a column, because it is about
-- the actor of a later mutation, not about this row.

CREATE TABLE view_subscription (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  view_id       uuid NOT NULL REFERENCES view(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  -- Notify when an issue newly matches the view. v1 fires on create of a matching
  -- issue; property changes that move an existing issue into the filter are deferred.
  notify_added      boolean NOT NULL DEFAULT true,
  -- Notify when an issue that currently matches the view is completed or canceled.
  notify_completed  boolean NOT NULL DEFAULT false,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT view_subscription_watches_something
    CHECK (notify_added OR notify_completed)
);

CREATE UNIQUE INDEX view_subscription_view_user_key
  ON view_subscription (view_id, user_id);
CREATE INDEX view_subscription_workspace_idx
  ON view_subscription (workspace_id);
CREATE INDEX view_subscription_user_idx
  ON view_subscription (user_id);

CREATE TRIGGER view_subscription_set_updated_at
  BEFORE UPDATE ON view_subscription
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
