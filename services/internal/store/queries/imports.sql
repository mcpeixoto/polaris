-- Imports from another tracker. See migrations/000096_import.up.sql for the tables.
--
-- api_key is selected by exactly one query, GetImportJobAPIKey. Every other read leaves it
-- out by naming its columns, so a job row that reaches GraphQL, a log line or a test failure
-- message cannot carry somebody's Linear credential along with it.

-- name: InsertImportJob :one
INSERT INTO import_job (id, workspace_id, source, created_by, api_key)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(source), sqlc.narg(created_by),
        sqlc.arg(api_key))
RETURNING id, workspace_id, source, status, created_by, progress, error,
          created_at, started_at, finished_at, updated_at;

-- ClaimQueuedImportJob takes the oldest queued job, the same way StartQueuedAgentRun takes a
-- conversation. SKIP LOCKED is what lets two workers poll the one queue without both
-- running the same import.
--
-- started_at keeps its first value on a resume: a job the sweep put back in the queue is
-- the same import continuing, not a new one starting.
--
-- name: ClaimQueuedImportJob :one
UPDATE import_job
SET status = 'running',
    started_at = coalesce(started_at, now()),
    updated_at = now()
WHERE id = (
  SELECT j.id FROM import_job j
  WHERE j.status = 'queued'
  ORDER BY j.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, workspace_id, source, status, created_by, progress, error,
          created_at, started_at, finished_at, updated_at;

-- name: GetImportJobAPIKey :one
SELECT api_key FROM import_job WHERE id = $1 AND status = 'running';

-- UpdateImportJobProgress also touches updated_at, which is the liveness signal the stale
-- sweep reads. A job that reports progress is a job that is still running.
--
-- name: UpdateImportJobProgress :exec
UPDATE import_job
SET progress = progress || jsonb_build_object(
      sqlc.arg(entity)::text,
      jsonb_build_object('done', sqlc.arg(done)::int, 'total', sqlc.arg(total)::int)
    ),
    updated_at = now()
WHERE id = sqlc.arg(id) AND status = 'running';

-- FinishImportJob ends a job either way and drops the key in the same statement. The table's
-- CHECK refuses a finished row that still holds one, so forgetting the second half here
-- would fail loudly rather than leave a credential behind.
--
-- name: FinishImportJob :exec
UPDATE import_job
SET status = sqlc.arg(status),
    error = sqlc.narg(error),
    api_key = NULL,
    finished_at = now(),
    updated_at = now()
WHERE id = sqlc.arg(id);

-- RequeueStaleImportJobs puts a running job that has stopped reporting back in the queue. A
-- worker that died mid-import leaves exactly that, and the import_link rows it wrote are
-- what let the next claim carry on rather than start over.
--
-- name: RequeueStaleImportJobs :execrows
UPDATE import_job
SET status = 'queued', updated_at = now()
WHERE status = 'running' AND updated_at < sqlc.arg(before);

-- name: GetImportJob :one
SELECT id, workspace_id, source, status, created_by, progress, error,
       created_at, started_at, finished_at, updated_at
FROM import_job
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id);

-- name: ListImportJobs :many
SELECT id, workspace_id, source, status, created_by, progress, error,
       created_at, started_at, finished_at, updated_at
FROM import_job
WHERE workspace_id = $1
ORDER BY created_at DESC
LIMIT 50;

-- name: GetImportLink :one
SELECT polaris_id FROM import_link
WHERE workspace_id = sqlc.arg(workspace_id)
  AND source = sqlc.arg(source)
  AND entity = sqlc.arg(entity)
  AND external_id = sqlc.arg(external_id);

-- Re-pointing on conflict rather than doing nothing: a link survives the entity it named
-- being deleted here, and the import that recreates it has to be the one the next run finds.
--
-- name: InsertImportLink :exec
INSERT INTO import_link (workspace_id, job_id, source, entity, external_id, polaris_id)
VALUES (sqlc.arg(workspace_id), sqlc.arg(job_id), sqlc.arg(source), sqlc.arg(entity),
        sqlc.arg(external_id), sqlc.arg(polaris_id))
ON CONFLICT (workspace_id, source, entity, external_id)
DO UPDATE SET polaris_id = EXCLUDED.polaris_id, job_id = EXCLUDED.job_id;

-- RaiseTeamIssueCounter moves the counter past numbers an import wrote explicitly, and never
-- backwards. Without it the next issue somebody files natively is allocated a number the
-- import already used, and the unique index refuses their create.
--
-- name: RaiseTeamIssueCounter :exec
UPDATE team SET issue_counter = GREATEST(issue_counter, sqlc.arg(number)::bigint)
WHERE id = sqlc.arg(id);

-- name: ListWorkspaceMemberEmails :many
SELECT u.id, lower(a.email)::text AS email
FROM "user" u
JOIN account a ON a.id = u.account_id
WHERE u.workspace_id = $1
  AND u.archived_at IS NULL
  AND u.status = 'active'
  AND u.kind = 'human';

-- name: FindProjectByName :one
SELECT id FROM project
WHERE workspace_id = sqlc.arg(workspace_id)
  AND lower(name) = lower(sqlc.arg(name)::text)
  AND deleted_at IS NULL
ORDER BY created_at
LIMIT 1;

-- IssueNumberTaken counts deleted issues too, because issue_team_number_key does: a number in
-- the trash is still a number the insert would collide with.
--
-- name: IssueNumberTaken :one
SELECT EXISTS (SELECT 1 FROM issue WHERE team_id = sqlc.arg(team_id) AND number = sqlc.arg(number));
