-- name: CreateTeam :one
INSERT INTO team (id, workspace_id, key, name, description, icon, color, timezone,
                  parent_team_id, private, settings,
                  estimate_scale, estimate_allow_zero, estimate_extended)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(key), sqlc.arg(name),
        sqlc.narg(description), sqlc.narg(icon), sqlc.narg(color), sqlc.arg(timezone),
        sqlc.narg(parent_team_id), sqlc.arg(private), sqlc.arg(settings),
        -- All three are NOT NULL, and estimate_scale carries a CHECK, so an absent caller
        -- has to resolve to something valid rather than to an empty string. 'none' hides
        -- the estimate control entirely, which is the right starting point: a team that
        -- has not chosen a scale has not chosen to estimate.
        COALESCE(sqlc.narg(estimate_scale)::text, 'none'),
        COALESCE(sqlc.narg(estimate_allow_zero)::boolean, false),
        COALESCE(sqlc.narg(estimate_extended)::boolean, false))
RETURNING id, workspace_id, key, name, description, icon, color, timezone,
          parent_team_id, private, issue_counter, settings,
          retired_at, archived_at, deleted_at, created_at, updated_at,
          estimate_scale, estimate_allow_zero, estimate_extended;

-- name: GetTeam :one
SELECT id, workspace_id, key, name, description, icon, color, timezone,
       parent_team_id, private, issue_counter, settings,
       retired_at, archived_at, deleted_at, created_at, updated_at,
       estimate_scale, estimate_allow_zero, estimate_extended
FROM team
WHERE id = $1 AND deleted_at IS NULL;

-- name: GetTeamByKey :one
SELECT id, workspace_id, key, name, description, icon, color, timezone,
       parent_team_id, private, issue_counter, settings,
       retired_at, archived_at, deleted_at, created_at, updated_at,
       estimate_scale, estimate_allow_zero, estimate_extended
FROM team
WHERE workspace_id = sqlc.arg(workspace_id) AND key = sqlc.arg(key) AND deleted_at IS NULL;

-- name: ListTeamsInWorkspace :many
SELECT id, workspace_id, key, name, description, icon, color, timezone,
       parent_team_id, private, issue_counter, settings,
       retired_at, archived_at, deleted_at, created_at, updated_at,
       estimate_scale, estimate_allow_zero, estimate_extended
FROM team
WHERE workspace_id = $1 AND deleted_at IS NULL
ORDER BY key;

-- name: UpdateTeam :one
UPDATE team
SET key         = COALESCE(sqlc.narg(key), key),
    name        = COALESCE(sqlc.narg(name), name),
    description = COALESCE(sqlc.narg(description), description),
    icon        = COALESCE(sqlc.narg(icon), icon),
    color       = COALESCE(sqlc.narg(color), color),
    timezone    = COALESCE(sqlc.narg(timezone), timezone),
    private     = COALESCE(sqlc.narg(private), private),
    settings    = COALESCE(sqlc.narg(settings), settings)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, key, name, description, icon, color, timezone,
          parent_team_id, private, issue_counter, settings,
          retired_at, archived_at, deleted_at, created_at, updated_at,
          estimate_scale, estimate_allow_zero, estimate_extended;

-- UpdateTeamEstimates is separate from UpdateTeam because the three settings are one
-- decision: allow_zero and extended only mean anything relative to a scale, and letting a
-- partial update change the scale without them would leave a team offering "16" on a
-- Fibonacci sequence. The mutation takes all three, so this sets all three.
--
-- name: UpdateTeamEstimates :one
UPDATE team
SET estimate_scale      = sqlc.arg(estimate_scale),
    estimate_allow_zero = sqlc.arg(estimate_allow_zero),
    estimate_extended   = sqlc.arg(estimate_extended)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, key, name, description, icon, color, timezone,
          parent_team_id, private, issue_counter, settings,
          retired_at, archived_at, deleted_at, created_at, updated_at,
          estimate_scale, estimate_allow_zero, estimate_extended;

-- AllocateIssueNumber takes a row lock on the team for the rest of the transaction.
--
-- Deliberately not a sequence: sequences are non-transactional, so a rolled-back issue
-- creation would burn a number and leave a permanent hole in a value that people read
-- aloud in standup. The lock is held for microseconds and only contends with other
-- creations in the same team.
--
-- name: AllocateIssueNumber :one
UPDATE team SET issue_counter = issue_counter + 1
WHERE id = $1
RETURNING issue_counter;

-- name: SoftDeleteTeam :exec
UPDATE team SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL;

-- name: AddTeamMember :one
INSERT INTO team_membership (id, workspace_id, team_id, user_id, role)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role
RETURNING id, workspace_id, team_id, user_id, role, created_at, updated_at;

-- name: RemoveTeamMember :execrows
DELETE FROM team_membership WHERE team_id = $1 AND user_id = $2;

-- name: ListTeamMembers :many
SELECT id, workspace_id, team_id, user_id, role, created_at, updated_at
FROM team_membership
WHERE team_id = $1
ORDER BY created_at;

-- ListTeamIDsForUser resolves a session's visibility set. Called on every socket connect
-- and on every permission change, so it must stay an index-only scan on
-- team_membership_user_idx.
--
-- name: ListTeamIDsForUser :many
SELECT team_id FROM team_membership WHERE user_id = $1;

-- name: ListMembershipsInWorkspace :many
SELECT id, workspace_id, team_id, user_id, role, created_at, updated_at
FROM team_membership
WHERE workspace_id = $1;

-- name: IsTeamMember :one
SELECT EXISTS (
  SELECT 1 FROM team_membership WHERE team_id = sqlc.arg(team_id) AND user_id = sqlc.arg(user_id)
);
