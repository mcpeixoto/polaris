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
          estimate_scale, estimate_allow_zero, estimate_extended,
          cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
          cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
       triage_enabled, triage_require_priority,
       auto_close_days, auto_archive_days, auto_close_parent, auto_close_children;

-- name: GetTeam :one
SELECT id, workspace_id, key, name, description, icon, color, timezone,
       parent_team_id, private, issue_counter, settings,
       retired_at, archived_at, deleted_at, created_at, updated_at,
       estimate_scale, estimate_allow_zero, estimate_extended,
       cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
       cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
       triage_enabled, triage_require_priority,
       auto_close_days, auto_archive_days, auto_close_parent, auto_close_children
FROM team
WHERE id = $1 AND deleted_at IS NULL;

-- name: GetTeamByKey :one
SELECT id, workspace_id, key, name, description, icon, color, timezone,
       parent_team_id, private, issue_counter, settings,
       retired_at, archived_at, deleted_at, created_at, updated_at,
       estimate_scale, estimate_allow_zero, estimate_extended,
       cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
       cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
       triage_enabled, triage_require_priority,
       auto_close_days, auto_archive_days, auto_close_parent, auto_close_children
FROM team
WHERE workspace_id = sqlc.arg(workspace_id) AND key = sqlc.arg(key) AND deleted_at IS NULL;

-- name: ListTeamsInWorkspace :many
SELECT id, workspace_id, key, name, description, icon, color, timezone,
       parent_team_id, private, issue_counter, settings,
       retired_at, archived_at, deleted_at, created_at, updated_at,
       estimate_scale, estimate_allow_zero, estimate_extended,
       cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
       cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
       triage_enabled, triage_require_priority,
       auto_close_days, auto_archive_days, auto_close_parent, auto_close_children
FROM team
WHERE workspace_id = $1 AND deleted_at IS NULL
ORDER BY key;

-- CountTeamsInWorkspace is the number a plan's team limit is measured against.
--
-- Archived teams do not count, mirroring the seat rule in CountWorkspaceSeats: suspending
-- somebody is how an admin frees a seat, and archiving a team is how they free a team slot.
-- Without that there is no way back under a limit except deleting work.
--
-- Retired teams DO count. A retired team is closed to new issues and still holds its old
-- ones, still appears in search and still resolves its identifiers — it is present, so it
-- occupies a slot, and a limit that ignored it would let a workspace on a two-team plan
-- accumulate an unbounded number of readable teams.
--
-- name: CountTeamsInWorkspace :one
SELECT count(*) FROM team
WHERE workspace_id = $1 AND archived_at IS NULL AND deleted_at IS NULL;

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
          estimate_scale, estimate_allow_zero, estimate_extended,
          cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
          cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
       triage_enabled, triage_require_priority,
       auto_close_days, auto_archive_days, auto_close_parent, auto_close_children;

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
          estimate_scale, estimate_allow_zero, estimate_extended,
          cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
          cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
       triage_enabled, triage_require_priority,
       auto_close_days, auto_archive_days, auto_close_parent, auto_close_children;

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

-- name: SoftDeleteTeam :one
UPDATE team SET deleted_at = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING id, workspace_id, key, name, description, icon, color, timezone,
          parent_team_id, private, issue_counter, settings,
          retired_at, archived_at, deleted_at, created_at, updated_at,
          estimate_scale, estimate_allow_zero, estimate_extended,
          cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
          cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
          triage_enabled, triage_require_priority,
          auto_close_days, auto_archive_days, auto_close_parent, auto_close_children;

-- name: RetireTeam :one
UPDATE team
SET retired_at = now()
WHERE id = sqlc.arg(id) AND deleted_at IS NULL AND retired_at IS NULL
RETURNING id, workspace_id, key, name, description, icon, color, timezone,
          parent_team_id, private, issue_counter, settings,
          retired_at, archived_at, deleted_at, created_at, updated_at,
          estimate_scale, estimate_allow_zero, estimate_extended,
          cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
          cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
          triage_enabled, triage_require_priority,
          auto_close_days, auto_archive_days, auto_close_parent, auto_close_children;

-- name: UnretireTeam :one
UPDATE team
SET retired_at = NULL
WHERE id = sqlc.arg(id) AND deleted_at IS NULL AND retired_at IS NOT NULL
RETURNING id, workspace_id, key, name, description, icon, color, timezone,
          parent_team_id, private, issue_counter, settings,
          retired_at, archived_at, deleted_at, created_at, updated_at,
          estimate_scale, estimate_allow_zero, estimate_extended,
          cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
          cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
          triage_enabled, triage_require_priority,
          auto_close_days, auto_archive_days, auto_close_parent, auto_close_children;

-- name: RestoreTeam :one
UPDATE team
SET deleted_at = NULL, retired_at = NULL
WHERE id = sqlc.arg(id)
  AND deleted_at IS NOT NULL
  AND deleted_at >= sqlc.arg(deleted_after)
