-- name: AppendChange :exec
INSERT INTO change_log (workspace_id, version, entity_type, entity_id, op,
                        team_id, scope, actor_type, actor_id, payload,
                        changed_fields, batch_key)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        sqlc.arg(changed_fields)::text[], sqlc.narg(batch_key));

-- ReadChangesSince is the sync hub's only read path, and the notification engine's. The
-- predicate maps exactly onto change_log_workspace_version_idx, and the LIMIT is what makes
-- the "gap too large -> resync" branch decidable: if the caller gets a full page it asks
-- again, and if the backlog exceeds the session's budget it sends {resync} instead of
-- streaming forever.
--
-- changed_fields and batch_key are selected even though the hub ignores them, because one
-- read path is the point: a second query shaped for the fan-out would be a second answer to
-- "what happened since V", and the two would drift on the day somebody fixes only one.
--
-- name: ReadChangesSince :many
SELECT workspace_id, version, entity_type, entity_id, op, team_id, scope,
       actor_type, actor_id, payload, created_at, changed_fields, batch_key
FROM change_log
WHERE workspace_id = sqlc.arg(workspace_id)
  AND version > sqlc.arg(after_version)
  AND version <= sqlc.arg(through_version)
ORDER BY version
LIMIT sqlc.arg(page_size);

-- OldestRetainedVersion tells a resuming client whether its position still exists. If
-- the client's version is below this, its deltas have been pruned and it must
-- re-bootstrap rather than silently miss changes.
--
-- name: OldestRetainedVersion :one
SELECT coalesce(min(version), 0)::bigint FROM change_log WHERE workspace_id = $1;

-- name: PruneChangeLogBefore :execrows
DELETE FROM change_log WHERE created_at < sqlc.arg(before);

-- name: EnsureChangeLogPartition :exec
SELECT create_change_log_partition(sqlc.arg(month)::date);
