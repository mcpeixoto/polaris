package domain

import (
	"context"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	// The filter's relative tokens name calendar days in a team's or a person's zone. A
	// machine without a zoneinfo database would silently fall back to UTC and move every
	// "due today" by up to a day, which is a missed deadline rather than a rounding error —
	// and self-hosted installs run in scratch containers that have no /usr/share/zoneinfo.
	_ "time/tzdata"

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
//
// The other half of a search is the filter, and it is the same filter a saved view holds —
// same AST, same grammar, same compiler. That is M1 acceptance test 2 and the reason the
// grammar has one implementation per language rather than one per surface. It is compiled to
// a WHERE fragment here and appended to all three statements, so a search and a view with
// identical filters return identical ids. It was validated and thrown away for a while, which
// is the worst possible version of that: `filter.Compile` had no production caller anywhere,
// an integration with no local replica to narrow got a wider answer than it asked for, and
// nothing said so.

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
	// Filter is the same AST saved views use, compiled by the same compiler and applied to
	// this query, so a search and a view with identical filters return identical ids. That
	// is M1 acceptance test 2, and it is the reason there is one grammar.
	//
	// It was validated and then discarded for a while, which is the worst version of this
	// field: an integration holding no local replica passed a filter, got a wider answer
	// than it asked for, and nothing anywhere said so.
	Filter []byte
	// TeamID narrows within what the caller can already see. It is not a permission.
	TeamID *uuid.UUID
	First  int
	// IncludeArchived widens the text search to archived issues.
	//
	// It does not survive a filter that says nothing about archiving. The grammar excludes
	// archived and deleted issues unless a clause names them — that default is part of what
	// a filter means and the client's evaluator applies the same one — so the two are ANDed
	// and the stricter wins. To search archived issues with a filter, say so in the filter.
	// Anything else would make the same filter mean one thing here and another in the view
	// it was copied from.
	IncludeArchived bool
}

type SearchResults struct {
	Issues   []model.Issue
	Comments []model.Comment
	// IssueCount is the total before the limit, so the UI can say "showing 25 of 400".
	IssueCount int
}

