-- Workspace Pulse enable and digest cadence. The cursor is server-side only:
-- it is how the worker stays idempotent across restarts, not a replica type.

ALTER TABLE workspace
  ADD COLUMN pulse_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN pulse_digest_cadence text NOT NULL DEFAULT 'daily',
  ADD CONSTRAINT workspace_pulse_digest_cadence_check
    CHECK (pulse_digest_cadence IN ('off', 'daily', 'weekly'));

CREATE TABLE pulse_digest_cursor (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  last_sent_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
