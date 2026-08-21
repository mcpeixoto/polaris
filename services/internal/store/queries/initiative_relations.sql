-- Sub-initiative parent/child links.

-- name: CreateInitiativeRelation :one
INSERT INTO initiative_relation (
  id, workspace_id, parent_initiative_id, child_initiative_id, sort_order, created_by
)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, workspace_id, parent_initiative_id, child_initiative_id, sort_order,
          created_by, created_at;

-- name: GetInitiativeRelation :one
SELECT id, workspace_id, parent_initiative_id, child_initiative_id, sort_order,
       created_by, created_at
FROM initiative_relation
WHERE id = $1;

-- name: GetInitiativeRelationByPair :one
SELECT id, workspace_id, parent_initiative_id, child_initiative_id, sort_order,
       created_by, created_at
FROM initiative_relation
WHERE parent_initiative_id = $1 AND child_initiative_id = $2;

-- name: DeleteInitiativeRelation :one
DELETE FROM initiative_relation
WHERE id = $1
RETURNING id, workspace_id, parent_initiative_id, child_initiative_id, sort_order,
          created_by, created_at;

-- name: ListInitiativeRelationsInWorkspace :many
SELECT id, workspace_id, parent_initiative_id, child_initiative_id, sort_order,
       created_by, created_at
FROM initiative_relation
WHERE workspace_id = $1;

-- name: LastInitiativeRelationSort :one
SELECT sort_order FROM initiative_relation
WHERE parent_initiative_id = $1
ORDER BY sort_order DESC
LIMIT 1;

-- StreamInitiativeRelationsForBootstrap: both ends must be visible, or the row names an
-- initiative the replica does not hold.
--
-- name: StreamInitiativeRelationsForBootstrap :many
SELECT r.id, r.workspace_id, r.parent_initiative_id, r.child_initiative_id, r.sort_order,
       r.created_by, r.created_at
FROM initiative_relation r
JOIN initiative parent ON parent.id = r.parent_initiative_id
JOIN initiative child ON child.id = r.child_initiative_id
LEFT JOIN team plt ON plt.id = parent.lead_team_id
LEFT JOIN team clt ON clt.id = child.lead_team_id
WHERE r.workspace_id = sqlc.arg(workspace_id)
  AND parent.deleted_at IS NULL AND parent.archived_at IS NULL
  AND child.deleted_at IS NULL AND child.archived_at IS NULL
  AND (
        parent.lead_team_id IS NULL
        OR plt.private = false
        OR parent.lead_team_id = ANY(sqlc.arg(team_ids)::uuid[])
      )
  AND (
        child.lead_team_id IS NULL
        OR clt.private = false
        OR child.lead_team_id = ANY(sqlc.arg(team_ids)::uuid[])
      )
  AND r.id > sqlc.arg(after_id)
ORDER BY r.id
LIMIT sqlc.arg(page_size);
