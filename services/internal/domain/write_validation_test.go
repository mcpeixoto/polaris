package domain_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Four writes that accepted values the rest of the system cannot use.
//
// Each of these had the same shape: no error at the boundary, and then a wrong answer
// somewhere far away with nothing to trace it back to — a timezone that silently becomes
// UTC in every cycle boundary, a colour that renders as an invisible chip, a name that
// makes a person invisible in every mention, a description that is replayed into every
// bootstrap snapshot in the workspace for ever.

func mustValidation(t *testing.T, field string, err error) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected a validation error naming %q, got nil", field)
	}
	if got := platform.CodeOf(err); got != platform.CodeValidation {
		t.Fatalf("code = %s, want VALIDATION (%v)", got, err)
	}
	var perr *platform.Error
	if !errors.As(err, &perr) {
		t.Fatalf("not a platform error: %v", err)
	}
	if perr.Field != field {
		t.Fatalf("field = %q, want %q (%v)", perr.Field, field, err)
	}
}

// G7 — a typo'd zone was stored happily, and then every cycle boundary, SLA deadline and
// recurring due date for that team was computed in UTC instead: wrong by hours,
// permanently, with no error anybody could ever see. Falling back at read time is right;
// accepting the bad value at write time is not.
func TestCreateTeam_RefusesATimezoneThatIsNotAZone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	_, _, err := svc.CreateTeam(context.Background(), f.Principal(), domain.CreateTeamInput{
		Key: "TZ", Name: "Timezones", Timezone: "Europe/Lisboa",
	})
	mustValidation(t, "timezone", err)
}

func TestCreateTeam_AcceptsARealZoneAndTheDefault(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	if _, _, err := svc.CreateTeam(ctx, f.Principal(), domain.CreateTeamInput{
		Key: "LIS", Name: "Lisbon", Timezone: "Europe/Lisbon",
	}); err != nil {
		t.Fatalf("a real IANA zone was refused: %v", err)
	}
	// Blank still means UTC, which is what every caller that omits it relies on.
	if _, _, err := svc.CreateTeam(ctx, f.Principal(), domain.CreateTeamInput{
		Key: "DEF", Name: "Default",
	}); err != nil {
		t.Fatalf("an omitted timezone was refused: %v", err)
	}
}

func TestUpdateTeam_RefusesATimezoneThatIsNotAZone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	bad := "Mars/Olympus_Mons"
	_, _, err := svc.UpdateTeam(context.Background(), f.Principal(), domain.UpdateTeamInput{
		ID: f.TeamID, Timezone: &bad,
	})
	mustValidation(t, "timezone", err)
}

// G9 — any string at all was accepted as a colour, stored, and shipped to every client,
// which renders an invalid CSS value as a chip that silently disappears.
func TestCreateLabel_RefusesAColourThatIsNotOne(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	for _, bad := range []string{"red", "#ff", "#12345g", "rgb(1,2,3)", "#1234567"} {
		colour := bad
		_, _, err := svc.CreateLabel(ctx, f.Principal(), domain.CreateLabelInput{
			Name: "label-" + bad, Color: &colour,
		})
		if err == nil {
			t.Errorf("%q was accepted as a colour", bad)
			continue
		}
		if got := platform.CodeOf(err); got != platform.CodeValidation {
			t.Errorf("%q gave %s, want VALIDATION", bad, got)
		}
	}
}

func TestCreateLabel_StillAcceptsAHexTripleAndNoColourAtAll(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	good := "#4F46E5"
	if _, _, err := svc.CreateLabel(ctx, p, domain.CreateLabelInput{Name: "indigo", Color: &good}); err != nil {
		t.Fatalf("a hex triple was refused: %v", err)
	}
	// No colour still means "use the product default", which is what the COALESCE in the
	// insert is for.
	if _, _, err := svc.CreateLabel(ctx, p, domain.CreateLabelInput{Name: "plain"}); err != nil {
		t.Fatalf("a label with no colour was refused: %v", err)
	}
	blank := "   "
	if _, _, err := svc.CreateLabel(ctx, p, domain.CreateLabelInput{Name: "blank", Color: &blank}); err != nil {
		t.Fatalf("a blank colour was refused rather than treated as absent: %v", err)
	}
}

