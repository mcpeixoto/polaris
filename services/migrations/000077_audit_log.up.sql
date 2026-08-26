-- The audit log: who did what, to what, from where.
--
-- Not to be confused with the two tables it sits beside, because all three record "a thing
-- happened" and they answer to different masters:
--
--   change_log    mechanical, every field of every mutation, 30-day retention, monthly
--                 partitions, scoped per recipient. It is the SYNC STREAM — it exists so a
--                 client that was offline can catch up, and it is pruned precisely because
--                 nobody is meant to read it a year later.
--   issue_history curated, permanent, product-facing. It is the activity feed on an issue.
--   audit_log     this table. Security-relevant events only, permanent, workspace-wide,
--                 admin-only, and it must still be readable when the person it describes
--                 has been removed.
--
-- Conflating the first with this one is the tempting mistake — change_log already has an
-- actor and a payload — and it is wrong in both directions: a 30-day window is useless to
-- an auditor, and per-recipient scoping means the rows an admin can see depend on which
-- teams they belong to, which is the opposite of what an audit log is for.
--
-- This table lives in the core (AGPL) migrations even though the feature that reads and
-- writes it is commercial. That is deliberate and follows ee/LICENSE's own rule — "a file
-- that would be ambiguous belongs in the core" — plus one practical reason that decides it:
-- there is ONE migration history and one polarisctl, and both image sets are built from one
-- commit (docs/06-product-model/01-licensing-and-distribution.md). A migration that shipped
-- only in the enterprise image would fork the numbering the first time either side added a
-- table, and turn "swap the image to upgrade" into "swap the image and run a different
-- migration set". An empty table in a community install costs a catalogue row.

-- Deliberately NOT partitioned, unlike change_log — and the difference is the retention
-- policy, not the row count.
--
-- change_log is partitioned by month so that expiring it is `DROP TABLE` on last month's
-- partition rather than a `DELETE` of tens of millions of rows that leaves the table
-- bloated. That reasoning does not transfer: an audit log is kept, not expired. Nothing
-- ever drops a range of it, so partitioning would buy no cheap deletion, and it would cost
-- two things that matter here — every partitioned table must carry its partition key in the
-- primary key (so `id` alone could no longer identify a row), and somebody has to create
-- next month's partition before the first write of next month or the insert fails. Paying
-- an operational tripwire for a benefit this table cannot use is how a sign-in starts
-- failing at midnight on the first.
--
-- The volumes also differ by orders of magnitude. change_log takes a row per field of every
-- mutation in the product; this takes a row when somebody signs in, changes a role, or
-- mints a key. If that assumption ever stops holding, the fix is partitioning by month at
-- that point, and it is a plain migration.
CREATE TABLE audit_log (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  -- The actor, recorded twice on purpose.
  --
  -- actor_user_id is the live reference, and it is ON DELETE SET NULL rather than CASCADE.
  -- Cascading here would mean that deleting a user deletes the record of what that user
  -- did, which is precisely the evidence an audit log exists to keep — and it would do it
  -- silently, as a side effect of an unrelated action, at the moment it matters most.
  --
  -- actor_label is that reference denormalised: the display name and email as they read at
  -- the time. It is not a cache of the join. A user renames, changes email, and is removed;
  -- the join then yields nothing or yields today's name for yesterday's act. An audit row
  -- has to say who it was *then*, so the answer is written into the row and never updated.
  actor_user_id uuid REFERENCES "user"(id) ON DELETE SET NULL,
  -- Matches authz.ActorType: user, app_user, integration, system. Not a FK and not an enum
  -- — see the workspace_plan_check note in 000016 for why this codebase keeps small vocabularies
  -- in Go rather than in the database.
  actor_type    text NOT NULL,
  actor_label   text NOT NULL DEFAULT '',

  -- What happened, as a dotted name from a fixed vocabulary owned by the ee audit package
  -- (member.role_changed, api_key.created, …). Text rather than an enum for the same reason
  -- as actor_type: adding an event must be a code change, not a data migration in every
  -- install.
  action        text NOT NULL,

  -- What it happened to. Nullable together: a sign-in has no target.
  target_type   text,
  target_id     uuid,
  -- Denormalised for the same reason as actor_label: a revoked key and a removed member
  -- must still be nameable in the row that records their removal.
  target_label  text,

  -- The change itself. Both nullable — a sign-in has neither, a creation has no `before`,
  -- a deletion has no `after`. Whoever writes these is responsible for keeping secrets out:
  -- an API key's token never appears, only its name and prefix.
  before        jsonb,
  after         jsonb,

  -- Where from, when the transport knew. Null is honest and common: only the sign-in and
  -- registration handlers carry request metadata into the domain layer today, so a role
  -- change records no address until that plumbing reaches the GraphQL route. A zero address
  -- would read as a fact.
  ip            inet,
  user_agent    text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_log_action_not_blank CHECK (btrim(action) <> ''),
  CONSTRAINT audit_log_actor_type_not_blank CHECK (btrim(actor_type) <> ''),
  -- A target is both columns or neither. A target_id with no type cannot be resolved to
  -- anything, and a type with no id names a class of thing rather than a thing.
  CONSTRAINT audit_log_target_is_whole
    CHECK ((target_type IS NULL) = (target_id IS NULL))
);

-- The one query the read path makes: this workspace's entries, newest first, a page at a
-- time. The trailing id is not decoration — it is the tiebreaker that makes keyset
-- pagination total. Two rows written in the same transaction share created_at to the
-- microsecond, and a cursor of created_at alone either repeats them on the next page or
-- skips them, depending on which way the comparison is written.
CREATE INDEX audit_log_workspace_recent_idx
  ON audit_log (workspace_id, created_at DESC, id DESC);

-- Append-only, enforced by the database rather than by the code that writes it.
--
-- The application is not the only writer — a support script, a migration and a human with
-- psql all reach this table (see the header of store/schema_invariants_test.go). An audit
-- log whose rows can be edited afterwards has no evidential value at all, and the edit that
-- destroys it is exactly the one nobody would announce.
--
-- UPDATE only. DELETE is deliberately left permitted, because the workspace foreign key
-- above cascades: refusing deletes here would make deleting a workspace fail, and "you
-- cannot delete your data" is a worse answer than "deleting the workspace takes its audit
-- log with it". Retention, if it is ever wanted, also needs this door.
CREATE FUNCTION audit_log_refuse_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: an entry may not be modified after it is written';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_refuse_update();
