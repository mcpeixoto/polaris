-- Notifications.
--
-- Every notification derives from a change_log row. That is the architectural commitment
-- of this milestone: "what happened" already has a definition, and re-deriving it from
-- entities would produce a second one that disagrees within a month — an issue that
-- notified you about a status change the activity feed says never happened.
--
-- The engine reads change_log from a per-workspace watermark, decides who each row
-- concerns, and writes one row per recipient. It is resumable and re-runnable because of
-- the unique index on (user_id, group_key): a second pass over the same versions conflicts
-- instead of duplicating.

-- ---------------------------------------------------------------------------------------
-- Who is watching what.

CREATE TABLE issue_subscription (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  issue_id      uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  -- Why they are subscribed, so the UI can say "you were mentioned" rather than leaving
  -- the user to guess why an issue they never touched is in their inbox.
  reason        text NOT NULL DEFAULT 'manual',

  -- An explicit unsubscribe is a row, not a missing row.
  --
  -- Deleting the row instead would mean the next comment auto-subscribes the user again,
  -- so "unsubscribe" would be a button that works for about four minutes. This is the
  -- single most commonly rediscovered bug in notification systems.
  unsubscribed  boolean NOT NULL DEFAULT false,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT issue_subscription_reason_check
    CHECK (reason IN ('created', 'assigned', 'mentioned', 'commented', 'subscribed', 'manual'))
);

CREATE UNIQUE INDEX issue_subscription_key ON issue_subscription (issue_id, user_id);
-- The fan-out's only read: "who is subscribed to this issue, and still wants to hear".
CREATE INDEX issue_subscription_issue_idx ON issue_subscription (issue_id)
  WHERE unsubscribed = false;
CREATE INDEX issue_subscription_user_idx ON issue_subscription (user_id);

CREATE TRIGGER issue_subscription_set_updated_at
  BEFORE UPDATE ON issue_subscription
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------
-- What landed in whose inbox.

CREATE TABLE notification (
  id             uuid PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  -- The recipient. Scope on the change stream is ScopeUser, so a notification reaches
  -- exactly one session set and never leaks through the hub.
  user_id        uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  type           text NOT NULL,

  issue_id       uuid REFERENCES issue(id) ON DELETE CASCADE,
  comment_id     uuid REFERENCES comment(id) ON DELETE CASCADE,

  actor_type     text NOT NULL,
  actor_id       uuid,

  -- The change_log version this derives from. Keeps the engine auditable: any inbox row
  -- can be traced back to the exact mutation that produced it.
  change_version bigint NOT NULL,

  -- The coalescing key, and the reason a bulk update of two hundred issues produces one
  -- inbox row per person rather than two hundred.
  --
  -- For a single event it is the change version. For a bulk operation it is the batch's
  -- id and type, so every issue in the batch collapses into one notification carrying a
  -- count. Without this the feature that makes bulk edit useful is the same feature that
  -- makes the product unusable for everyone else on the team.
  group_key      text NOT NULL,
  count          integer NOT NULL DEFAULT 1,

  payload        jsonb,

  read_at        timestamptz,
  snoozed_until  timestamptz,
  deleted_at     timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notification_actor_type_check
    CHECK (actor_type IN ('user', 'app_user', 'integration', 'system')),
  CONSTRAINT notification_count_positive CHECK (count >= 1)
);

-- One row per recipient per event. This is what makes the fan-out idempotent: a worker
-- that crashes mid-batch and restarts re-processes the same versions and conflicts.
CREATE UNIQUE INDEX notification_recipient_group_key
  ON notification (user_id, group_key);

-- The inbox query: unread first, newest first.
CREATE INDEX notification_inbox_idx
  ON notification (user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- The unread badge, which is read on every page load and must not scan the inbox.
CREATE INDEX notification_unread_idx
  ON notification (user_id)
  WHERE read_at IS NULL AND deleted_at IS NULL AND snoozed_until IS NULL;

-- Waking snoozed notifications back up.
CREATE INDEX notification_snoozed_idx
  ON notification (snoozed_until)
  WHERE snoozed_until IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER notification_set_updated_at
  BEFORE UPDATE ON notification
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------
-- Where the engine has got to.

CREATE TABLE notification_cursor (
  workspace_id  uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  -- The highest change_log version already fanned out. Advanced only after the batch's
  -- rows commit, so a crash re-processes rather than skips — the unique index above makes
  -- re-processing free.
  version       bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER notification_cursor_set_updated_at
  BEFORE UPDATE ON notification_cursor
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------------------
-- Delivery preferences.
--
-- jsonb rather than columns because these are a growing list of per-channel, per-type
-- toggles that no query ever filters on — they are read whole, for one user, at delivery
-- time. A column per toggle would be a migration every time a notification type is added.

ALTER TABLE "user"
  ADD COLUMN notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
