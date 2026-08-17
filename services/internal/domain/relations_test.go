package domain_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// secondTeam builds another team in the same workspace and puts one issue in it, returning
// both ids.
//
// It goes through the domain layer rather than the fixture because a team needs its default
// workflow seeded before it can hold an issue, and CreateTeam is the only thing that does
// that. The principal is mutated by CreateTeam to include the new team, which is what the
// request path does too.
func secondTeam(t *testing.T, svc *domain.Service, p *authz.Principal, key, title string) (uuid.UUID, uuid.UUID) {
	t.Helper()
	ctx := context.Background()

	team, _, err := svc.CreateTeam(ctx, p, domain.CreateTeamInput{Key: key, Name: key + " team"})
	if err != nil {
		t.Fatalf("create team %s: %v", key, err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: team.ID, Title: title})
	if err != nil {
		t.Fatalf("create issue in %s: %v", key, err)
	}
	return team.ID, issue.ID
}

// A blocks relation between two teams has to be legible from both ends. It is one row, so
// the failure this guards against is not a missing row but a listing that only looks one
// way — the far team opening the issue and seeing nothing blocking it.
func TestCreateIssueRelation_CrossTeamBlocksIsVisibleFromBothEnds(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	platformIssue := f.NewIssue(t, "Ship the migration")
	_, productIssue := secondTeam(t, svc, p, "PRD", "Launch the feature")

	rel, version, err := svc.CreateIssueRelation(ctx, p, platformIssue, productIssue, model.RelationBlocks)
	if err != nil {
		t.Fatalf("create relation: %v", err)
	}
	if version == 0 {
		t.Error("a relation must land on the sync stream")
	}
	if rel.TeamID == rel.RelatedTeamID {
		t.Fatalf("the fixture did not produce a cross-team pair: %s", rel.TeamID)
	}

	forward, err := svc.ListIssueRelations(ctx, p, platformIssue)
	if err != nil {
		t.Fatalf("list forward: %v", err)
	}
	if len(forward) != 1 || forward[0].RelatedIssueID != productIssue {
		t.Fatalf("the blocking issue does not list what it blocks: %+v", forward)
	}

	reverse, err := svc.ListIssuesBlocking(ctx, p, productIssue)
	if err != nil {
		t.Fatalf("list reverse: %v", err)
	}
	if len(reverse) != 1 || reverse[0].IssueID != platformIssue {
		t.Fatalf("the blocked issue does not list what blocks it: %+v", reverse)
	}
	// Same row, read from two directions. Two ids here would mean the product had started
	// storing both directions, which is the state that can disagree with itself.
	if forward[0].ID != reverse[0].ID {
		t.Errorf("both ends must be reading one row, got %s and %s", forward[0].ID, reverse[0].ID)
	}

	// The scope has to reach both teams. A team scope naming one side is the bug where the
	// relation exists in the database and never appears on the other team's screen.
	scope := relationChangeScope(t, db, f.WorkspaceID, rel.ID)
	if scope.Kind != authz.ScopeProject {
		t.Fatalf("relation scope kind = %q, want project", scope.Kind)
	}
	if !containsID(scope.TeamIDs, rel.TeamID) || !containsID(scope.TeamIDs, rel.RelatedTeamID) {
		t.Errorf("relation scope %v must carry both teams (%s, %s)", scope.TeamIDs, rel.TeamID, rel.RelatedTeamID)
	}
}