RETURNING id, workspace_id, key, name, description, icon, color, timezone,
          parent_team_id, private, issue_counter, settings,
          retired_at, archived_at, deleted_at, created_at, updated_at,
          estimate_scale, estimate_allow_zero, estimate_extended,
          cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
          cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
          triage_enabled, triage_require_priority,
          auto_close_days, auto_archive_days, auto_close_parent, auto_close_children;

-- name: ListDeletedTeams :many
SELECT id, workspace_id, key, name, description, icon, color, timezone,
       parent_team_id, private, issue_counter, settings,
       retired_at, archived_at, deleted_at, created_at, updated_at,
       estimate_scale, estimate_allow_zero, estimate_extended,
       cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
       cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
       triage_enabled, triage_require_priority,
       auto_close_days, auto_archive_days, auto_close_parent, auto_close_children
FROM team
WHERE workspace_id = sqlc.arg(workspace_id)
  AND deleted_at IS NOT NULL
  AND deleted_at >= sqlc.arg(deleted_after)
ORDER BY deleted_at DESC;

-- name: CountChildTeams :one
SELECT count(*) FROM team
WHERE parent_team_id = sqlc.arg(team_id) AND deleted_at IS NULL;

-- name: ListChildTeams :many
SELECT id, workspace_id, key, name, description, icon, color, timezone,
       parent_team_id, private, issue_counter, settings,
       retired_at, archived_at, deleted_at, created_at, updated_at,
       estimate_scale, estimate_allow_zero, estimate_extended,
       cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
       cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
       triage_enabled, triage_require_priority,
       auto_close_days, auto_archive_days, auto_close_parent, auto_close_children
FROM team
WHERE parent_team_id = sqlc.arg(parent_team_id) AND deleted_at IS NULL
ORDER BY key;

-- name: UpdateTeamParent :one
UPDATE team
SET parent_team_id = sqlc.narg(parent_team_id),
    private        = COALESCE(sqlc.narg(private), private)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, key, name, description, icon, color, timezone,
          parent_team_id, private, issue_counter, settings,
          retired_at, archived_at, deleted_at, created_at, updated_at,
          estimate_scale, estimate_allow_zero, estimate_extended,
          cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
          cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
          triage_enabled, triage_require_priority,
          auto_close_days, auto_archive_days, auto_close_parent, auto_close_children;

-- name: SetTeamsPrivate :execrows
UPDATE team
SET private = true
WHERE id = ANY(sqlc.arg(ids)::uuid[]) AND deleted_at IS NULL AND NOT private;

-- SoftDeleteIssuesInTeam runs when a team is deleted so its issues can be restored together.
--
-- name: SoftDeleteIssuesInTeam :execrows
UPDATE issue
SET deleted_at = now(), deleted_by = sqlc.narg(deleted_by)
WHERE team_id = sqlc.arg(team_id) AND deleted_at IS NULL;

-- name: RestoreIssuesInTeam :execrows
UPDATE issue
SET deleted_at = NULL, deleted_by = NULL
WHERE team_id = sqlc.arg(team_id)
  AND deleted_at IS NOT NULL
  AND deleted_at >= sqlc.arg(deleted_after);

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

-- ListTeamMembershipsForTeams is ListTeamMembers for a page of teams: what Team.members
-- resolves from, for every team in one answer rather than one query per team.
--
-- team_ids is the reader's own visible set and never the set of teams they asked about.
-- The bootstrap ships exactly the memberships of the teams the reader belongs to, so a
-- listing here that reached further would let the API answer a question the sync stream
-- refuses — who is in a team you are not in — which is the leak the visibility predicate
-- exists to prevent. Enforced in the statement rather than filtered afterwards in Go, like
-- every other batched read, so the rows never leave the database in the first place.
--
-- name: ListTeamMembershipsForTeams :many
SELECT id, workspace_id, team_id, user_id, role, created_at, updated_at
FROM team_membership
WHERE workspace_id = sqlc.arg(workspace_id)
  AND team_id = ANY(sqlc.arg(team_ids)::uuid[])
ORDER BY team_id, created_at;

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

-- UpdateTeamCycles is the cadence, kept apart from UpdateTeam for the same reason
-- estimates are: enabling, duration, cooldown, start day and upcoming count are one
-- decision, and a partial write that turns cycles on without a duration would leave a
-- team in a state the CHECKs allow and the product does not.

