package store

import (
	"context"
	"fmt"
	"strconv"

	"github.com/google/uuid"
)

// The three search statements, hand-written, because they are the only queries in the
// product that cannot be generated.
//
// Everything else here comes out of internal/store/queries via sqlc, and it should. These
// cannot: a search carries a filter, the filter grammar compiles to a WHERE fragment whose
// text depends on what the user wrote, and sqlc has no way to express a parameter that is
// SQL. So this file is the one place where a statement is assembled at runtime, and it is
// written to make that as boring as possible:
//
//   - The fragment is the only thing interpolated, it comes from internal/filter's compiler
//     and nowhere else, and that compiler emits placeholders for every value a user typed.
//     Nothing a caller can type reaches the text.
//   - The fragment's placeholders are numbered from fixedSearchArgs, which is why the
//     compiler takes an ArgOffset. The caller binds its own arguments first, appends the
//     fragment's, and the numbering lines up by construction rather than by counting.
//   - The limit's placeholder is computed rather than written, because it sits after a
//     variable number of the fragment's.
//
// Why not push the fragment down as a set of ids instead, and keep the queries generated:
// because the filter is applied to a workspace's whole issue table, and a saved view's
// default filter is the empty one that matches everything. On a hundred-thousand-issue
// workspace that is a hundred thousand uuids on the wire per search, to narrow a result set
// of twenty-five.
//
// The predicate text below must stay identical across the three. A count that disagrees with
// the list it labels is worse than no count, and a comment search that answers a wider
// question than the issue search beside it makes one search box behave like two.

// SearchFilter is a compiled filter fragment, or the zero value for "no filter".
//
// SQL is a WHERE fragment over the issue table under the alias `i`, already parenthesised by
// the compiler so it can be dropped in without the caller reasoning about precedence. Args
// are its bound values, numbered from FixedSearchArgs.
type SearchFilter struct {
	SQL  string
	Args []any
}

// FixedSearchArgs is how many placeholders every search statement binds before the filter's.
//
// Exported because it is what the caller passes as filter.Options.ArgOffset, and the two
// numbers being the same number is the whole mechanism. A literal 5 in the domain layer
// would be a number that has to be remembered when a parameter is added here.
const FixedSearchArgs = 5

// SearchParams are the arguments every search shares. Order matches the placeholders.
type SearchParams struct {
	WorkspaceID uuid.UUID
	// TeamIds is the caller's visible set, and is never optional: it is the whole access
	// check, applied in the statement rather than afterwards in Go.
	TeamIds []uuid.UUID
	// FilterTeamID is the user narrowing their own search within that set. A different
	// thing from TeamIds, and not a permission.
	FilterTeamID    *uuid.UUID
	IncludeArchived bool
	// Query is a tsquery expression, not what the user typed. Building it is the domain's
	// job — to_tsquery is a parser and raises a syntax error on raw input.
	Query    string
	PageSize int32
}

func (p SearchParams) args() []any {
	return []any{p.WorkspaceID, p.TeamIds, p.FilterTeamID, p.IncludeArchived, p.Query}
}

// issueColumns is the issue table's columns in the table's own order, minus search_vector,
// exactly as internal/store/queries/issues.sql spells them — the generated row type is
// Issue, so a column added to the table lands at the end here too or the scan below stops
// compiling.
const issueColumns = `i.id, i.workspace_id, i.team_id, i.number, i.title, i.description, i.state_id,
       i.assignee_id, i.creator_id, i.priority, i.sort_order,
       i.started_at, i.completed_at, i.canceled_at,
       i.archived_at, i.deleted_at, i.created_at, i.updated_at,
       i.estimate, i.due_date, i.due_date_source, i.parent_id, i.sub_issue_sort_order,
       i.template_id, i.deleted_by`

const commentColumns = `c.id, c.workspace_id, c.issue_id, c.parent_id, c.body, c.actor_type, c.actor_id,
       c.edited_at, c.resolved_at, c.resolved_by, c.archived_at, c.deleted_at,
       c.created_at, c.updated_at`

// issueMatch is the shared predicate.
//
// The vector is a function call rather than a stored column, and every reference to it must
// be spelled identically to the expression the GIN index was built on or the planner will
// not use the index — a sequential scan over the workspace, which is the difference between
// 8 ms and 800 ms. See migration 000017 for why it is a function at all.
//
// The dictionary is 'simple' for the same reason it is 'simple' in issue_search_vector: an
// English stemmer mangles exactly the domain terms a multilingual workspace searches for.
// search_fold wraps the query so that lowercasing and unaccenting have one definition — the
// one the index was built with — and it passes `&` and `:*` through untouched, so it can be
// applied to the whole expression rather than token by token.
const issueMatch = `i.workspace_id = $1
  AND i.team_id = ANY($2::uuid[])
  AND ($3::uuid IS NULL OR i.team_id = $3)
  AND ($4::boolean OR i.archived_at IS NULL)
  AND i.deleted_at IS NULL
  AND issue_search_vector(i.title, i.description) @@ to_tsquery('simple', search_fold($5::text))`