func TestCreateLabel_BoundsNameAndDescription(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	_, _, err := svc.CreateLabel(ctx, f.Principal(), domain.CreateLabelInput{
		Name: strings.Repeat("a", 500),
	})
	mustValidation(t, "name", err)

	long := strings.Repeat("b", 5000)
	_, _, err = svc.CreateLabel(ctx, f.Principal(), domain.CreateLabelInput{
		Name: "fine", Description: &long,
	})
	mustValidation(t, "description", err)
}

// G8 — the columns are `text`, so a one-megabyte project description was accepted and then
// replayed into every bootstrap snapshot and every connected socket's change payload for
// that workspace.
func TestCreateProject_BoundsItsFreeTextFields(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	_, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: strings.Repeat("n", 1000), TeamIDs: []uuid.UUID{f.TeamID},
	})
	mustValidation(t, "name", err)

	summary := strings.Repeat("s", 1000)
	_, _, err = svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "fine", Summary: &summary, TeamIDs: []uuid.UUID{f.TeamID},
	})
	mustValidation(t, "summary", err)

	_, _, err = svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "fine", Description: strings.Repeat("d", (1<<20)+1), TeamIDs: []uuid.UUID{f.TeamID},
	})
	mustValidation(t, "description", err)

	icon := strings.Repeat("i", 200)
	_, _, err = svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "fine", Icon: &icon, TeamIDs: []uuid.UUID{f.TeamID},
	})
	mustValidation(t, "icon", err)
}

func TestCreateProject_StillAcceptsOrdinaryText(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	summary := "The sync engine, rewritten."
	icon := "🛰️"
	if _, _, err := svc.CreateProject(context.Background(), f.Principal(), domain.CreateProjectInput{
		Name:        "Sync rewrite",
		Summary:     &summary,
		Description: strings.Repeat("markdown ", 100),
		Icon:        &icon,
		TeamIDs:     []uuid.UUID{f.TeamID},
	}); err != nil {
		t.Fatalf("an ordinary project was refused: %v", err)
	}
}

// G10 — applyInvite tested `displayName == ""` WITHOUT trimming, so " " produced a user who
// is invisible in every mention, avatar and activity feed, on the one call a person makes
// once from an email link.
func TestUpdateProfile_RefusesAWhitespaceOnlyOrOverlongName(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	blank := "   "
	_, _, err := svc.UpdateProfile(ctx, p, domain.UpdateProfileInput{DisplayName: &blank})
	mustValidation(t, "displayName", err)

	long := strings.Repeat("x", 300)
	_, _, err = svc.UpdateProfile(ctx, p, domain.UpdateProfileInput{DisplayName: &long})
	mustValidation(t, "displayName", err)

	_, _, err = svc.UpdateProfile(ctx, p, domain.UpdateProfileInput{Name: &long})
	mustValidation(t, "name", err)
}

func TestUpdateProfile_RefusesATimezoneThatIsNotAZone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	bad := "Not/AZone"
	_, _, err := svc.UpdateProfile(context.Background(), f.Principal(), domain.UpdateProfileInput{
		Timezone: &bad,
	})
	mustValidation(t, "timezone", err)
}

func TestUpdateProfile_StillAcceptsANameAndARealZone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	name := "Miguel"
	zone := "Europe/Lisbon"
	if _, _, err := svc.UpdateProfile(context.Background(), f.Principal(), domain.UpdateProfileInput{
		DisplayName: &name, Timezone: &zone,
	}); err != nil {
		t.Fatalf("an ordinary profile edit was refused: %v", err)
	}
}