-- name: UpdateTeamCycles :one
UPDATE team
SET cycles_enabled            = COALESCE(sqlc.narg(cycles_enabled), cycles_enabled),
    cycle_duration_weeks      = COALESCE(sqlc.narg(cycle_duration_weeks), cycle_duration_weeks),
    cycle_cooldown_weeks      = COALESCE(sqlc.narg(cycle_cooldown_weeks), cycle_cooldown_weeks),
    cycle_start_day           = COALESCE(sqlc.narg(cycle_start_day), cycle_start_day),
    cycle_upcoming_count      = COALESCE(sqlc.narg(cycle_upcoming_count), cycle_upcoming_count),
    cycle_auto_add_started    = COALESCE(sqlc.narg(cycle_auto_add_started), cycle_auto_add_started),
    cycle_auto_add_completed  = COALESCE(sqlc.narg(cycle_auto_add_completed), cycle_auto_add_completed)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, key, name, description, icon, color, timezone,
          parent_team_id, private, issue_counter, settings,
          retired_at, archived_at, deleted_at, created_at, updated_at,
          estimate_scale, estimate_allow_zero, estimate_extended,
          cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
          cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
       triage_enabled, triage_require_priority,
       auto_close_days, auto_archive_days, auto_close_parent, auto_close_children;

-- name: ListTeamsWithCyclesEnabled :many
SELECT id, workspace_id, key, name, description, icon, color, timezone,
       parent_team_id, private, issue_counter, settings,
       retired_at, archived_at, deleted_at, created_at, updated_at,
       estimate_scale, estimate_allow_zero, estimate_extended,
       cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
       cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
       triage_enabled, triage_require_priority,
       auto_close_days, auto_archive_days, auto_close_parent, auto_close_children
FROM team
WHERE cycles_enabled AND deleted_at IS NULL AND archived_at IS NULL AND retired_at IS NULL
ORDER BY workspace_id, key;

-- UpdateTeamTriage is the intake switch, kept apart from UpdateTeam for the same reason
-- estimates and cycles are: enabling creates the reserved statuses, and a partial write
-- that flipped the flag without them would leave a team that claims to have a queue and
-- has nowhere to put it.
--
-- name: UpdateTeamTriage :one
UPDATE team
SET triage_enabled           = COALESCE(sqlc.narg(triage_enabled), triage_enabled),
    triage_require_priority  = COALESCE(sqlc.narg(triage_require_priority), triage_require_priority)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, key, name, description, icon, color, timezone,
          parent_team_id, private, issue_counter, settings,
          retired_at, archived_at, deleted_at, created_at, updated_at,
          estimate_scale, estimate_allow_zero, estimate_extended,
          cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
          cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
          triage_enabled, triage_require_priority,
       auto_close_days, auto_archive_days, auto_close_parent, auto_close_children;

-- UpdateTeamArchive is the close/archive periods and the parent/child automations.
-- Kept apart from UpdateTeam so a settings form that only touches intake cannot
-- accidentally rewrite the team's name.
--
-- name: UpdateTeamArchive :one
UPDATE team
SET auto_close_days      = COALESCE(sqlc.narg(auto_close_days), auto_close_days),
    auto_archive_days    = COALESCE(sqlc.narg(auto_archive_days), auto_archive_days),
    auto_close_parent    = COALESCE(sqlc.narg(auto_close_parent), auto_close_parent),
    auto_close_children  = COALESCE(sqlc.narg(auto_close_children), auto_close_children)
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING id, workspace_id, key, name, description, icon, color, timezone,
          parent_team_id, private, issue_counter, settings,
          retired_at, archived_at, deleted_at, created_at, updated_at,
          estimate_scale, estimate_allow_zero, estimate_extended,
          cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
          cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
          triage_enabled, triage_require_priority,
          auto_close_days, auto_archive_days, auto_close_parent, auto_close_children;

-- name: ListTeamsWithAutoClose :many
SELECT id, workspace_id, key, name, description, icon, color, timezone,
       parent_team_id, private, issue_counter, settings,
       retired_at, archived_at, deleted_at, created_at, updated_at,
       estimate_scale, estimate_allow_zero, estimate_extended,
       cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
       cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
       triage_enabled, triage_require_priority,
       auto_close_days, auto_archive_days, auto_close_parent, auto_close_children
FROM team
WHERE auto_close_days > 0 AND deleted_at IS NULL AND archived_at IS NULL AND retired_at IS NULL
ORDER BY workspace_id, key;

-- name: ListTeamsWithAutoArchive :many
SELECT id, workspace_id, key, name, description, icon, color, timezone,
       parent_team_id, private, issue_counter, settings,
       retired_at, archived_at, deleted_at, created_at, updated_at,
       estimate_scale, estimate_allow_zero, estimate_extended,
       cycles_enabled, cycle_duration_weeks, cycle_cooldown_weeks, cycle_start_day,
       cycle_upcoming_count, cycle_auto_add_started, cycle_auto_add_completed,
       triage_enabled, triage_require_priority,
       auto_close_days, auto_archive_days, auto_close_parent, auto_close_children
FROM team
WHERE auto_archive_days > 0 AND deleted_at IS NULL AND archived_at IS NULL AND retired_at IS NULL
ORDER BY workspace_id, key;

