package graph

import (
	"context"
	"fmt"
	"net/http"
	"sync"

	"github.com/99designs/gqlgen/graphql"
	"github.com/google/uuid"
	"github.com/vektah/gqlparser/v2/ast"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Per-request loaders, and the assembly of the nested fields that need them.
//
// An issue list is the query this product lives or dies by, and the naive shape of it is
// four extra queries per row — status, team, assignee, creator. At 250 issues that is a
// thousand round trips to render one screen, which is how a local-first product ends up
// feeling slower than the server-rendered tracker it replaced.
//
// The fix is that none of those four is per-issue data. A workspace has a handful of
// teams, one directory of people, and one workflow per team, so the whole list is served
// by three queries whatever its length: everybody, every team, and each team's statuses.
// Each is fetched at most once per request and remembered for the rest of it.
//
// No dataloader dependency: batching a fixed, tiny set of workspace-wide lists is a map
// and a sync.Once, and a generic loader library would add a background goroutine, a
// scheduling window and a debugging problem for no benefit at this size.

// batch is one memoised list. The sync.Once is what makes "at most once per request"
// true even though gqlgen resolves sibling fields concurrently — without it, two fields
// asking for the directory at the same moment issue two queries and the second one is
// pure waste.
type batch[T any] struct {
	once sync.Once
	val  T
	err  error
}

func (b *batch[T]) load(fn func() (T, error)) (T, error) {
	b.once.Do(func() { b.val, b.err = fn() })
	return b.val, b.err
}

type userIndex struct {
	all  []model.User
	byID map[uuid.UUID]model.User
}

type teamIndex struct {
	all  []model.Team
	byID map[uuid.UUID]model.Team
}

type stateIndex struct {
	all  []model.WorkflowState
	byID map[uuid.UUID]model.WorkflowState
}

// Loaders holds one request's memoised reads.
//
// Request-scoped and never shared between requests. Everything in here came back from a
// domain call that filtered it for one principal, so a cache that outlived the request
// would be a cache of one person's permissions being handed to the next caller.
type Loaders struct {
	svc *domain.Service

	users batch[userIndex]
	teams batch[teamIndex]

	// mu guards the states map only. The fetches themselves run outside it, so a slow
	// query for one team does not hold up another.
	mu     sync.Mutex
	states map[uuid.UUID]*batch[stateIndex]
}

type loadersKey struct{}

// LoaderMiddleware attaches a fresh set of loaders to every request, which is what widens
// their cache from one resolver call to the whole operation — the difference between a
// query that asks for issues and their assignees paying for the directory once or twice.
func LoaderMiddleware(svc *domain.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := context.WithValue(r.Context(), loadersKey{}, &Loaders{svc: svc})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// loaders returns the request's loaders, or a private set when the middleware is not
// installed — a Go caller, a test, a transport somebody has not wired yet.
//
// Correctness never depends on the wiring; only the width of the cache does. A resolver
// that assumed the middleware would silently produce the N+1 it exists to prevent, which
// is a performance regression nothing fails on.
func (r *Resolver) loaders(ctx context.Context) *Loaders {
	if l, ok := ctx.Value(loadersKey{}).(*Loaders); ok && l != nil {
		return l
	}
	return &Loaders{svc: r.Svc}
}

// allUsers reads the workspace directory once. ListUsers is the same call Query.users
// makes, so the viewer's own address and an admin's view of everybody's are decided in
// one place rather than twice.
func (l *Loaders) allUsers(ctx context.Context, p *authz.Principal) (userIndex, error) {
	return l.users.load(func() (userIndex, error) {
		users, err := l.svc.ListUsers(ctx, p)
		if err != nil {
			return userIndex{}, err
		}
		idx := userIndex{all: users, byID: make(map[uuid.UUID]model.User, len(users))}
		for _, u := range users {
			idx.byID[u.ID] = u
		}
		return idx, nil
	})
}

// allTeams reads the teams this principal can see, once. It is also how team-by-id and
// team-by-key are answered: the domain layer exposes the permission-filtered list and
// nothing narrower, which is the right shape — a lookup that could return a team the
// list would have hidden is the leak the visibility predicate exists to prevent.
func (l *Loaders) allTeams(ctx context.Context, p *authz.Principal) (teamIndex, error) {
	return l.teams.load(func() (teamIndex, error) {
		teams, err := l.svc.ListTeams(ctx, p)
		if err != nil {
			return teamIndex{}, err
		}
		idx := teamIndex{all: teams, byID: make(map[uuid.UUID]model.Team, len(teams))}
		for _, t := range teams {
			idx.byID[t.ID] = t
		}
		return idx, nil
	})
}

// statesFor reads one team's workflow, once per team per request. A status list is a
// handful of rows and every issue in the team shares it, so this is the query that turns
// "one status lookup per issue" into "one per team".
func (l *Loaders) statesFor(ctx context.Context, p *authz.Principal, teamID uuid.UUID) (stateIndex, error) {
	l.mu.Lock()
	if l.states == nil {
		l.states = make(map[uuid.UUID]*batch[stateIndex])
	}
	b, ok := l.states[teamID]
	if !ok {
		b = &batch[stateIndex]{}
		l.states[teamID] = b
	}
	l.mu.Unlock()

	return b.load(func() (stateIndex, error) {
		states, err := l.svc.ListWorkflowStates(ctx, p, teamID)
		if err != nil {
			return stateIndex{}, err
		}
		idx := stateIndex{all: states, byID: make(map[uuid.UUID]model.WorkflowState, len(states))}
		for _, s := range states {
			idx.byID[s.ID] = s
		}
		return idx, nil
	})
}

// --- what the query actually asked for ------------------------------------------

// referenceFields are the relations that cost a bounded number of queries no matter how
// long the list is, because they are all served from the three workspace-wide reads
// above. They are the ones a caller outside a GraphQL operation gets by default; the
// collections — comments, history, a team's issues — are one query per parent row and are
// fetched only when a query names them.
var referenceFields = map[string]bool{
	"state": true, "team": true, "assignee": true, "creator": true,
	"states": true, "teams": true, "users": true,
}

// selection is the part of the query below the field being resolved.
//
// Hydration has to consult it because the generated types carry their relations as plain
// struct fields: gqlgen reads Issue.State off the struct rather than calling back into a
// resolver, so whatever the resolver does not fill in cannot be fetched later, and
// whatever it fills in that nobody asked for is a query nobody wanted. Selecting
// `issues { title }` therefore costs exactly one query, and `issue { comments { body } }`
// costs the comments too.
type selection struct {
	// oc is nil when the resolver was called outside a GraphQL operation — from another
	// Go package, or from a test — in which case there is no query to consult.
	oc  *graphql.OperationContext
	set ast.SelectionSet
	// typeName is the object the selections apply to, so a fragment spread on it is
	// collected instead of skipped.
	typeName string
	// none marks a field the query did not select at all. Distinct from the zero value,
	// which means "no query to consult".
	none bool
}

var noSelection = selection{none: true}

// selectionFor returns the selection below the field currently being resolved.
func selectionFor(ctx context.Context, typeName string) selection {
	fc := graphql.GetFieldContext(ctx)
	if fc == nil || !graphql.HasOperationContext(ctx) {
		return selection{}
	}
	return selection{oc: graphql.GetOperationContext(ctx), set: fc.Field.Selections, typeName: typeName}
}

// child reports whether field was selected, and returns the selection below it.
func (s selection) child(field, typeName string) (selection, bool) {
	if s.none {
		return noSelection, false
	}
	if s.oc == nil {
		return selection{}, referenceFields[field]
	}

	var (
		found bool
		set   ast.SelectionSet
	)
	// Aliases mean the same field can appear more than once with different sub-selections;
	// the struct field they all marshal from is one value, so it has to satisfy the union
	// of them.
	for _, f := range graphql.CollectFields(s.oc, s.set, []string{s.typeName}) {
		if f.Name == field {
			found = true
			set = append(set, f.Selections...)
		}
	}
	if !found {
		return noSelection, false
	}
	return selection{oc: s.oc, set: set, typeName: typeName}, true
}

// childOrNone is child for a field that is filled in regardless of the query — a mutation
// payload's entity — where only the depth below it is in question.
//
// Outside an operation the payload's entity is not optional: it is the whole answer, and
// the caller gets the default depth rather than a shell.
func (s selection) childOrNone(field, typeName string) selection {
	if c, ok := s.child(field, typeName); ok {
		return c
	}
	if s.oc == nil && !s.none {
		return selection{}
	}
	return noSelection
}

func (s selection) has(field string) bool {
	_, ok := s.child(field, "")
	return ok
}

// --- assembling the nested fields -----------------------------------------------

func (r *Resolver) hydrateIssue(ctx context.Context, p *authz.Principal, sel selection, issue model.Issue) (generated.Issue, error) {
	out, err := r.hydrateIssues(ctx, p, sel, []model.Issue{issue})
	if err != nil {
		return generated.Issue{}, err
	}
	return out[0], nil
}

// hydrateIssues fills in the relations the query asked for, once for the whole list.
//
// Everything here is deduplicated before it is fetched: a list of 250 issues in one team
// with a dozen distinct assignees resolves to one directory read, one team read and one
// status read, and the nested Team and User values are shared pointers rather than a copy
// per row.
func (r *Resolver) hydrateIssues(ctx context.Context, p *authz.Principal, sel selection, issues []model.Issue) ([]generated.Issue, error) {
	out := make([]generated.Issue, 0, len(issues))
	for _, i := range issues {
		out = append(out, toIssue(i))
	}
	if len(out) == 0 {
		return out, nil
	}
	l := r.loaders(ctx)

	if sel.has("state") {
		for k, i := range issues {
			states, err := l.statesFor(ctx, p, i.TeamID)
			if err != nil {
				return nil, err
			}
			st, ok := states.byID[i.StateID]
			if !ok {
				// Every issue points at a live status: archiving one is refused while any
				// issue still sits in it. A miss here is a broken invariant, not a
				// nullable field, and saying so beats marshalling a null into a non-null.
				return nil, platform.Internal(fmt.Errorf("issue %s references status %s, which its team does not have", i.ID, i.StateID))
			}
			g, err := toWorkflowState(st)
			if err != nil {
				return nil, err
			}
			out[k].State = &g
		}
	}

	if child, ok := sel.child("team", "Team"); ok {
		teams, err := l.allTeams(ctx, p)
		if err != nil {
			return nil, err
		}
		hydrated := make(map[uuid.UUID]*generated.Team, len(teams.byID))
		for k, i := range issues {
			g, ok := hydrated[i.TeamID]
			if !ok {
				t, found := teams.byID[i.TeamID]
				if !found {
					return nil, platform.Internal(fmt.Errorf("issue %s is in team %s, which the reader cannot see", i.ID, i.TeamID))
				}
				team, err := r.hydrateTeam(ctx, p, child, t)
				if err != nil {
					return nil, err
				}
				g = &team
				hydrated[i.TeamID] = g
			}
			out[k].Team = g
		}
	}

	if sel.has("assignee") || sel.has("creator") {
		users, err := l.allUsers(ctx, p)
		if err != nil {
			return nil, err
		}
		hydrated := make(map[uuid.UUID]*generated.User, len(users.byID))
		pick := func(id *uuid.UUID) (*generated.User, error) {
			if id == nil {
				return nil, nil
			}
			if g, ok := hydrated[*id]; ok {
				return g, nil
			}
			u, ok := users.byID[*id]
			if !ok {
				// A deactivated or deleted account leaves the reference behind on purpose:
				// history that names somebody must not be rewritten when they leave.
				return nil, nil
			}
			g, err := toUser(u)
			if err != nil {
				return nil, err
			}
			hydrated[*id] = &g
			return &g, nil
		}

		for k, i := range issues {
			if sel.has("assignee") {
				if out[k].Assignee, err = pick(i.AssigneeID); err != nil {
					return nil, err
				}
			}
			if sel.has("creator") {
				if out[k].Creator, err = pick(i.CreatorID); err != nil {
					return nil, err
				}
			}
		}
	}

	// Comments and history are one query per issue, so they are fetched only when named.
	// A list view never asks for them; an issue detail asks for both and pays for two.
	if sel.has("comments") {
		for k, i := range issues {
			comments, err := r.Svc.ListComments(ctx, p, i.ID)
			if err != nil {
				return nil, err
			}
			if out[k].Comments, err = toComments(comments); err != nil {
				return nil, err
			}
		}
	}

	if sel.has("history") {
		for k, i := range issues {
			entries, err := r.Svc.ListIssueHistory(ctx, p, i.ID)
			if err != nil {
				return nil, err
			}
			if out[k].History, err = toHistory(entries); err != nil {
				return nil, err
			}
		}
	}

	return out, nil
}

// hydrateTeam fills a team's statuses and, when asked, its issues.
//
// Team.members is not filled. The domain layer exposes no membership listing and a
// resolver may not go around it to the database; membership rows reach a client on the
// bootstrap snapshot and then on the change stream, which is where a local-first client
// reads them from in any case.
func (r *Resolver) hydrateTeam(ctx context.Context, p *authz.Principal, sel selection, team model.Team) (generated.Team, error) {
	out := toTeam(team)

	if sel.has("states") {
		states, err := r.loaders(ctx).statesFor(ctx, p, team.ID)
		if err != nil {
			return generated.Team{}, err
		}
		if out.States, err = toWorkflowStates(states.all); err != nil {
			return generated.Team{}, err
		}
	}

	if child, ok := sel.child("issues", "Issue"); ok {
		issues, err := r.Svc.ListIssuesForTeam(ctx, p, team.ID)
		if err != nil {
			return generated.Team{}, err
		}
		if out.Issues, err = r.hydrateIssues(ctx, p, child, issues); err != nil {
			return generated.Team{}, err
		}
	}

	return out, nil
}

func (r *Resolver) hydrateTeams(ctx context.Context, p *authz.Principal, sel selection, teams []model.Team) ([]generated.Team, error) {
	out := make([]generated.Team, 0, len(teams))
	for _, t := range teams {
		g, err := r.hydrateTeam(ctx, p, sel, t)
		if err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, nil
}

func (r *Resolver) hydrateWorkspace(ctx context.Context, p *authz.Principal, sel selection, ws model.Workspace) (generated.Workspace, error) {
	out := toWorkspace(ws)
	l := r.loaders(ctx)

	if child, ok := sel.child("teams", "Team"); ok {
		teams, err := l.allTeams(ctx, p)
		if err != nil {
			return generated.Workspace{}, err
		}
		if out.Teams, err = r.hydrateTeams(ctx, p, child, teams.all); err != nil {
			return generated.Workspace{}, err
		}
	}

	if sel.has("users") {
		users, err := l.allUsers(ctx, p)
		if err != nil {
			return generated.Workspace{}, err
		}
		if out.Users, err = toUsers(users.all); err != nil {
			return generated.Workspace{}, err
		}
	}

	return out, nil
}
