-- Mobile push devices, and the claim that keeps APNs delivery at-most-once.
--
-- Device tokens are not a replica type. Putting them on the change stream would broadcast
-- every phone's push credential to every other session belonging to that person — and to
-- nobody usefully, because only this server talks to APNs. Registration is a GraphQL
-- mutation that writes here and nowhere else.
--
-- The token is unique across the install: Apple reuses a token for one app on one device,
-- and a second registration (reinstall, workspace switch, a second account on the same
-- phone) must move the row rather than leave two owners both receiving the same pushes.
-- last_seen_at is touched on every successful register so a token that has gone quiet can
-- be pruned later without guessing.
--
-- environment is sandbox vs production APNs. A Debug build talks to the sandbox gateway; a
-- TestFlight / App Store build talks to production. Sending a sandbox token to production
-- (or the reverse) returns a permanent failure and would otherwise burn the row on the
-- first delivery. The client says which, and the worker picks the host from it.

CREATE TABLE push_device (
    id            uuid PRIMARY KEY,
    user_id       uuid NOT NULL REFERENCES "user" (id),
    workspace_id  uuid NOT NULL REFERENCES workspace (id),
    token         text NOT NULL,
    platform      text NOT NULL CHECK (platform IN ('ios')),
    app_bundle    text NOT NULL,
    environment   text NOT NULL CHECK (environment IN ('production', 'sandbox')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT push_device_token_unique UNIQUE (token)
);

CREATE INDEX push_device_user_idx ON push_device (user_id);

-- ---------------------------------------------------------------------------------------
-- pushed_at: the claim, mirroring emailed_at (migration 000019).
--
-- Push has the same asymmetry as email — APNs has accepted the notification long before
-- this database hears about it, and there is no way to unsend one — so the choice is
-- at-most-once, enforced by the same UPDATE ... WHERE pushed_at IS NULL ... RETURNING
-- pattern. No change_log row when this column moves: it is a fact about a delivery
-- channel, not about the issue tracker.

ALTER TABLE notification
  ADD COLUMN pushed_at timestamptz;

-- Everything already waiting predated push. Marking it delivered is the honest reading
-- (it was delivered to the inbox) and stops the first pass after this migration dumping
-- every unread row onto every registered phone as one enormous burst.
UPDATE notification SET pushed_at = now() WHERE pushed_at IS NULL;

CREATE INDEX notification_pending_push_idx
  ON notification (user_id, created_at)
  WHERE pushed_at IS NULL AND read_at IS NULL AND deleted_at IS NULL;
