-- The sync stream. Every mutation appends here, in the same transaction as the entity
-- write, with a version minted from workspace_version under that workspace's row lock.
--
-- Partitioned monthly by created_at so that 30-day retention pruning is a DETACH + DROP
-- rather than a bulk DELETE that bloats the heap of the hottest table in the system.
-- The partition key has to be in the primary key, hence the three-column PK; version
-- alone is already unique per workspace because of how it is minted.

CREATE TABLE change_log (
  workspace_id uuid   NOT NULL,
  version      bigint NOT NULL,

  entity_type  text   NOT NULL,   -- 'issue' | 'team' | 'comment' | ...
  entity_id    uuid   NOT NULL,
  op           text   NOT NULL,   -- 'upsert' | 'delete' | 'revoke'

  -- Denormalised visibility key. The sync hub must decide whether a session may see a
  -- row without re-querying the entity — which may already have been deleted.
  team_id      uuid,

  -- Extra visibility facts, shaped by kind:
  --   {"kind":"workspace"}
  --   {"kind":"team","private":true}
  --   {"kind":"project","team_ids":[...]}
  --   {"kind":"issue_shared","shared_with":[...]}
  scope        jsonb  NOT NULL DEFAULT '{"kind":"workspace"}'::jsonb,

  actor_type   text   NOT NULL,
  actor_id     uuid,

  -- The entity exactly as the client stores it, produced by the same serialiser the
  -- GraphQL layer uses. If these two ever diverge the client renders one thing and the
  -- API returns another. NULL for 'delete' and 'revoke'.
  payload      jsonb,

  created_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (workspace_id, version, created_at),
  CONSTRAINT change_log_op_check CHECK (op IN ('upsert', 'delete', 'revoke')),
  CONSTRAINT change_log_actor_type_check
    CHECK (actor_type IN ('user', 'app_user', 'integration', 'system')),
  -- revoke carries no payload by definition: the client is losing access, so it must not
  -- be handed the data on the way out.
  CONSTRAINT change_log_revoke_has_no_payload
    CHECK (op <> 'revoke' OR payload IS NULL)
) PARTITION BY RANGE (created_at);

-- The hub's only read: "changes for workspace W above version V".
CREATE INDEX change_log_workspace_version_idx ON change_log (workspace_id, version)
  INCLUDE (team_id);

-- Safety net. An insert must never fail because nobody created next month's partition;
-- a monitored job moves rows out of here. Without it, a missed cron breaks every write
-- in the product at midnight on the 1st.
CREATE TABLE change_log_default PARTITION OF change_log DEFAULT;

-- Creates the monthly partition containing the given date, if it does not exist.
--
-- A worker cron calls this for the next few months every night. Keeping it in the
-- database rather than in Go means the maintenance job, the migration and a human with
-- psql during an incident all create partitions the same way.
CREATE OR REPLACE FUNCTION create_change_log_partition(month date) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  from_ts date := date_trunc('month', month)::date;
  to_ts   date := (date_trunc('month', month) + interval '1 month')::date;
  name    text := 'change_log_' || to_char(from_ts, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF change_log FOR VALUES FROM (%L) TO (%L)',
    name, from_ts, to_ts);
END;
$$;

-- Seed the window around now so the first write after migration does not land in the
-- default partition.
SELECT create_change_log_partition((date_trunc('month', now()) - interval '1 month')::date);
SELECT create_change_log_partition(now()::date);
SELECT create_change_log_partition((date_trunc('month', now()) + interval '1 month')::date);
SELECT create_change_log_partition((date_trunc('month', now()) + interval '2 month')::date);
