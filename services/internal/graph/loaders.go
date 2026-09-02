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

type labelIndex struct {
	all  []model.Label
	byID map[uuid.UUID]model.Label
}

// membershipIndex is every membership the reader can see, grouped by team. Keyed by team
// rather than flat because that is the only question anything asks of it.
type membershipIndex struct {
	byTeam map[uuid.UUID][]model.TeamMembership
}

// Loaders holds one request's memoised reads.
//
// Request-scoped and never shared between requests. Everything in here came back from a
// domain call that filtered it for one principal, so a cache that outlived the request
// would be a cache of one person's permissions being handed to the next caller.
type Loaders struct {
	svc *domain.Service

	users       batch[userIndex]
	directory   batch[[]model.User]
	teams       batch[teamIndex]
	labels      batch[labelIndex]
	memberships batch[membershipIndex]

	// mu guards the states, cycles, projects and milestone maps only. The fetches
	// themselves run outside it, so a slow query for one team does not hold up another.
	mu         sync.Mutex
	states     map[uuid.UUID]*batch[stateIndex]
	cycles     map[uuid.UUID]*batch[*model.Cycle]
	projects   map[uuid.UUID]*batch[*model.Project]
	milestones map[uuid.UUID]*batch[milestoneIndex]
}

// milestoneIndex is one project's milestones, keyed by id.
//
// Read per project rather than per milestone because there is no read-one verb for a
// milestone, and a project holds a handful of them: one list answers every issue filed
// against that project.
type milestoneIndex struct {
	byID map[uuid.UUID]model.ProjectMilestone
}

type loadersKey struct{}

// loaderHandler is the middleware's handler, a named type rather than an
// http.HandlerFunc so that the wiring can be asserted from outside this package.
//
// It exists because the middleware was absent from the production chain for a long time
// and nothing failed: the fallback in loaders() is deliberately silent, so an unmounted
// middleware costs latency and never an error. IsLoaderHandler gives cmd/api a gate.
type loaderHandler struct {
	svc  *domain.Service
	next http.Handler
}

func (h loaderHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := context.WithValue(r.Context(), loadersKey{}, &Loaders{svc: h.svc})
	h.next.ServeHTTP(w, r.WithContext(ctx))
}

// LoaderMiddleware attaches a fresh set of loaders to every request, which is what widens
// their cache from one resolver call to the whole operation — the difference between a
// query that asks for issues and their assignees paying for the directory once or twice.
func LoaderMiddleware(svc *domain.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return loaderHandler{svc: svc, next: next}
	}
}

