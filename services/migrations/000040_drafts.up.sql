-- Drafts: unsent issues and comments that survive logout and other devices.
--
-- Not replicated. A draft is personal (ScopeUser), loaded on the Drafts page, and never
-- shown to anyone else. Putting it on the change stream would wake every client in the
-- workspace for a row only one of them may see, and putting it in every replica would
-- keep six months of abandoned titles on disk for no gain. Invites and webhooks already
-- live in this on-demand bucket; drafts join them.
--
-- Local drafts (composer restore after navigating away) stay on the device. This table is
-- the *saved* kind: Esc on a half-written issue, or an explicit "Save as draft".
--
-- Retention is six months from last edit. The worker prunes; listings also hide older rows
-- so a missed cron cannot resurrect something the product promised was gone.

CREATE TABLE draft (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT draft_kind_known CHECK (kind IN ('issue', 'comment')),
  CONSTRAINT draft_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX draft_owner_updated_idx
  ON draft (workspace_id, user_id, updated_at DESC);

CREATE INDEX draft_expired_idx
  ON draft (updated_at);

CREATE TRIGGER draft_set_updated_at
  BEFORE UPDATE ON draft
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
