package domain

import (
	"context"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/filter"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Search over issues and comments.
//
// The interesting part of this file is not the query, it is what stands between what a
// person types and `to_tsquery`. That function is a parser, not a matcher: it raises a
// syntax error on `a &`, on `!`, on an unbalanced bracket, on a trailing space. A search
// box that returns a 500 because somebody paused mid-word is worse than one that returns
// nothing, and it is also an injection surface — tsquery operators in user input would
// otherwise let a caller write the query rather than fill it in.
//
// So the text is rebuilt rather than escaped. Tokens are extracted, everything that is not
// a letter or a digit is discarded, and the tokens are rejoined with the operator this
// product means. Nothing a user can type survives as syntax.

const (
	// defaultSearchLimit is what the command menu shows without scrolling.
	defaultSearchLimit = 25
	// maxSearchLimit bounds what any caller can ask for. Search runs a GIN scan and a rank
	// per row; an unbounded limit turns one careless API caller into a workspace-wide
	// slowdown, and nobody reads the four-hundredth result.
	maxSearchLimit = 100
	// maxSearchTokens bounds the tsquery's size. Each token is an AND, and a query with a
	// thousand of them is not a search — it is a way to make the planner do a thousand
	// index probes per row.
	maxSearchTokens = 12
)

type SearchInput struct {
	Query string
	// Filter is the same AST saved views use. Validated here and applied by the caller's
	// own compiler, so a search and a view with identical filters return identical ids.
	Filter []byte
	// TeamID narrows within what the caller can already see. It is not a permission.
	TeamID          *uuid.UUID
	First           int
	IncludeArchived bool
}

type SearchResults struct {
	Issues   []model.Issue
	Comments []model.Comment
	// IssueCount is the total before the limit, so the UI can say "showing 25 of 400".
	IssueCount int
}

func (s *Service) Search(ctx context.Context, p *authz.Principal, in SearchInput) (SearchResults, error) {
	query := buildTSQuery(in.Query)
	if query == "" {
		// Not an error. An empty search box is a normal state, and a product that shouts
		// at you for it is one you learn to approach carefully.
		return SearchResults{Issues: []model.Issue{}, Comments: []model.Comment{}}, nil
	}

	// Validated even though it is not compiled here, because a filter the compiler would
	// reject must fail at the boundary rather than deep inside a scan.
	if len(in.Filter) > 0 {
		if _, err := filter.Parse(in.Filter); err != nil {
			return SearchResults{}, platform.Validation("filter", err.Error())
		}
	}

	limit := in.First
	if limit <= 0 {
		limit = defaultSearchLimit
	}
	if limit > maxSearchLimit {
		limit = maxSearchLimit
	}

	// The caller's visible teams, and never anything else. This is the whole access check:
	// the query has no other notion of who is asking, which is deliberate — one predicate,
	// applied in one place, rather than a WHERE clause per call site.
	teams := p.Teams.IDs()
	if len(teams) == 0 {
		return SearchResults{Issues: []model.Issue{}, Comments: []model.Comment{}}, nil
	}
	if in.TeamID != nil && !p.Teams.Has(*in.TeamID) {
		// Narrowing to a team you cannot see returns nothing rather than an error. An
		// error would confirm the team exists.
		return SearchResults{Issues: []model.Issue{}, Comments: []model.Comment{}}, nil
	}

	var out SearchResults
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		issues, err := q.SearchIssues(ctx, store.SearchIssuesParams{
			WorkspaceID:     p.WorkspaceID,
			TeamIds:         teams,
			FilterTeamID:    in.TeamID,
			IncludeArchived: in.IncludeArchived,
			Query:           query,
			PageSize:        int32(limit),
		})
		if err != nil {
			return platform.Internal(err)
		}

		total, err := q.CountIssueSearchMatches(ctx, store.CountIssueSearchMatchesParams{
			WorkspaceID:     p.WorkspaceID,
			TeamIds:         teams,
			FilterTeamID:    in.TeamID,
			IncludeArchived: in.IncludeArchived,
			Query:           query,
		})
		if err != nil {
			return platform.Internal(err)
		}

		comments, err := q.SearchComments(ctx, store.SearchCommentsParams{
			WorkspaceID:     p.WorkspaceID,
			TeamIds:         teams,
			FilterTeamID:    in.TeamID,
			IncludeArchived: in.IncludeArchived,
			Query:           query,
			PageSize:        int32(limit),
		})
		if err != nil {
			return platform.Internal(err)
		}

		keys, err := teamKeys(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}

		out.Issues = make([]model.Issue, 0, len(issues))
		for _, row := range issues {
			out.Issues = append(out.Issues, toIssue(row, keys[row.TeamID]))
		}
		out.Comments = make([]model.Comment, 0, len(comments))
		for _, row := range comments {
			out.Comments = append(out.Comments, toComment(row))
		}
		out.IssueCount = int(total)
		return nil
	})
	return out, err
}

/*
buildTSQuery turns what a person typed into a tsquery expression.

Three rules, and each exists because of something to_tsquery does with raw input:

  - Only letters and digits survive. Everything else is a separator, which means the
    tsquery operators (&, |, !, :, parentheses) cannot reach the parser at all. Escaping
    them instead would work until somebody found the combination that did not.
  - Tokens are joined with AND. "login redirect" means both words, which is what people
    expect from a search box and is also the narrower, cheaper query.
  - The last token gets `:*`. That is what makes search find the issue you half-remember
    the title of while you are still typing it — and it is only the last one, because a
    prefix match on every token matches far too much to rank usefully.

Unicode letters are kept, not stripped to ASCII: "Ação" is one token, and the folding that
makes it match "acao" happens in SQL, with the same function the index was built with.
*/
func buildTSQuery(raw string) string {
	tokens := strings.FieldsFunc(raw, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	if len(tokens) == 0 {
		return ""
	}
	if len(tokens) > maxSearchTokens {
		tokens = tokens[:maxSearchTokens]
	}
	// Only the final token is a prefix, and only when the input did not end on a
	// separator: "login " is a finished word, "logi" is one being typed.
	//
	// DecodeLastRuneInString rather than raw[len(raw)-1], because that indexes a *byte*: a
	// query ending in "ç" would hand this a UTF-8 continuation byte, which is not a letter,
	// so every search in an accented language would silently lose its prefix match — and
	// only in that language, which is the kind of bug that gets reported as "search feels
	// worse in Portuguese".
	last := len(tokens) - 1
	trailing, _ := utf8.DecodeLastRuneInString(raw)
	if unicode.IsLetter(trailing) || unicode.IsDigit(trailing) {
		tokens[last] += ":*"
	}
	return strings.Join(tokens, " & ")
}
