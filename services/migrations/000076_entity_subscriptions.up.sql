-- Personal subscriptions to a project, initiative, or customer.
--
-- Slack-channel subscriptions stay out: they need the Slack install. A row here is one
-- person, one target, and independent event flags. Self-triggered changes do not notify —
-- that rule lives in the fan-out, not in a column, because it is about the actor of a later
-- mutation, not about this row.
--
-- 000074 is an unused hole (sessions shipped with no migration after URL-key took 000075).

CREATE TABLE project_subscription (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  notify_issues_added      boolean NOT NULL DEFAULT true,
  notify_issues_completed  boolean NOT NULL DEFAULT false,
  notify_updates           boolean NOT NULL DEFAULT false,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_subscription_watches_something
    CHECK (notify_issues_added OR notify_issues_completed OR notify_updates)
);

CREATE UNIQUE INDEX project_subscription_project_user_key
  ON project_subscription (project_id, user_id);
CREATE INDEX project_subscription_workspace_idx
  ON project_subscription (workspace_id);
CREATE INDEX project_subscription_user_idx
  ON project_subscription (user_id);

CREATE TRIGGER project_subscription_set_updated_at
  BEFORE UPDATE ON project_subscription
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE initiative_subscription (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  initiative_id uuid NOT NULL REFERENCES initiative(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  notify_issues_added      boolean NOT NULL DEFAULT true,
  notify_issues_completed  boolean NOT NULL DEFAULT false,
  notify_updates           boolean NOT NULL DEFAULT false,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT initiative_subscription_watches_something
    CHECK (notify_issues_added OR notify_issues_completed OR notify_updates)
);

CREATE UNIQUE INDEX initiative_subscription_initiative_user_key
  ON initiative_subscription (initiative_id, user_id);
CREATE INDEX initiative_subscription_workspace_idx
  ON initiative_subscription (workspace_id);
CREATE INDEX initiative_subscription_user_idx
  ON initiative_subscription (user_id);

CREATE TRIGGER initiative_subscription_set_updated_at
  BEFORE UPDATE ON initiative_subscription
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE customer_subscription (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  notify_request_added      boolean NOT NULL DEFAULT true,
  notify_request_important  boolean NOT NULL DEFAULT false,
  notify_request_completed  boolean NOT NULL DEFAULT false,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customer_subscription_watches_something
    CHECK (notify_request_added OR notify_request_important OR notify_request_completed)
);

CREATE UNIQUE INDEX customer_subscription_customer_user_key
  ON customer_subscription (customer_id, user_id);
CREATE INDEX customer_subscription_workspace_idx
  ON customer_subscription (workspace_id);
CREATE INDEX customer_subscription_user_idx
  ON customer_subscription (user_id);

CREATE TRIGGER customer_subscription_set_updated_at
  BEFORE UPDATE ON customer_subscription
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
