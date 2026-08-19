-- name: GetGitHubTeamAutomation :one
SELECT team_id, workspace_id,
       drafted_state_id, opened_state_id, review_requested_state_id,
       ready_for_merge_state_id, merged_state_id,
       created_at, updated_at
FROM github_team_automation
WHERE workspace_id = sqlc.arg(workspace_id) AND team_id = sqlc.arg(team_id);

-- name: UpsertGitHubTeamAutomation :one
INSERT INTO github_team_automation (
  team_id, workspace_id,
  drafted_state_id, opened_state_id, review_requested_state_id,
  ready_for_merge_state_id, merged_state_id
) VALUES (
  sqlc.arg(team_id), sqlc.arg(workspace_id),
  sqlc.narg(drafted_state_id), sqlc.narg(opened_state_id), sqlc.narg(review_requested_state_id),
  sqlc.narg(ready_for_merge_state_id), sqlc.narg(merged_state_id)
)
ON CONFLICT (team_id) DO UPDATE SET
  drafted_state_id = EXCLUDED.drafted_state_id,
  opened_state_id = EXCLUDED.opened_state_id,
  review_requested_state_id = EXCLUDED.review_requested_state_id,
  ready_for_merge_state_id = EXCLUDED.ready_for_merge_state_id,
  merged_state_id = EXCLUDED.merged_state_id
RETURNING team_id, workspace_id,
          drafted_state_id, opened_state_id, review_requested_state_id,
          ready_for_merge_state_id, merged_state_id,
          created_at, updated_at;

-- name: DeleteGitHubTeamAutomation :exec
DELETE FROM github_team_automation
WHERE workspace_id = sqlc.arg(workspace_id) AND team_id = sqlc.arg(team_id);
