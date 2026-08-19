-- name: CreateFormTemplate :one
INSERT INTO form_template (id, workspace_id, team_id, name, description, properties, position, created_by)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.narg(team_id), sqlc.arg(name),
        sqlc.narg(description), sqlc.arg(properties), sqlc.arg(position), sqlc.narg(created_by))
RETURNING id, workspace_id, team_id, name, description, properties, position, created_by,
          archived_at, created_at, updated_at;

-- name: GetFormTemplate :one
SELECT id, workspace_id, team_id, name, description, properties, position, created_by,
       archived_at, created_at, updated_at
FROM form_template
WHERE id = $1;

-- name: ListFormTemplatesInWorkspace :many
SELECT id, workspace_id, team_id, name, description, properties, position, created_by,
       archived_at, created_at, updated_at
FROM form_template
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY position;

-- name: ListFormTemplatesForTeam :many
SELECT id, workspace_id, team_id, name, description, properties, position, created_by,
       archived_at, created_at, updated_at
FROM form_template
WHERE workspace_id = sqlc.arg(workspace_id)
  AND (team_id IS NULL OR team_id = sqlc.arg(team_id))
  AND archived_at IS NULL
ORDER BY position;

-- name: StreamFormTemplatesForBootstrap :many
SELECT id, workspace_id, team_id, name, description, properties, position, created_by,
       archived_at, created_at, updated_at
FROM form_template
WHERE workspace_id = sqlc.arg(workspace_id)
  AND archived_at IS NULL
  AND (team_id = ANY(sqlc.arg(team_ids)::uuid[])
       OR (team_id IS NULL AND sqlc.arg(include_workspace_scoped)::boolean))
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: UpdateFormTemplate :one
UPDATE form_template
SET name        = COALESCE(sqlc.narg(name), name),
    description = COALESCE(sqlc.narg(description), description),
    properties  = COALESCE(sqlc.narg(properties), properties),
    position    = COALESCE(sqlc.narg(position), position)
WHERE id = sqlc.arg(id) AND archived_at IS NULL
RETURNING id, workspace_id, team_id, name, description, properties, position, created_by,
          archived_at, created_at, updated_at;

-- name: ArchiveFormTemplate :one
UPDATE form_template SET archived_at = now()
WHERE id = $1 AND archived_at IS NULL
RETURNING id, workspace_id, team_id, name, description, properties, position, created_by,
          archived_at, created_at, updated_at;

-- name: UnarchiveFormTemplate :one
UPDATE form_template SET archived_at = NULL
WHERE id = $1 AND archived_at IS NOT NULL
RETURNING id, workspace_id, team_id, name, description, properties, position, created_by,
          archived_at, created_at, updated_at;

-- name: GetLastFormTemplatePosition :one
SELECT position FROM form_template
WHERE workspace_id = $1
ORDER BY position DESC
LIMIT 1;

-- name: CountIssuesFromFormTemplate :one
SELECT count(*) FROM issue
WHERE form_template_id = $1 AND deleted_at IS NULL;

-- name: CreateFormTemplateField :one
INSERT INTO form_template_field (id, workspace_id, form_template_id, field_type, label,
                                 description, required, sort_order, config)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(form_template_id), sqlc.arg(field_type),
        sqlc.arg(label), sqlc.narg(description), sqlc.arg(required), sqlc.arg(sort_order),
        sqlc.arg(config))
RETURNING id, workspace_id, form_template_id, field_type, label, description, required,
          sort_order, config, created_at, updated_at;

-- name: GetFormTemplateField :one
SELECT id, workspace_id, form_template_id, field_type, label, description, required,
       sort_order, config, created_at, updated_at
FROM form_template_field
WHERE id = $1;

-- name: ListFormTemplateFields :many
SELECT id, workspace_id, form_template_id, field_type, label, description, required,
       sort_order, config, created_at, updated_at
FROM form_template_field
WHERE form_template_id = $1
ORDER BY sort_order, id;

-- name: UpdateFormTemplateField :one
UPDATE form_template_field
SET field_type  = COALESCE(sqlc.narg(field_type), field_type),
    label       = COALESCE(sqlc.narg(label), label),
    description = COALESCE(sqlc.narg(description), description),
    required    = COALESCE(sqlc.narg(required), required),
    sort_order  = COALESCE(sqlc.narg(sort_order), sort_order),
    config      = COALESCE(sqlc.narg(config), config)
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, form_template_id, field_type, label, description, required,
          sort_order, config, created_at, updated_at;

-- name: DeleteFormTemplateField :one
DELETE FROM form_template_field
WHERE id = sqlc.arg(id)
RETURNING id, workspace_id, form_template_id, field_type, label, description, required,
          sort_order, config, created_at, updated_at;

-- name: LastFormTemplateFieldSortOrder :one
SELECT sort_order FROM form_template_field
WHERE form_template_id = $1
ORDER BY sort_order DESC
LIMIT 1;

-- name: StreamFormTemplateFieldsForBootstrap :many
SELECT f.id, f.workspace_id, f.form_template_id, f.field_type, f.label, f.description,
       f.required, f.sort_order, f.config, f.created_at, f.updated_at
FROM form_template_field f
JOIN form_template t ON t.id = f.form_template_id
WHERE f.workspace_id = sqlc.arg(workspace_id)
  AND t.archived_at IS NULL
  AND (t.team_id = ANY(sqlc.arg(team_ids)::uuid[])
       OR (t.team_id IS NULL AND sqlc.arg(include_workspace_scoped)::boolean))
  AND f.id > sqlc.arg(after_id)
ORDER BY f.id
LIMIT sqlc.arg(page_size);