// `related` has no direction, so the caller may name the pair either way round and must end
// up with the same single row. Without canonicalisation the second call stores a mirror the
// unique index cannot see, and the issue panel shows the same link twice.
func TestCreateIssueRelation_RelatedCanonicalisesEitherArgumentOrder(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	a := f.NewIssue(t, "One")
	b := f.NewIssue(t, "Two")

	first, _, err := svc.CreateIssueRelation(ctx, p, a, b, model.RelationRelated)
	if err != nil {
		t.Fatalf("create a-b: %v", err)
	}

	// The same pair, named the other way round. It is the same relation, and saying so is
	// the only honest answer.
	_, _, err = svc.CreateIssueRelation(ctx, p, b, a, model.RelationRelated)
	if err == nil {
		t.Fatal("the mirrored pair was stored as a second relation")
	}
	if !strings.Contains(err.Error(), "already linked") {
		t.Errorf("the refusal should say the link exists, got: %v", err)
	}

	// Stored smaller-id-first regardless of which way the caller asked.
	if first.IssueID != minUUID(a, b) || first.RelatedIssueID != maxUUID(a, b) {
		t.Errorf("a symmetric relation must be stored canonically, got %s -> %s",
			first.IssueID, first.RelatedIssueID)
	}

	// And exactly one row exists, from whichever end you count.
	forward, err := svc.ListIssueRelations(ctx, p, first.IssueID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(forward) != 1 {
		t.Fatalf("expected one relation, got %d", len(forward))
	}
}

// Reordering a directional relation would reverse its meaning, so canonicalisation must
// apply to `related` and nothing else.
func TestCreateIssueRelation_BlocksKeepsTheOrderItWasGiven(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	a := f.NewIssue(t, "First created, so the smaller id")
	b := f.NewIssue(t, "Second")
	// Stated rather than assumed: if v7 ids ever stopped being time-ordered this test would
	// go on passing while testing nothing.
	if minUUID(a, b) != a {
		t.Fatalf("the premise fails: %s was created first but is not the smaller id", a)
	}

	// b blocks a: the larger id first, which canonicalisation would have swapped.
	rel, _, err := svc.CreateIssueRelation(ctx, p, b, a, model.RelationBlocks)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if rel.IssueID != b || rel.RelatedIssueID != a {
		t.Fatalf("a blocks relation was reordered: %s blocks %s, want %s blocks %s",
			rel.IssueID, rel.RelatedIssueID, b, a)
	}
}

// An issue in a team the caller cannot reach must answer exactly as one that does not
// exist. Anything else and a relation becomes an existence oracle: link to a guessed id,
// read the error, learn whether a private team has that issue.
func TestCreateIssueRelation_RefusesAnIssueInAnUnreachableTeam(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	mine := f.NewIssue(t, "Mine")
	_, theirs := secondTeam(t, svc, admin, "SEC", "Not yours")

	// A member of the fixture's team only. Not of the team the second issue is in.
	outsider := f.PrincipalFor(f.NewUser(t, "outsider", "member", true), authz.RoleMember, f.TeamID)

	_, _, err := svc.CreateIssueRelation(ctx, outsider, mine, theirs, model.RelationBlocks)
	if err == nil {
		t.Fatal("a relation into an unreachable team was created")
	}
	if got := platform.CodeOf(err); got != platform.CodeNotFound {
		t.Errorf("code = %s, want NOT_FOUND — distinguishing \"not yours\" from \"not there\" is the leak", got)
	}
	// And the message must not name the far issue.
	if strings.Contains(err.Error(), theirs.String()) {
		t.Errorf("the error names the hidden issue: %v", err)
	}
}

func TestDeleteIssueRelation_RemovesTheRowFromBothEnds(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	a := f.NewIssue(t, "Blocker")
	_, b := secondTeam(t, svc, p, "OPS", "Blocked")

	rel, _, err := svc.CreateIssueRelation(ctx, p, a, b, model.RelationBlocks)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id, version, err := svc.DeleteIssueRelation(ctx, p, rel.ID)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if id != rel.ID || version == 0 {
		t.Fatalf("delete returned id %s version %d", id, version)
	}

	forward, err := svc.ListIssueRelations(ctx, p, a)
	if err != nil {
		t.Fatalf("list forward: %v", err)
	}
	reverse, err := svc.ListIssuesBlocking(ctx, p, b)
	if err != nil {
		t.Fatalf("list reverse: %v", err)
	}
	if len(forward) != 0 || len(reverse) != 0 {
		t.Errorf("the link survived the delete: %d forward, %d reverse", len(forward), len(reverse))
	}
}

// --- helpers -------------------------------------------------------------------------

// relationChangeScope reads back the scope the emitter wrote for a relation, because the
// scope is the whole visibility decision and nothing above the change row re-derives it.
func relationChangeScope(t *testing.T, db *store.DB, workspaceID, relationID uuid.UUID) authz.Scope {
	t.Helper()
	rows, err := db.Queries().ReadChangesSince(context.Background(), store.ReadChangesSinceParams{
		WorkspaceID: workspaceID, AfterVersion: 0, ThroughVersion: 1 << 40, PageSize: 200,
	})
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	for _, r := range rows {
		if r.EntityType != "issueRelation" || r.EntityID != relationID {
			continue
		}
		scope, err := authz.ParseScope(r.Scope)
		if err != nil {
			t.Fatalf("parse scope: %v", err)
		}
		return scope
	}
	t.Fatalf("no change row was emitted for relation %s — clients would never learn of it", relationID)
	return authz.Scope{}
}

func containsID(ids []uuid.UUID, want uuid.UUID) bool {
	for _, id := range ids {
		if id == want {
			return true
		}
	}
	return false
}

func minUUID(a, b uuid.UUID) uuid.UUID {
	if a.String() < b.String() {
		return a
	}
	return b
}

func maxUUID(a, b uuid.UUID) uuid.UUID {
	if a.String() < b.String() {
		return b
	}
	return a
}