func (s *Service) Search(ctx context.Context, p *authz.Principal, in SearchInput) (SearchResults, error) {
	identKey, identNumber, identErr := ParseIssueIdentifier(strings.TrimSpace(in.Query))
	query := buildTSQuery(in.Query)
	if identErr != nil && query == "" {
		// Not an error. An empty search box is a normal state, and a product that shouts
		// at you for it is one you learn to approach carefully.
		return SearchResults{Issues: []model.Issue{}, Comments: []model.Comment{}}, nil
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
		if identErr == nil {
			issue, err := s.pinnedSearchIssue(ctx, q, p, in, identKey, identNumber)
			if err != nil {
				return err
			}
			if issue != nil {
				out.Issues = []model.Issue{*issue}
				out.IssueCount = 1
			} else {
				out.Issues = []model.Issue{}
			}
			out.Comments = []model.Comment{}
			return nil
		}

		// The filter is compiled inside the transaction because resolving it needs a read —
		// the timezone "today" is measured in — and that read has to see the same snapshot
		// as the search it qualifies.
		predicate, err := s.compileSearchFilter(ctx, q, p, in)
		if err != nil {
			return err
		}

		params := store.SearchParams{
			WorkspaceID:     p.WorkspaceID,
			TeamIds:         teams,
			FilterTeamID:    in.TeamID,
			IncludeArchived: in.IncludeArchived,
			Query:           query,
			PageSize:        int32(limit),
		}

		issues, err := q.SearchIssues(ctx, params, predicate)
		if err != nil {
			return platform.Internal(err)
		}

		total, err := q.CountIssueSearchMatches(ctx, params, predicate)
		if err != nil {
			return platform.Internal(err)
		}

		comments, err := q.SearchComments(ctx, params, predicate)
		if err != nil {
			return platform.Internal(err)
		}

		keys, err := teamKeys(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}

		out.Issues = make([]model.Issue, 0, len(issues))
		for _, row := range issues {
			out.Issues = append(out.Issues, toIssue(store.IssueTableRow(row), keys[row.TeamID]))
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

// pinnedSearchIssue resolves ENG-123 / eng123 to one visible issue, or nil.
//
// Unknown, private, deleted, and (unless asked) archived identifiers all answer as
// nothing — the same not-found shape as reading an issue by id you cannot see.
func (s *Service) pinnedSearchIssue(
	ctx context.Context, q *store.Queries, p *authz.Principal, in SearchInput, key string, number int64,
) (*model.Issue, error) {
	team, err := q.GetTeamByKey(ctx, store.GetTeamByKeyParams{WorkspaceID: p.WorkspaceID, Key: key})
	if err != nil {
		if store.IsNotFound(err) {
			return nil, nil
		}
		return nil, platform.Internal(err)
	}
	if in.TeamID != nil && team.ID != *in.TeamID {
		return nil, nil
	}
	if !p.Teams.Has(team.ID) {
		return nil, nil
	}
	row, err := q.GetIssueByTeamAndNumber(ctx, store.GetIssueByTeamAndNumberParams{
		TeamID: team.ID, Number: number,
	})
	if err != nil {
		if store.IsNotFound(err) {
			return nil, nil
		}
		return nil, platform.Internal(err)
	}
	if row.ArchivedAt != nil && !in.IncludeArchived {
		return nil, nil
	}
	issue := toIssue(store.AsIssueRow(row), team.Key)
	return &issue, nil
}

// compileSearchFilter turns the request's filter AST into the WHERE fragment the search
// statements append, or the zero value when there is no filter.
//
// Three things it settles, and each one is a way the same filter could otherwise mean
// different things on the server and in the client that saved it:
//
//   - The clock is read once, here, and both the issue search and the comment search are
//     compiled against it. A query that asked the clock twice could straddle midnight and
//     return a list and a count that satisfy neither answer.
//   - The location is the team's when the search is narrowed to one, and the caller's own
//     otherwise. That mirrors the client exactly — see the scope resolution in
//     web/src/views/IssueList.tsx, which uses the team's timezone for a team view and the
//     browser's for everything else — and it is the difference between "due today" meaning
//     the same day for everybody reading one board and rolling over when a machine in
//     another country says so. There is no workspace-level timezone column to prefer.
//   - ArgOffset is store.FixedSearchArgs, so the fragment's placeholders continue the
//     numbering the statements have already used rather than colliding with it.
func (s *Service) compileSearchFilter(
	ctx context.Context, q *store.Queries, p *authz.Principal, in SearchInput,
) (store.SearchFilter, error) {
	if len(in.Filter) == 0 {
		return store.SearchFilter{}, nil
	}

	node, err := filter.Parse(in.Filter)
	if err != nil {
		// A filter the compiler would reject fails at the boundary, with the compiler's own
		// message: the only thing the caller can do about it is send a different filter.
		return store.SearchFilter{}, platform.Validation("filter", err.Error())
	}

	loc, err := s.searchLocation(ctx, q, p, in.TeamID)
	if err != nil {
		return store.SearchFilter{}, err
	}

	compiled, err := filter.Compile(node, filter.Options{
		// The statements name the issue table `i`, and a fragment compiled for the default
		// `issue` alias would produce SQL referring to a table that is not in the query.
		Alias:     "i",
		Now:       s.now(),
		Location:  loc,
		ArgOffset: store.FixedSearchArgs,
	})
	if err != nil {
		return store.SearchFilter{}, platform.Validation("filter", err.Error())
	}
	return store.SearchFilter{SQL: compiled.SQL, Args: compiled.Args}, nil
}

// searchLocation is the zone this search's calendar days are measured in.
//
// A bad zone name is not an error the caller can fix and not a reason to refuse a search, so
// it falls back to UTC and says so in the log. The alternative — failing — would make one
// person's mistyped profile timezone break their search box.
func (s *Service) searchLocation(
	ctx context.Context, q *store.Queries, p *authz.Principal, teamID *uuid.UUID,
) (*time.Location, error) {
	name := ""
	if teamID != nil {
		team, err := q.GetTeam(ctx, *teamID)
		if err != nil {
			if store.IsNotFound(err) {
				// Narrowing to a team that is not there is already answered as an empty
				// result set by the caller; there is nothing to resolve against.
				return time.UTC, nil
			}
			return nil, platform.Internal(err)
		}
		name = team.Timezone
	} else {
		user, err := q.GetUser(ctx, p.UserID)
		if err != nil {
			return nil, platform.Internal(err)
		}
		name = user.Timezone
	}

	if name == "" {
		return time.UTC, nil
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		platform.Log(ctx).Warn("unusable timezone; measuring the filter's days in UTC",
			"timezone", name, "error", err)
		return time.UTC, nil
	}
	return loc, nil
}

/*
buildTSQuery turns what a person typed into a tsquery expression.

Rules, each because of something to_tsquery does with raw input:

  - Only letters and digits survive, except quotes which mark a phrase. Everything else
    is a separator, which means the tsquery operators (&, |, !, :, parentheses) cannot
    reach the parser at all. Escaping them instead would work until somebody found the
    combination that did not.
  - Unquoted tokens are joined with AND. "login redirect" means both words.
  - Quoted spans are phrases (`<->`): `"login redirect"` means those words in order,
    next to each other, which is what the quotes asked for.
  - Unquoted English glue ("the", "a", "of", …) is dropped so "the login" is a search
    for login. If every token was glue, the tokens are kept — searching "the" should
    still find titles that say it.
  - The last token gets `:*`. That is what makes search find the issue you half-remember
    the title of while you are still typing it — and it is only the last one, because a
    prefix match on every token matches far too much to rank usefully. A finished quoted
    phrase does not get it: the closing quote says the words are complete.

Unicode letters are kept, not stripped to ASCII: "Ação" is one token, and the folding that
makes it match "acao" happens in SQL, with the same function the index was built with.
*/
func buildTSQuery(raw string) string {
	parts := tokenizeSearch(raw)
	if len(parts) == 0 {
		return ""
	}
	n := 0
	for _, part := range parts {
		n += len(part.words)
	}
	if n > maxSearchTokens {
		parts = trimSearchParts(parts, maxSearchTokens)
	}

	trailing, _ := utf8.DecodeLastRuneInString(raw)
	prefix := unicode.IsLetter(trailing) || unicode.IsDigit(trailing)

	var chunks []string
	for i, part := range parts {
		words := append([]string(nil), part.words...)
		if prefix && i == len(parts)-1 && len(words) > 0 {
			words[len(words)-1] += ":*"
		}
		if part.phrase && len(words) > 1 {
			chunks = append(chunks, strings.Join(words, " <-> "))
			continue
		}
		chunks = append(chunks, words...)
	}
	return strings.Join(chunks, " & ")
}

type searchPart struct {
	words  []string
	phrase bool
}

// searchStopWords are unquoted English glue. Restated in web/src/features/search/search.ts.
var searchStopWords = map[string]struct{}{
	"a": {}, "an": {}, "the": {}, "of": {}, "to": {}, "in": {}, "for": {},
	"and": {}, "or": {}, "on": {}, "is": {}, "at": {}, "by": {}, "as": {},
	"it": {}, "be": {}, "this": {}, "that": {},
}

func tokenizeSearch(raw string) []searchPart {
	var parts []searchPart
	var loose []string
	flushLoose := func() {
		for _, word := range loose {
			parts = append(parts, searchPart{words: []string{word}})
		}
		loose = nil
	}

	i := 0
	for i < len(raw) {
		r, size := utf8.DecodeRuneInString(raw[i:])
		if r == '"' {
			flushLoose()
			i += size
			start := i
			closed := false
			for i < len(raw) {
				q, qSize := utf8.DecodeRuneInString(raw[i:])
				if q == '"' {
					closed = true
					break
				}
				i += qSize
			}
			words := wordTokens(raw[start:i])
			if closed {
				i += utf8.RuneLen('"')
			}
			if len(words) > 0 {
				parts = append(parts, searchPart{words: words, phrase: true})
			}
			continue
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			start := i
			i += size
			for i < len(raw) {
				n, nSize := utf8.DecodeRuneInString(raw[i:])
				if !unicode.IsLetter(n) && !unicode.IsDigit(n) {
					break
				}
				i += nSize
			}
			loose = append(loose, raw[start:i])
			continue
		}
		i += size
	}
	flushLoose()
	return dropLooseStops(parts)
}

func dropLooseStops(parts []searchPart) []searchPart {
	hasContent := false
	for _, part := range parts {
		if part.phrase {
			hasContent = true
			continue
		}
		if len(part.words) == 0 {
			continue
		}
		if _, stop := searchStopWords[strings.ToLower(part.words[0])]; !stop {
			hasContent = true
		}
	}
	if !hasContent {
		return parts
	}
	out := make([]searchPart, 0, len(parts))
	for _, part := range parts {
		if part.phrase {
			out = append(out, part)
			continue
		}
		if _, stop := searchStopWords[strings.ToLower(part.words[0])]; stop {
			continue
		}
		out = append(out, part)
	}
	return out
}

func wordTokens(raw string) []string {
	return strings.FieldsFunc(raw, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
}

func trimSearchParts(parts []searchPart, max int) []searchPart {
	var out []searchPart
	n := 0
	for _, part := range parts {
		if n >= max {
			break
		}
		remain := max - n
		if len(part.words) <= remain {
			out = append(out, part)
			n += len(part.words)
			continue
		}
		out = append(out, searchPart{words: part.words[:remain], phrase: part.phrase})
		break
	}
	return out
}
