-- Cycle calendar subscription (4.7). One personal feed token per team member so a
-- Google Calendar / ICS URL can list that team's cycles without a session.
--
-- The token is the credential. Listing and bootstrap queries never select it; the
-- replica carries only that a feed exists for this user and team.

CREATE TABLE cycle_calendar_feed (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  team_id      uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  -- Pasted into Google Calendar / a feed reader. Never on the replica.
  token        text NOT NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cycle_calendar_feed_token_not_blank CHECK (length(btrim(token)) > 0),
  CONSTRAINT cycle_calendar_feed_team_user UNIQUE (team_id, user_id),
  CONSTRAINT cycle_calendar_feed_token UNIQUE (token)
);

CREATE INDEX cycle_calendar_feed_user ON cycle_calendar_feed (workspace_id, user_id);

CREATE TRIGGER cycle_calendar_feed_set_updated_at
  BEFORE UPDATE ON cycle_calendar_feed
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
