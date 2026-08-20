-- name: CreateIssueTemplate :one
INSERT INTO issue_template (id, workspace_id, team_id, name, description, title, body,
                            properties, position, created_by)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.narg(team_id), sqlc.arg(name),
        sqlc.narg(description),
        -- title and body are NOT NULL with an empty default: a template that prefills
        -- nothing but a set of properties is a legitimate thing to want.
        COALESCE(sqlc.narg(title)::text, ''), COALESCE(sqlc.narg(body)::text, ''),
        sqlc.arg(properties), sqlc.arg(position), sqlc.narg(created_by))
RETURNING id, workspace_id, team_id, name, description, title, body, properties,
          position, created_by, archived_at, created_at, updated_at,
          email_intake_enabled, email_intake_token, email_intake_address;

-- name: GetIssueTemplate :one
SELECT id, workspace_id, team_id, name, description, title, body, properties,
       position, created_by, archived_at, created_at, updated_at,
          email_intake_enabled, email_intake_token, email_intake_address
FROM issue_template
WHERE id = $1;

-- name: ListIssueTemplatesInWorkspace :many
SELECT id, workspace_id, team_id, name, description, title, body, properties,
       position, created_by, archived_at, created_at, updated_at,
          email_intake_enabled, email_intake_token, email_intake_address
FROM issue_template
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY position;

-- ListIssueTemplatesForTeam is what the create dialog offers in one team: the workspace's
-- templates, which are offered everywhere, plus that team's own.
--
-- name: ListIssueTemplatesForTeam :many
SELECT id, workspace_id, team_id, name, description, title, body, properties,
       position, created_by, archived_at, created_at, updated_at,
          email_intake_enabled, email_intake_token, email_intake_address
FROM issue_template
WHERE workspace_id = sqlc.arg(workspace_id)
  AND (team_id IS NULL OR team_id = sqlc.arg(team_id))
  AND archived_at IS NULL
ORDER BY position;

-- StreamIssueTemplatesForBootstrap feeds the initial snapshot. The predicate is
-- requireTemplateScope's, the same shape as the label stream's and for the same reason: a
-- template with no team is offered in every create dialog and reaches every non-guest, and
-- a team's template reaches that team's members. Those are the only two scopes a template
-- change is ever emitted under.
--
-- Archived templates are excluded — archiving emits a delete — even though issue.template_id
-- may still point at one. That column answers "is this template still worth having" from the
-- server side and is not something a replica renders.
--
-- name: StreamIssueTemplatesForBootstrap :many
SELECT id, workspace_id, team_id, name, description, title, body, properties,
       position, created_by, archived_at, created_at, updated_at,
          email_intake_enabled, email_intake_token, email_intake_address
FROM issue_template
WHERE workspace_id = sqlc.arg(workspace_id)
  AND archived_at IS NULL
  AND (team_id = ANY(sqlc.arg(team_ids)::uuid[])
       OR (team_id IS NULL AND sqlc.arg(include_workspace_scoped)::boolean))
  AND id > sqlc.arg(after_id)
ORDER BY id
LIMIT sqlc.arg(page_size);

-- name: UpdateIssueTemplate :one
UPDATE issue_template
SET name        = COALESCE(sqlc.narg(name), name),
    description = COALESCE(sqlc.narg(description), description),
    title       = COALESCE(sqlc.narg(title), title),
    body        = COALESCE(sqlc.narg(body), body),
    properties  = COALESCE(sqlc.narg(properties), properties),
    position    = COALESCE(sqlc.narg(position), position)
WHERE id = sqlc.arg(id) AND archived_at IS NULL
RETURNING id, workspace_id, team_id, name, description, title, body, properties,
          position, created_by, archived_at, created_at, updated_at,
          email_intake_enabled, email_intake_token, email_intake_address;

-- Archived rather than deleted: issue.template_id references this row, and the question
-- that column exists to answer — "is this template still worth having" — needs the
-- template to still be there after somebody retires it.
--
-- name: ArchiveIssueTemplate :one
UPDATE issue_template SET archived_at = now()
WHERE id = $1 AND archived_at IS NULL
RETURNING id, workspace_id, team_id, name, description, title, body, properties,
          position, created_by, archived_at, created_at, updated_at,
          email_intake_enabled, email_intake_token, email_intake_address;

-- UnarchiveIssueTemplate returns the row for the reason UnarchiveLabel does: the archive
-- reached every client as a delete, so only a payload can put it back.
--
-- name: UnarchiveIssueTemplate :one
UPDATE issue_template SET archived_at = NULL
WHERE id = $1 AND archived_at IS NOT NULL
RETURNING id, workspace_id, team_id, name, description, title, body, properties,
          position, created_by, archived_at, created_at, updated_at,
          email_intake_enabled, email_intake_token, email_intake_address;

-- name: GetIssueTemplatePositionAfter :one
SELECT position FROM issue_template
WHERE workspace_id = sqlc.arg(workspace_id)
  AND position > sqlc.arg(position)
  AND archived_at IS NULL
ORDER BY position
LIMIT 1;

-- name: GetLastIssueTemplatePosition :one
SELECT position FROM issue_template
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY position DESC
LIMIT 1;

-- CountIssuesFromTemplate is the only reason issue.template_id exists.
--
-- name: CountIssuesFromTemplate :one
SELECT count(*) FROM issue
WHERE template_id = $1 AND deleted_at IS NULL;

-- UpdateIssueTemplateEmailIntake is the per-template intake address. Team templates
-- only: a workspace template has no team to file into.
--
-- name: UpdateIssueTemplateEmailIntake :one
UPDATE issue_template
SET email_intake_enabled = sqlc.arg(email_intake_enabled),
    email_intake_token   = COALESCE(sqlc.narg(email_intake_token), email_intake_token),
    email_intake_address = COALESCE(sqlc.narg(email_intake_address), email_intake_address)
WHERE id = sqlc.arg(id) AND archived_at IS NULL
RETURNING id, workspace_id, team_id, name, description, title, body, properties,
          position, created_by, archived_at, created_at, updated_at,
          email_intake_enabled, email_intake_token, email_intake_address;

-- name: GetIssueTemplateByEmailIntakeToken :one
SELECT id, workspace_id, team_id, name, description, title, body, properties,
       position, created_by, archived_at, created_at, updated_at,
          email_intake_enabled, email_intake_token, email_intake_address
FROM issue_template
WHERE email_intake_token = sqlc.arg(token)
  AND email_intake_enabled
  AND archived_at IS NULL;