// issueRank rewards proximity, which is what separates an issue whose title is the phrase
// from one that mentions both words nine paragraphs apart. Recency breaks the ties, of which
// there are many because titles are short and the index weights them all 'A'.
const issueRank = `ts_rank_cd(issue_search_vector(i.title, i.description), to_tsquery('simple', search_fold($5::text))) DESC,
         i.updated_at DESC`

// and renders the filter as a clause to append, or nothing.
func (f SearchFilter) and() string {
	if f.SQL == "" {
		return ""
	}
	return "\n  AND " + f.SQL
}

// SearchIssues returns the ranked issues matching both the text and the filter.
func (q *Queries) SearchIssues(ctx context.Context, arg SearchParams, f SearchFilter) ([]Issue, error) {
	args := append(arg.args(), f.Args...)
	args = append(args, arg.PageSize)
	limit := "$" + strconv.Itoa(len(args))

	sql := fmt.Sprintf(`SELECT %s
FROM issue i
WHERE %s%s
ORDER BY %s
LIMIT %s`, issueColumns, issueMatch, f.and(), issueRank, limit)

	rows, err := q.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []Issue{}
	for rows.Next() {
		var i Issue
		if err := rows.Scan(
			&i.ID, &i.WorkspaceID, &i.TeamID, &i.Number, &i.Title, &i.Description, &i.StateID,
			&i.AssigneeID, &i.CreatorID, &i.Priority, &i.SortOrder,
			&i.StartedAt, &i.CompletedAt, &i.CanceledAt,
			&i.ArchivedAt, &i.DeletedAt, &i.CreatedAt, &i.UpdatedAt,
			&i.Estimate, &i.DueDate, &i.DueDateSource, &i.ParentID, &i.SubIssueSortOrder,
			&i.TemplateID, &i.DeletedBy,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}

// CountIssueSearchMatches is the total before the limit, so the UI can say "showing 25 of
// 400". Its predicate is literally the same string SearchIssues uses, which is the only way
// to keep the promise that the count describes the list.
func (q *Queries) CountIssueSearchMatches(ctx context.Context, arg SearchParams, f SearchFilter) (int64, error) {
	args := append(arg.args(), f.Args...)

	sql := fmt.Sprintf(`SELECT count(*) FROM issue i
WHERE %s%s`, issueMatch, f.and())

	var n int64
	if err := q.db.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

// SearchComments returns the comments matching the text, on issues matching the filter.
//
// Comments carry no team of their own, so visibility comes from the issue they hang off —
// which is also what stops a comment on an archived issue surfacing a thread the issue list
// has already hidden. The same join is what lets the filter apply here at all: the grammar
// is a language about issues, and a filter on a comment search can only mean "on an issue
// that matches". Applying it is the point rather than a liberty — somebody who narrowed a
// search to their own urgent work has not asked to be shown comments from everybody else's.
func (q *Queries) SearchComments(ctx context.Context, arg SearchParams, f SearchFilter) ([]Comment, error) {
	args := append(arg.args(), f.Args...)
	args = append(args, arg.PageSize)
	limit := "$" + strconv.Itoa(len(args))

	sql := fmt.Sprintf(`SELECT %s
FROM comment c
JOIN issue i ON i.id = c.issue_id
WHERE c.workspace_id = $1
  AND %s
  AND c.deleted_at IS NULL
  AND comment_search_vector(c.body) @@ to_tsquery('simple', search_fold($5::text))%s
ORDER BY ts_rank_cd(comment_search_vector(c.body), to_tsquery('simple', search_fold($5::text))) DESC,
         c.updated_at DESC
LIMIT %s`, commentColumns, commentIssueMatch, f.and(), limit)

	rows, err := q.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []Comment{}
	for rows.Next() {
		var c Comment
		if err := rows.Scan(
			&c.ID, &c.WorkspaceID, &c.IssueID, &c.ParentID, &c.Body, &c.ActorType, &c.ActorID,
			&c.EditedAt, &c.ResolvedAt, &c.ResolvedBy, &c.ArchivedAt, &c.DeletedAt,
			&c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, c)
	}
	return items, rows.Err()
}

// commentIssueMatch is issueMatch minus the issue's own text match: a comment hit is a hit
// on the comment's body, and requiring the issue to match the words as well would return
// only comments on issues that happen to say the same thing.
const commentIssueMatch = `i.team_id = ANY($2::uuid[])
  AND ($3::uuid IS NULL OR i.team_id = $3)
  AND ($4::boolean OR i.archived_at IS NULL)
  AND i.deleted_at IS NULL`