// F10 — CreateIssue copied ParentID through verbatim and read nothing off the parent, so a
// sub-issue created without an explicit project or cycle landed in neither even when its
// parent was in both. Breaking work down silently dropped it out of the plan: the project
// tab and the cycle burndown stopped counting the work actually being done.
func TestCreateIssue_SubIssueInheritsTheParentsPlacement(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	project, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Sync rewrite", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("create the project: %v", err)
	}
	parent, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "The parent", ProjectID: &project.ID,
	})
	if err != nil {
		t.Fatalf("create the parent: %v", err)
	}

	child, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "A sub-issue", ParentID: &parent.ID,
	})
	if err != nil {
		t.Fatalf("create the sub-issue: %v", err)
	}
	if child.ProjectID == nil || *child.ProjectID != project.ID {
		t.Fatalf("sub-issue landed in project %v, want the parent's %s", child.ProjectID, project.ID)
	}
}

// Inheritance is a default, not an override: a caller that named a project meant it.
func TestCreateIssue_AnExplicitProjectBeatsTheParents(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	one, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "One", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("create project one: %v", err)
	}
	two, _, err := svc.CreateProject(ctx, p, domain.CreateProjectInput{
		Name: "Two", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("create project two: %v", err)
	}

	parent, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "The parent", ProjectID: &one.ID,
	})
	if err != nil {
		t.Fatalf("create the parent: %v", err)
	}
	child, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "A sub-issue", ParentID: &parent.ID, ProjectID: &two.ID,
	})
	if err != nil {
		t.Fatalf("create the sub-issue: %v", err)
	}
	if child.ProjectID == nil || *child.ProjectID != two.ID {
		t.Fatalf("sub-issue landed in %v, want the project the caller named (%s)", child.ProjectID, two.ID)
	}
}

// A parent in no project leaves the child in none, which is the state it was already in.
func TestCreateIssue_SubIssueOfAnUnplacedParentStaysUnplaced(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	parent, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Loose"})
	if err != nil {
		t.Fatalf("create the parent: %v", err)
	}
	child, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Child", ParentID: &parent.ID,
	})
	if err != nil {
		t.Fatalf("create the sub-issue: %v", err)
	}
	if child.ProjectID != nil {
		t.Fatalf("sub-issue landed in project %v with no parent placement to inherit", *child.ProjectID)
	}
}

// F13 — CreateComment subscribes each mention and UpdateIssue does the same for a rewritten
// description. UpdateComment did neither, so somebody named in an edit got exactly one
// "you were mentioned" row and then heard nothing more about the thread.
func TestUpdateComment_SubscribesSomebodyNamedInTheEdit(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	other := f.NewUser(t, "Other", "member", true)
	issueID := f.NewIssue(t, "Something")

	comment, _, err := svc.CreateComment(ctx, p, domain.CreateCommentInput{
		IssueID: issueID, Body: "no names here",
	})
	if err != nil {
		t.Fatalf("create the comment: %v", err)
	}

	subscribed := func() bool {
		subs, err := svc.ListSubscribersForIssues(ctx, p, []uuid.UUID{issueID})
		if err != nil {
			t.Fatalf("list subscribers: %v", err)
		}
		for _, sub := range subs[issueID] {
			if sub.UserID == other {
				return !sub.Unsubscribed
			}
		}
		return false
	}
	if subscribed() {
		t.Fatal("the mentioned user was already subscribed before the edit")
	}

	if _, _, err := svc.UpdateComment(ctx, p, comment.ID,
		"actually "+mentionToken("Other", other)+" should see this"); err != nil {
		t.Fatalf("edit the comment: %v", err)
	}

	if !subscribed() {
		t.Fatal("somebody named in an edited comment was notified once and never subscribed to the thread")
	}
}

// mentionToken writes the wire form the notify package parses: @[Name](user:<uuid>).
func mentionToken(name string, id uuid.UUID) string {
	return "@[" + name + "](user:" + id.String() + ")"
}