// IsLoaderHandler reports whether h is the loader middleware.
//
// For the wiring test in cmd/api. Nothing in production branches on it.
func IsLoaderHandler(h http.Handler) bool {
	_, ok := h.(loaderHandler)
	return ok
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

// workspaceDirectory reads "who is in this workspace", once — the answer behind
// `Query.users` and `Workspace.users`.
//
// Deliberately not allUsers, which is the wider hydration set every assignee and creator
// resolves through. See domain.ListDirectory for why the two are not the same list.
func (l *Loaders) workspaceDirectory(ctx context.Context, p *authz.Principal) ([]model.User, error) {
	return l.directory.load(func() ([]model.User, error) {
		return l.svc.ListDirectory(ctx, p)
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

// allLabels reads the labels this principal can see, once.
//
// A workspace-wide list, like the directory and the teams, and for the same reason: a label
// is shared by every issue that carries it, so a board showing chips on two hundred rows is
// still one read. The applications themselves — which label is on which issue — are per
// issue and come from the batched read in the domain layer; this is only the vocabulary
// those applications point into.
func (l *Loaders) allLabels(ctx context.Context, p *authz.Principal) (labelIndex, error) {
	return l.labels.load(func() (labelIndex, error) {
		labels, err := l.svc.ListLabels(ctx, p)
		if err != nil {
			return labelIndex{}, err
		}
		idx := labelIndex{all: labels, byID: make(map[uuid.UUID]model.Label, len(labels))}
		for _, lbl := range labels {
			idx.byID[lbl.ID] = lbl
		}
		return idx, nil
	})
}

// allMemberships reads who is in each of the reader's teams, once.
//
// A workspace-wide read like the directory and the teams, and it belongs in that set rather
// than in a per-team batch for a reason the shape of the callers decides: hydrateTeam is
// invoked once per team from three different places, one of them a loop over the distinct
// teams of an issue list. A batch keyed on the ids of one call would still be a query per
// team there. Memoised across the whole request it is one query however many teams the
// operation touches, which is the property the field needs — `teams { members { userId } }`
// on a fifty-team workspace costs the same as asking one team.
//
// It is bounded for the same reason the directory is: a person is in a handful of teams and
// a team has as many members as the workspace has people, so this is one small read and not
// a growth curve.
func (l *Loaders) allMemberships(ctx context.Context, p *authz.Principal) (membershipIndex, error) {
	return l.memberships.load(func() (membershipIndex, error) {
		byTeam, err := l.svc.ListTeamMemberships(ctx, p)
		if err != nil {
			return membershipIndex{}, err
		}
		return membershipIndex{byTeam: byTeam}, nil
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

// cycleByID reads one cycle, once per cycle per request.
//
// Keyed by cycle rather than by team because a list clusters onto very few windows — a
// team view is one current cycle plus whatever the rollover has not caught up with — so
// deduplicating on the id is what turns "one lookup per issue" into "one per window". A
// cycle the reader cannot see comes back nil rather than as an error, the same way a
// deleted assignee does: the reference stays on the row, the nested object is absent.
func (l *Loaders) cycleByID(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (*model.Cycle, error) {
	l.mu.Lock()
	if l.cycles == nil {
		l.cycles = make(map[uuid.UUID]*batch[*model.Cycle])
	}
	b, ok := l.cycles[id]
	if !ok {
		b = &batch[*model.Cycle]{}
		l.cycles[id] = b
	}
	l.mu.Unlock()

	return b.load(func() (*model.Cycle, error) {
		c, err := l.svc.GetCycle(ctx, p, id)
		if err != nil {
			// GetCycle answers "you may not see it" with the same not-found the missing
			// row gets, on purpose, so this branch covers both.
			if platform.CodeOf(err) == platform.CodeNotFound {
				return nil, nil
			}
			return nil, err
		}
		return &c, nil
	})
}

// --- what the query actually asked for ------------------------------------------

// referenceFields are the relations that cost a bounded number of queries no matter how
// long the list is, because they are all served from the three workspace-wide reads
// above. They are the ones a caller outside a GraphQL operation gets by default; the
// collections — comments, history, a team's issues — are one query per parent row and are
// fetched only when a query names them.
// "label" — the one an application points at — is here for the same reason as "state": it is
// non-null in the schema, so a value handed back without it is not a sparse answer but an
// unserialisable one, and it is served from a workspace-wide list like the rest.
var referenceFields = map[string]bool{
	"state": true, "team": true, "assignee": true, "creator": true,
	"states": true, "teams": true, "users": true, "label": true, "members": true,
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

// projectByID reads one project, once per project per request.
//
// Keyed by project for the same reason cycleByID is keyed by cycle: a team's issues
// cluster onto a few projects, so deduplicating on the id turns "one lookup per issue"
// into "one per project". A project the reader cannot see comes back nil rather than as
// an error — the reference stays on the row and the nested object is absent, which is what
// a deleted assignee already does.
func (l *Loaders) projectByID(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (*model.Project, error) {
	l.mu.Lock()
	if l.projects == nil {
		l.projects = make(map[uuid.UUID]*batch[*model.Project])
	}
	b, ok := l.projects[id]
	if !ok {
		b = &batch[*model.Project]{}
		l.projects[id] = b
	}
	l.mu.Unlock()

	return b.load(func() (*model.Project, error) {
		pr, err := l.svc.GetProject(ctx, p, id)
		if err != nil {
			// GetProject answers "you may not see it" with the same not-found the missing
			// row gets, on purpose, so this branch covers both.
			if platform.CodeOf(err) == platform.CodeNotFound {
				return nil, nil
			}
			return nil, err
		}
		return &pr, nil
	})
}

// milestonesFor reads one project's milestones, once per project per request.
func (l *Loaders) milestonesFor(
	ctx context.Context, p *authz.Principal, projectID uuid.UUID,
) (milestoneIndex, error) {
	l.mu.Lock()
	if l.milestones == nil {
		l.milestones = make(map[uuid.UUID]*batch[milestoneIndex])
	}
	b, ok := l.milestones[projectID]
	if !ok {
		b = &batch[milestoneIndex]{}
		l.milestones[projectID] = b
	}
	l.mu.Unlock()

	return b.load(func() (milestoneIndex, error) {
		ms, err := l.svc.ListProjectMilestones(ctx, p, projectID)
		if err != nil {
			if platform.CodeOf(err) == platform.CodeNotFound {
				return milestoneIndex{byID: map[uuid.UUID]model.ProjectMilestone{}}, nil
			}
			return milestoneIndex{}, err
		}
		idx := milestoneIndex{byID: make(map[uuid.UUID]model.ProjectMilestone, len(ms))}
		for _, m := range ms {
			idx.byID[m.ID] = m
		}
		return idx, nil
	})
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
		g, err := toIssue(i)
		if err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	if len(out) == 0 {
		return out, nil
	}
	l := r.loaders(ctx)

	// The ids of the whole batch, minted once. Every collection below is keyed by them, and
	// building the slice per collection would be the only per-row cost left in here.
	ids := make([]uuid.UUID, 0, len(issues))
	for _, i := range issues {
		ids = append(ids, i.ID)
	}

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

		// Asked once, above the loop. selection.child re-walks the query AST with
		// graphql.CollectFields on every call, so asking per row made an O(rows x fields)
		// tree walk out of two constant answers — on the hottest list path there is. The
		// pattern is the one project/projectMilestone below already uses.
		wantAssignee := sel.has("assignee")
		wantCreator := sel.has("creator")
		for k, i := range issues {
			if wantAssignee {
				if out[k].Assignee, err = pick(i.AssigneeID); err != nil {
					return nil, err
				}
			}
			if wantCreator {
				if out[k].Creator, err = pick(i.CreatorID); err != nil {
					return nil, err
				}
			}
		}
	}

	// Comments, attachments and history are fetched only when named — a list view does not
	// ask for them and must not pay for them — but when they ARE named it is one query for
	// the whole page, not one per row.
	//
	// They used to be the three exceptions on this type: every other collection below got a
	// batched `…ForIssues` verb and these looped, with each iteration costing GetIssue +
	// GetTeam + the listing. The in-code comment that a list view never asks for them was a
	// hope rather than an enforcement, and the issue-detail screen asks for all three.
	if child, ok := sel.child("comments", "Comment"); ok {
		byIssue, err := r.Svc.ListCommentsForIssues(ctx, p, ids)
		if err != nil {
			return nil, err
		}
		for k, i := range issues {
			// Through the comment hydrator rather than the bare converter, so that
			// `comments { issue { … } }` resolves rather than returning null on a non-null
			// field. It costs nothing unless the query names it: the issue is the one being
			// hydrated here, so the batched read finds it in the same set.
			if out[k].Comments, err = r.hydrateComments(ctx, p, child, byIssue[i.ID]); err != nil {
				return nil, err
			}
		}
	}

	if sel.has("attachments") {
		byIssue, err := r.Svc.ListAttachmentsForIssues(ctx, p, ids)
		if err != nil {
			return nil, err
		}
		for k, i := range issues {
			out[k].Attachments = toAttachments(byIssue[i.ID])
		}
	}

	if sel.has("history") {
		byIssue, err := r.Svc.ListIssueHistoryForIssues(ctx, p, ids)
		if err != nil {
			return nil, err
		}
		for k, i := range issues {
			if out[k].History, err = toHistory(byIssue[i.ID]); err != nil {
				return nil, err
			}
		}
	}

	// Everything below is a collection hanging off an issue, and every one of them is one
	// query for the whole batch rather than one per row — see internal/domain/issue_details.go
	// for why the single-issue calls beside them are the wrong shape here. Label chips and
	// progress bars are drawn on every row of a filtered list, so a per-issue read would be
	// the N+1 that hurts on the screen people spend their day in; the rest are detail-panel
	// fields that a list never names and therefore never pays for.
	//
	// Each list is filled with an empty slice rather than left nil when a query names it,
	// because the schema declares all of them non-null and a nil slice marshals to null.

	if sel.has("labels") {
		applied, err := r.Svc.ListIssueLabelsForIssues(ctx, p, ids)
		if err != nil {
			return nil, err
		}
		labels, err := l.allLabels(ctx, p)
		if err != nil {
			return nil, err
		}
		for k, i := range issues {
			rows := applied[i.ID]
			chips := make([]generated.Label, 0, len(rows))
			for _, row := range rows {
				lbl, ok := labels.byID[row.LabelID]
				if !ok {
					// An archived label is gone as far as every reader is concerned — see
					// domain.loadLabel — and the applications outlive it until somebody
					// removes them. Returning a chip nothing can resolve is worse than
					// leaving it out.
					continue
				}
				chips = append(chips, toLabel(lbl))
			}
			out[k].Labels = chips
		}
	}

	if child, ok := sel.child("parent", "Issue"); ok {
		parentIDs := make([]uuid.UUID, 0, len(issues))
		seen := make(map[uuid.UUID]struct{}, len(issues))
		for _, i := range issues {
			if i.ParentID == nil {
				continue
			}
			if _, dup := seen[*i.ParentID]; dup {
				continue
			}
			seen[*i.ParentID] = struct{}{}
			parentIDs = append(parentIDs, *i.ParentID)
		}

		if len(parentIDs) > 0 {
			parents, err := r.Svc.IssuesByID(ctx, p, parentIDs)
			if err != nil {
				return nil, err
			}
			// Distinct parents only, and hydrated as one batch of their own, so a hundred
			// sub-issues of one epic resolve that epic's status and team once between them.
			flat := make([]model.Issue, 0, len(parents))
			for _, parentID := range parentIDs {
				if parent, found := parents[parentID]; found {
					flat = append(flat, parent)
				}
			}
			hydrated, err := r.hydrateIssues(ctx, p, child, flat)
			if err != nil {
				return nil, err
			}
			byID := make(map[uuid.UUID]*generated.Issue, len(hydrated))
			for k := range hydrated {
				byID[hydrated[k].ID] = &hydrated[k]
			}
			for k, i := range issues {
				if i.ParentID == nil {
					continue
				}
				// A parent in a team the reader cannot see stays null. Cross-team parents
				// are the normal case, so this is a shape the field has to have anyway —
				// which is why `parent` is nullable in the schema.
				out[k].Parent = byID[*i.ParentID]
			}
		}
	}

	// Children and progress come from one read, because progress is a rollup of exactly
	// these rows. Asking for both is what an issue detail does, and paying twice for it
	// would make the second one look free right up until a list view asked for it.
	childSel, wantChildren := sel.child("children", "Issue")
	wantProgress := sel.has("progress")
	if wantChildren || wantProgress {
		subs, err := r.Svc.SubIssuesFor(ctx, p, ids)
		if err != nil {
			return nil, err
		}
		if wantProgress {
			for k, i := range issues {
				out[k].Progress = toIssueProgress(subs[i.ID].Progress)
			}
		}
		if wantChildren {
			// Every parent's children, flattened into one batch and hydrated together, then
			// handed back in slices. Hydrating each parent's list on its own would put the
			// N+1 back one level down: a query naming `children { labels { name } }` would
			// read the applications once per parent instead of once for the page.
			//
			// The slicing works because hydrateIssues preserves order, and the capacity is
			// clamped so a later append to one parent's list cannot write into the next.
			flat := make([]model.Issue, 0, len(issues))
			for _, i := range issues {
				flat = append(flat, subs[i.ID].Children...)
			}
			hydrated, err := r.hydrateIssues(ctx, p, childSel, flat)
			if err != nil {
				return nil, err
			}
			at := 0
			for k, i := range issues {
				n := len(subs[i.ID].Children)
				out[k].Children = hydrated[at : at+n : at+n]
				at += n
			}
		}
	}

	if child, ok := sel.child("relations", "IssueRelation"); ok {
		relations, err := r.Svc.ListRelationsForIssues(ctx, p, ids)
		if err != nil {
			return nil, err
		}
		for k, i := range issues {
			if out[k].Relations, err = r.hydrateIssueRelations(ctx, p, child, relations[i.ID]); err != nil {
				return nil, err
			}
		}
	}

	if child, ok := sel.child("blockedBy", "IssueRelation"); ok {
		blockers, err := r.Svc.ListBlockersForIssues(ctx, p, ids)
		if err != nil {
			return nil, err
		}
		for k, i := range issues {
			if out[k].BlockedBy, err = r.hydrateIssueRelations(ctx, p, child, blockers[i.ID]); err != nil {
				return nil, err
			}
		}
	}

	if sel.has("subscribers") {
		subscribers, err := r.Svc.ListSubscribersForIssues(ctx, p, ids)
		if err != nil {
			return nil, err
		}
		for k, i := range issues {
			if out[k].Subscribers, err = toIssueSubscriptions(subscribers[i.ID]); err != nil {
				return nil, err
			}
		}
	}

	// The cycle an issue is filed into. Read by id rather than from the team's list,
	// because a team's list stops at the live windows and an issue keeps pointing at a
	// cycle after it is archived — resolving that to null would say the issue is in no
	// cycle, which is a different fact from the one the column holds.
	if sel.has("cycle") {
		for k, i := range issues {
			if i.CycleID == nil {
				continue
			}
			c, err := l.cycleByID(ctx, p, *i.CycleID)
			if err != nil {
				return nil, err
			}
			if c == nil {
				continue
			}
			g := toCycle(*c)
			out[k].Cycle = &g
		}
	}

	// The project an issue is filed against, and the milestone inside it. Same shape as
	// the cycle above, and left out of this function for the same length of time: the id
	// column was populated, the nested object was null, and only a reader who already knew
	// the answer could tell.
	if sel.has("project") || sel.has("projectMilestone") {
		wantProject := sel.has("project")
		wantMilestone := sel.has("projectMilestone")
		for k, i := range issues {
			if i.ProjectID == nil {
				continue
			}
			if wantProject {
				pr, err := l.projectByID(ctx, p, *i.ProjectID)
				if err != nil {
					return nil, err
				}
				if pr != nil {
					g, err := toProject(*pr)
					if err != nil {
						return nil, err
					}
					out[k].Project = &g
				}
			}
			if !wantMilestone || i.ProjectMilestoneID == nil {
				continue
			}
			ms, err := l.milestonesFor(ctx, p, *i.ProjectID)
			if err != nil {
				return nil, err
			}
			m, ok := ms.byID[*i.ProjectMilestoneID]
			if !ok {
				// A milestone the reader cannot see, or one deleted while the row still
				// names it. Absent rather than an error, like every other reference here.
				continue
			}
			g := toProjectMilestone(m)
			out[k].ProjectMilestone = &g
		}
	}

	return out, nil
}

// hydrateComment fills in the issue one comment sits on.
func (r *Resolver) hydrateComment(
	ctx context.Context, p *authz.Principal, sel selection, comment model.Comment,
) (generated.Comment, error) {
	out, err := r.hydrateComments(ctx, p, sel, []model.Comment{comment})
	if err != nil {
		return generated.Comment{}, err
	}
	return out[0], nil
}

// hydrateComments fills in the issue each comment sits on, for the whole list at once.
//
// `issue` is not a reference field and is fetched only when a query names it, because it is
// a whole issue and not a lookup into a workspace-wide list — an issue detail panel already
// holds the issue its comments belong to and would be asking for a copy of it per comment.
// The one caller that genuinely needs it is search, where a comment hit has no other way
// home; without the field a client renders "in ENG-142" by fetching each hit's issue by id.
//
// Two reads for the whole page whatever its length: the distinct issues in one batched call,
// then those issues hydrated as one batch of their own, so a query asking for
// `comments { issue { team { name } } }` resolves the teams once between them rather than
// once per comment. Comments cluster heavily onto few issues, which is why the ids are
// deduplicated before the read rather than after it.
func (r *Resolver) hydrateComments(
	ctx context.Context, p *authz.Principal, sel selection, comments []model.Comment,
) ([]generated.Comment, error) {
	out, err := toComments(comments)
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}

	// Reactions: one read for the whole page, keyed by comment. Non-null in the schema, so
	// a comment with none gets an empty slice rather than nil.
	if sel.has("reactions") {
		ids := make([]uuid.UUID, 0, len(comments))
		for _, c := range comments {
			ids = append(ids, c.ID)
		}
		byComment, err := r.Svc.ListReactionsForComments(ctx, p, ids)
		if err != nil {
			return nil, err
		}
		for k, c := range comments {
			out[k].Reactions = toReactions(byComment[c.ID])
		}
	}

	child, ok := sel.child("issue", "Issue")
	if !ok {
		return out, nil
	}

	ids := make([]uuid.UUID, 0, len(comments))
	seen := make(map[uuid.UUID]struct{}, len(comments))
	for _, c := range comments {
		if _, dup := seen[c.IssueID]; dup {
			continue
		}
		seen[c.IssueID] = struct{}{}
		ids = append(ids, c.IssueID)
	}

	issues, err := r.Svc.IssuesByID(ctx, p, ids)
	if err != nil {
		return nil, err
	}
	flat := make([]model.Issue, 0, len(ids))
	for _, id := range ids {
		if issue, found := issues[id]; found {
			flat = append(flat, issue)
		}
	}
	hydrated, err := r.hydrateIssues(ctx, p, child, flat)
	if err != nil {
		return nil, err
	}
	byID := make(map[uuid.UUID]*generated.Issue, len(hydrated))
	for k := range hydrated {
		byID[hydrated[k].ID] = &hydrated[k]
	}

	for k, c := range comments {
		g, found := byID[c.IssueID]
		if !found {
			// The schema declares `issue: Issue!`, and every path that can hand a caller a
			// comment has already read the issue to decide they may see it — the listings
			// join through it and search filters on it. A miss is therefore a broken
			// invariant, not a permission answer, and saying so beats marshalling a null
			// into a non-null after the response is already half written.
			return nil, platform.Internal(
				fmt.Errorf("comment %s is on issue %s, which the reader cannot see", c.ID, c.IssueID))
		}
		out[k].Issue = g
	}
	return out, nil
}

// hydrateInitiatives fills in the four relations an initiative declares.
//
// `projects: [InitiativeProject!]!` is the one that matters: it is NON-NULL and the
// converter set it to nil, so gqlgen refused to marshal it and failed the entire
// `initiatives` / `initiative` field — a client selecting `initiatives { projects { … } }`
// received data: null and no usable error. owner, leadTeam and creator are nullable and
// merely degraded to null, which is why nobody noticed the field that did not.
//
// An empty slice rather than nil whenever the query names it, which is the rule the rest
// of this file already follows for a non-null list.
func (r *Resolver) hydrateInitiatives(
	ctx context.Context, p *authz.Principal, sel selection, rows []model.Initiative,
) ([]generated.Initiative, error) {
	out := make([]generated.Initiative, 0, len(rows))
	for _, row := range rows {
		converted, err := toInitiative(row)
		if err != nil {
			return nil, err
		}
		out = append(out, converted)
	}
	if len(out) == 0 {
		return out, nil
	}
	l := r.loaders(ctx)

	if sel.has("owner") || sel.has("creator") {
		users, err := l.allUsers(ctx, p)
		if err != nil {
			return nil, err
		}
		pick := func(id *uuid.UUID) (*generated.User, error) {
			if id == nil {
				return nil, nil
			}
			u, ok := users.byID[*id]
			if !ok {
				// A departed account leaves the reference behind on purpose; history
				// that names somebody is not rewritten when they leave.
				return nil, nil
			}
			g, err := toUser(u)
			if err != nil {
				return nil, err
			}
			return &g, nil
		}
		for k, row := range rows {
			var err error
			if sel.has("owner") {
				if out[k].Owner, err = pick(row.OwnerID); err != nil {
					return nil, err
				}
			}
			if sel.has("creator") {
				if out[k].Creator, err = pick(row.CreatorID); err != nil {
					return nil, err
				}
			}
		}
	}

	if sel.has("leadTeam") {
		teams, err := l.allTeams(ctx, p)
		if err != nil {
			return nil, err
		}
		for k, row := range rows {
			if row.LeadTeamID == nil {
				continue
			}
			t, ok := teams.byID[*row.LeadTeamID]
			if !ok {
				// A private team the reader is not in. Nullable, so this is an answer.
				continue
			}
			g, err := toTeam(t)
			if err != nil {
				return nil, err
			}
			out[k].LeadTeam = &g
		}
	}

	child, wantsProjects := sel.child("projects", "InitiativeProject")
	if !wantsProjects {
		return out, nil
	}

	ids := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	links, err := r.Svc.ListInitiativeProjectsForInitiatives(ctx, p, ids)
	if err != nil {
		return nil, err
	}

	// InitiativeProject.project is non-null too, so the same failure lives one level down.
	// The projects behind every link on the page are read and hydrated once between them
	// rather than once per link.
	var byProject map[uuid.UUID]*generated.Project
	if projectSel, wantsProject := child.child("project", "Project"); wantsProject {
		seen := map[uuid.UUID]struct{}{}
		projectIDs := make([]uuid.UUID, 0)
		for _, list := range links {
			for _, link := range list {
				if _, dup := seen[link.ProjectID]; dup {
					continue
				}
				seen[link.ProjectID] = struct{}{}
				projectIDs = append(projectIDs, link.ProjectID)
			}
		}
		flat := make([]model.Project, 0, len(projectIDs))
		for _, id := range projectIDs {
			pr, err := l.projectByID(ctx, p, id)
			if err != nil {
				return nil, err
			}
			if pr != nil {
				flat = append(flat, *pr)
			}
		}
		hydrated, err := r.hydrateProjects(ctx, p, projectSel, flat)
		if err != nil {
			return nil, err
		}
		byProject = make(map[uuid.UUID]*generated.Project, len(hydrated))
		for k := range hydrated {
			byProject[hydrated[k].ID] = &hydrated[k]
		}
	}

	for k, row := range rows {
		list := links[row.ID]
		// Minted empty rather than left nil: the field is non-null, and an initiative
		// with no projects is an ordinary state, not a failure.
		projects := make([]generated.InitiativeProject, 0, len(list))
		for _, link := range list {
			converted := toInitiativeProject(link)
			if byProject != nil {
				g, found := byProject[link.ProjectID]
				if !found {
					// The link survived the domain's visibility filter but the project
					// read did not agree. `project` is non-null, so there is nothing
					// honest to put there; dropping the link beats failing the whole
					// initiative that carries it.
					continue
				}
				converted.Project = g
			}
			projects = append(projects, converted)
		}
		out[k].Projects = projects
	}
	return out, nil
}

// hydrateNotifications fills in the issue each inbox row is about.
//
// `Notification.issue` is in the schema and the converter never set it. The field is
// nullable, so it failed silently: the inbox rendered "unknown issue" and every client was
// pushed into one `issue(id:)` round trip per row — the exact N+1 the field exists to
// remove.
//
// Two reads for the whole inbox, the shape hydrateComments established: the distinct
// issues in one batched call, then those issues hydrated as one batch of their own.
// Notifications cluster heavily onto few issues — that is what grouping is for — so the
// ids are deduplicated before the read rather than after it.
func (r *Resolver) hydrateNotifications(
	ctx context.Context, p *authz.Principal, sel selection, rows []model.Notification,
) ([]generated.Notification, error) {
	out, err := toNotifications(rows)
	if err != nil {
		return nil, err
	}
	child, ok := sel.child("issue", "Issue")
	if !ok || len(out) == 0 {
		return out, nil
	}

	ids := make([]uuid.UUID, 0, len(rows))
	seen := make(map[uuid.UUID]struct{}, len(rows))
	for _, n := range rows {
		if n.IssueID == nil {
			// A workspace-level notification — an invite, a billing notice — is about no
			// issue, which is why the field is nullable in the first place.
			continue
		}
		if _, dup := seen[*n.IssueID]; dup {
			continue
		}
		seen[*n.IssueID] = struct{}{}
		ids = append(ids, *n.IssueID)
	}
	if len(ids) == 0 {
		return out, nil
	}

	issues, err := r.Svc.IssuesByID(ctx, p, ids)
	if err != nil {
		return nil, err
	}
	flat := make([]model.Issue, 0, len(ids))
	for _, id := range ids {
		if issue, found := issues[id]; found {
			flat = append(flat, issue)
		}
	}
	hydrated, err := r.hydrateIssues(ctx, p, child, flat)
	if err != nil {
		return nil, err
	}
	byID := make(map[uuid.UUID]*generated.Issue, len(hydrated))
	for k := range hydrated {
		byID[hydrated[k].ID] = &hydrated[k]
	}

	for k, n := range rows {
		if n.IssueID == nil {
			continue
		}
		// A miss stays null rather than erroring: an issue can be deleted while its
		// notification sits in the inbox, and the field is nullable precisely so that row
		// still renders. Unlike Comment.issue, there is no invariant to break here.
		out[k].Issue = byID[*n.IssueID]
	}
	return out, nil
}

// hydrateIssueRelations fills in the two issues a link names.
//
// The schema declares `issue: Issue!` and `relatedIssue: Issue!`, and the converter set
// neither — there are no field resolvers on this type, so the generated code read the
// struct directly and marshalled nil into a non-null position. Any query selecting
// `relations { relatedIssue { title } }` therefore errored and NULLED THE CONTAINING
// ISSUE. It was latent only because the web client reads relations out of its own replica
// and never names these fields; an SDK, an integration or a mobile client hits it at once.
//
// Two reads for the whole page whatever its length, the same shape as hydrateComments: the
// distinct issues on both ends in one batched call, then those issues hydrated as one
// batch of their own. Both ends are gathered together because a page of relations names
// the same handful of issues from either side.
func (r *Resolver) hydrateIssueRelations(
	ctx context.Context, p *authz.Principal, sel selection, relations []model.IssueRelation,
) ([]generated.IssueRelation, error) {
	out, err := toIssueRelations(relations)
	if err != nil {
		return nil, err
	}
	wantIssue := sel.has("issue")
	wantRelated := sel.has("relatedIssue")
	if (!wantIssue && !wantRelated) || len(out) == 0 {
		return out, nil
	}

	// The child selections are read separately so that `issue { team { name } }` and
	// `relatedIssue { assignee { name } }` each get what they asked for. When only one end
	// is named, only that end's selection exists.
	issueSel, _ := sel.child("issue", "Issue")
	relatedSel, _ := sel.child("relatedIssue", "Issue")

	ids := make([]uuid.UUID, 0, len(relations)*2)
	seen := make(map[uuid.UUID]struct{}, len(relations)*2)
	add := func(id uuid.UUID) {
		if _, dup := seen[id]; dup {
			return
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	for _, rel := range relations {
		if wantIssue {
			add(rel.IssueID)
		}
		if wantRelated {
			add(rel.RelatedIssueID)
		}
	}

	issues, err := r.Svc.IssuesByID(ctx, p, ids)
	if err != nil {
		return nil, err
	}
	flat := make([]model.Issue, 0, len(ids))
	for _, id := range ids {
		if issue, found := issues[id]; found {
			flat = append(flat, issue)
		}
	}

	// hydrateIssues is called once per end rather than once overall: the two ends carry
	// different selections, and merging them would serve `issue`'s fields to
	// `relatedIssue`. The underlying reads are memoised on the request's loaders, so the
	// second pass costs the conversion and nothing else.
	byID := func(child selection) (map[uuid.UUID]*generated.Issue, error) {
		hydrated, err := r.hydrateIssues(ctx, p, child, flat)
		if err != nil {
			return nil, err
		}
		m := make(map[uuid.UUID]*generated.Issue, len(hydrated))
		for k := range hydrated {
			m[hydrated[k].ID] = &hydrated[k]
		}
		return m, nil
	}

	// A relation is visible when the reader is a member of EITHER team — that is the rule
	// the listing applies and the one relationScope writes onto the change row — so the
	// far issue can genuinely be one this reader cannot open. The field is non-null, so
	// there is nothing honest to put there; refusing the link is better than failing the
	// whole issue that carries it, which is what nil did.
	drop := make([]bool, len(out))

	if wantIssue {
		m, err := byID(issueSel)
		if err != nil {
			return nil, err
		}
		for k, rel := range relations {
			if g, found := m[rel.IssueID]; found {
				out[k].Issue = g
			} else {
				drop[k] = true
			}
		}
	}
	if wantRelated {
		m, err := byID(relatedSel)
		if err != nil {
			return nil, err
		}
		for k, rel := range relations {
			if g, found := m[rel.RelatedIssueID]; found {
				out[k].RelatedIssue = g
			} else {
				drop[k] = true
			}
		}
	}

	kept := out[:0]
	for k := range out {
		if !drop[k] {
			kept = append(kept, out[k])
		}
	}
	return kept, nil
}

// hydrateIssueLabel fills in the label an application points at.
//
// The schema declares it `label: Label!`, so leaving it nil is not a null field — it is a
// failed query: gqlgen refuses to marshal null into a non-null position and the whole
// mutation comes back as an error, after the write has already landed. The label comes from
// the same memoised workspace list every other label read uses, so this costs nothing beyond
// the first one.
func (r *Resolver) hydrateIssueLabel(
	ctx context.Context, p *authz.Principal, sel selection, applied model.IssueLabel,
) (generated.IssueLabel, error) {
	out := toIssueLabel(applied)
	if !sel.has("label") {
		return out, nil
	}

	labels, err := r.loaders(ctx).allLabels(ctx, p)
	if err != nil {
		return generated.IssueLabel{}, err
	}
	lbl, ok := labels.byID[applied.LabelID]
	if !ok {
		// The application was written a moment ago against a label the same principal had to
		// be able to see, so a miss is a broken invariant rather than a permission answer.
		return generated.IssueLabel{}, platform.Internal(
			fmt.Errorf("issue label %s points at label %s, which the reader cannot see", applied.ID, applied.LabelID))
	}
	g := toLabel(lbl)
	out.Label = &g
	return out, nil
}

// hydrateTeam fills a team's statuses and members and, when asked, its issues, labels and
// templates.
func (r *Resolver) hydrateTeam(ctx context.Context, p *authz.Principal, sel selection, team model.Team) (generated.Team, error) {
	out, err := toTeam(team)
	if err != nil {
		return generated.Team{}, err
	}

	// Members come from the one memoised read of the reader's own teams, so a query naming
	// this field on every team in the workspace costs a single query rather than one per
	// team — see allMemberships.
	//
	// A team outside the reader's visible set resolves to an empty list rather than to its
	// roster — which is the same answer their replica holds, because the bootstrap ships
	// memberships for exactly that set. The empty slice is minted here rather than in the
	// domain layer because the schema is what declares the field non-null, and a nil slice
	// marshals to null.
	if sel.has("members") {
		memberships, err := r.loaders(ctx).allMemberships(ctx, p)
		if err != nil {
			return generated.Team{}, err
		}
		rows := memberships.byTeam[team.ID]
		out.Members = make([]generated.TeamMembership, 0, len(rows))
		for _, m := range rows {
			g, err := toMembership(m)
			if err != nil {
				return generated.Team{}, err
			}
			out.Members = append(out.Members, g)
		}
	}

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

	// The team's label picker: the workspace's labels, which every team is offered, plus its
	// own. Filtered from the one workspace-wide read rather than queried per team, so a
	// viewer query that walks every team still pays for the vocabulary once.
	if sel.has("labels") {
		labels, err := r.loaders(ctx).allLabels(ctx, p)
		if err != nil {
			return generated.Team{}, err
		}
		offered := make([]model.Label, 0, len(labels.all))
		for _, lbl := range labels.all {
			if lbl.TeamID == nil || *lbl.TeamID == team.ID {
				offered = append(offered, lbl)
			}
		}
		out.Labels = toLabels(offered)
	}

	// Templates are one read per team and are named only by a create dialog, which opens for
	// one team at a time. Not worth the workspace-wide index the labels get.
	if sel.has("templates") {
		templates, err := r.Svc.ListIssueTemplates(ctx, p, &team.ID)
		if err != nil {
			return generated.Team{}, err
		}
		out.Templates = toIssueTemplates(templates)
	}

	if sel.has("recurringIssues") {
		rows, err := r.Svc.ListRecurringIssues(ctx, p, team.ID)
		if err != nil {
			return generated.Team{}, err
		}
		if out.RecurringIssues, err = toRecurringIssues(rows); err != nil {
			return generated.Team{}, err
		}
	}

	if sel.has("cycles") {
		cycles, err := r.Svc.ListCycles(ctx, p, team.ID)
		if err != nil {
			return generated.Team{}, err
		}
		out.Cycles = toCycles(cycles)
	}

	if sel.has("subTeams") {
		children, err := r.Svc.ListSubTeams(ctx, p, team.ID)
		if err != nil {
			return generated.Team{}, err
		}
		if out.SubTeams, err = r.hydrateTeams(ctx, p, sel.childOrNone("subTeams", "Team"), children); err != nil {
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
		users, err := l.workspaceDirectory(ctx, p)
		if err != nil {
			return generated.Workspace{}, err
		}
		if out.Users, err = toUsers(users); err != nil {
			return generated.Workspace{}, err
		}
	}

	// `Workspace.entitlements` is non-null in the schema and nothing filled it, so gqlgen
	// failed the whole `workspace` field the moment a client selected it — which the client
	// does on every load, in the one query the administration screens have. The response was
	// `data: null` with "the requested element is null which the schema does not allow", and
	// the client's documented fallback for an unanswerable matrix is to leave gated controls
	// live and let the server refuse them. So SLAs, private teams, sub-teams, SSO and the
	// audit log rendered as available on every plan, on every deployment, and a Free
	// workspace only learned otherwise from the error a write came back with.
	//
	// `toEntitlements` sat here fully written with no caller — the resolver was never wired.
	if sel.has("entitlements") {
		set, err := r.Svc.EntitlementSet(ctx, p)
		if err != nil {
			return generated.Workspace{}, err
		}
		entitlements := toEntitlements(set.Features(), string(set.Plan()), set.SeatsUsed(), set.Lapsed())
		out.Entitlements = &entitlements
	}

	return out, nil
}
