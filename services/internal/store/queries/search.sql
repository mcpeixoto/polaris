-- Full-text search over issues and comments.
--
-- `query` is a tsquery *expression*, not what the user typed. Building it — splitting into
-- tokens, dropping the operators, and appending the `:*` on the final token that makes
-- prefix search work — is the domain's job, because to_tsquery raises a syntax error on raw
-- input like "a & " and a search box that 500s on a trailing space is worse than one that
-- returns nothing.
--
-- The FOLDING, though, is not the domain's job, and that is deliberate: search_fold wraps
-- the query here so that lowercasing and unaccenting have exactly one definition, the same
-- one the index was built with. Folding in Go instead would be a third implementation
-- beside the SQL and the TypeScript, and the failure mode of the three disagreeing is that
-- searching "acao" finds nothing while filtering title-contains-"acao" finds the issue.
-- search_fold passes `&` and `:*` through untouched, so it can be applied to the whole
-- expression rather than token by token.
--
-- The dictionary is 'simple' here for the same reason it is 'simple'
-- issue_search_vector: an English stemmer mangles exactly the domain terms a multilingual
-- workspace searches for.
--
-- The vector is a function call rather than a stored column, and every reference here must
-- spell it identically to the expression the GIN index was built on or the planner will not
-- use the index — a seq scan over the workspace, which is the difference between 8 ms and
-- 800 ms. See migration 000017 for why it is a function at all.
--
-- Ranking is ts_rank_cd then updated_at DESC. ts_rank_cd rewards proximity, which is what
-- separates an issue whose title is the phrase from one that mentions both words nine
-- paragraphs apart; recency breaks the ties, of which there are many because titles are
-- short and the index weights them all 'A'.
--
-- Visibility is two separate filters and they are not interchangeable. team_ids is the
-- caller's visible set and is never optional. filter_team_id is the user narrowing their
-- own search, and narrows within that set.

-- name: SearchIssues :many
SELECT i.id, i.workspace_id, i.team_id, i.number, i.title, i.description, i.state_id,
       i.assignee_id, i.creator_id, i.priority, i.sort_order,
       i.started_at, i.completed_at, i.canceled_at,
       i.archived_at, i.deleted_at, i.created_at, i.updated_at,
       i.estimate, i.due_date, i.due_date_source, i.parent_id, i.sub_issue_sort_order,
       i.template_id
FROM issue i
WHERE i.workspace_id = sqlc.arg(workspace_id)
  AND i.team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND (sqlc.narg(filter_team_id)::uuid IS NULL OR i.team_id = sqlc.narg(filter_team_id))
  AND (sqlc.arg(include_archived)::boolean OR i.archived_at IS NULL)
  AND i.deleted_at IS NULL
  AND issue_search_vector(i.title, i.description) @@ to_tsquery('simple', search_fold(sqlc.arg(query)::text))
ORDER BY ts_rank_cd(issue_search_vector(i.title, i.description), to_tsquery('simple', search_fold(sqlc.arg(query)::text))) DESC,
         i.updated_at DESC
LIMIT sqlc.arg(page_size);

-- CountIssueSearchMatches is the total before the limit, so the UI can say "showing 25 of
-- 400". Its predicate must stay identical to SearchIssues' — a count that disagrees with
-- the list it labels is worse than no count at all.
--
-- name: CountIssueSearchMatches :one
SELECT count(*) FROM issue i
WHERE i.workspace_id = sqlc.arg(workspace_id)
  AND i.team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND (sqlc.narg(filter_team_id)::uuid IS NULL OR i.team_id = sqlc.narg(filter_team_id))
  AND (sqlc.arg(include_archived)::boolean OR i.archived_at IS NULL)
  AND i.deleted_at IS NULL
  AND issue_search_vector(i.title, i.description) @@ to_tsquery('simple', search_fold(sqlc.arg(query)::text));

-- Comments carry no team of their own, so visibility comes from the issue they hang off —
-- which is also what stops a comment on an archived issue surfacing a thread the issue
-- list has already hidden.
--
-- name: SearchComments :many
SELECT c.id, c.workspace_id, c.issue_id, c.parent_id, c.body, c.actor_type, c.actor_id,
       c.edited_at, c.resolved_at, c.resolved_by, c.archived_at, c.deleted_at,
       c.created_at, c.updated_at
FROM comment c
JOIN issue i ON i.id = c.issue_id
WHERE c.workspace_id = sqlc.arg(workspace_id)
  AND i.team_id = ANY(sqlc.arg(team_ids)::uuid[])
  AND (sqlc.narg(filter_team_id)::uuid IS NULL OR i.team_id = sqlc.narg(filter_team_id))
  AND (sqlc.arg(include_archived)::boolean OR i.archived_at IS NULL)
  AND i.deleted_at IS NULL
  AND c.deleted_at IS NULL
  AND comment_search_vector(c.body) @@ to_tsquery('simple', search_fold(sqlc.arg(query)::text))
ORDER BY ts_rank_cd(comment_search_vector(c.body), to_tsquery('simple', search_fold(sqlc.arg(query)::text))) DESC,
         c.updated_at DESC
LIMIT sqlc.arg(page_size);
