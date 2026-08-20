package domain_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// What the snapshot carries, for whom, and in what order — the three things a bootstrap can
// get wrong without anything erroring.
//
// restore_stream_test.go asks whether a bootstrap gives one principal everything the change
// stream gave them. The first test here asks the same question of everybody else, because
// the other direction fails silently and expensively: a snapshot that ships MORE than the
// stream would have sent is a way to read a private team's taxonomy, somebody's saved
// filters or somebody's inbox, with no error, no log line and nothing on screen to suggest
// it happened — the client renders what it is given. The second asks whether the snapshot
// carries every type the client replicates, and hands them over in an order that lets a
// client apply rows as they arrive.

// scene is one workspace with every replicated type in it, at every scope that type can
// have, plus four principals standing on different sides of those scopes.
//
// Both tests below need all of it, and a scene assembled twice is two scenes that drift.
type scene struct {
	// alice is the workspace's owner and a member of both teams: the control, who should
	// receive everything.
	alice *authz.Principal
	// bob is a member of the open team only, and the recipient of the one notification.
	bob *authz.Principal
	// greta is a guest in the open team: scoped to it, and never handed workspace-wide rows.
	greta *authz.Principal
	// sam is a member of no team at all, which is what the snapshot's "no teams" branch is.
	sam *authz.Principal

	workspaceLabel, openLabel, privateLabel       uuid.UUID
	workspaceTemplate, privateTemplate            uuid.UUID
	workspaceView, privateTeamView, alicesOwnView uuid.UUID
	alicesPreference                              uuid.UUID
	openIssue, blockedIssue, privateIssue         uuid.UUID
	openDocument                                  uuid.UUID
	openProjectUpdate                             uuid.UUID
	openProjectDependency                         uuid.UUID
	openProjectLabel                              uuid.UUID
	openProjectLabelLink                          uuid.UUID
	openInitiative                                uuid.UUID
	openInitiativeProject                         uuid.UUID
	openCustomer                                  uuid.UUID
	openCustomerRequest                           uuid.UUID
	openSlaRule                                   uuid.UUID
	openDashboard                                 uuid.UUID
	openDashboardTile                             uuid.UUID
	alicesPrivateFavorite, alicesLabelFavorite    uuid.UUID
	bobsFavorite                                  uuid.UUID

	// Everything hanging off an issue that was archived after it was starred, watched and
	// talked about. Archived work is never cached, so a replica that watched the archive
	// dropped all of it — and a snapshot that shipped any of it back would be handing over
	// rows whose issue it deliberately left out.
	archivedIssue                            uuid.UUID
	archivedFavorite, archivedNotification   uuid.UUID
	archivedSubscription, archivedIssueLabel uuid.UUID

	// Retired taxonomy and a deleted view. Both reach clients as a delete, so every replica
	// has already thrown its copy away and a snapshot that shipped one would put it back —
	// into the picker, the sidebar and the filters, out of nowhere, on one person's machine.
	retiredLabel, retiredTemplate, deletedView uuid.UUID
}

func newScene(t *testing.T, ctx context.Context, svc *domain.Service, f *testutil.Fixture) scene {
	t.Helper()

	bobID := f.NewUser(t, "bob", "member", true)
	gretaID := f.NewUser(t, "greta", "guest", true)
	samID := f.NewUser(t, "sam", "member", false)

	s := scene{
		bob:   f.PrincipalFor(bobID, authz.RoleMember, f.TeamID),
		greta: f.PrincipalFor(gretaID, authz.RoleGuest, f.TeamID),
		sam:   f.PrincipalFor(samID, authz.RoleMember),
	}

	design, _, err := svc.CreateTeam(ctx, f.Principal(), domain.CreateTeamInput{
		Key: "DES", Name: "Design", Private: true,
	})
	if err != nil {
		t.Fatalf("create the private team: %v", err)
	}

	// CreateTeam makes its caller a member, but a Principal is assembled at the entry point
	// and never re-read below it — so alice needs one that knows about the team she has just
	// made, exactly as her next request would carry.
	s.alice = f.PrincipalFor(f.UserID, authz.RoleOwner, f.TeamID, design.ID)

	label := func(name string, teamID *uuid.UUID) uuid.UUID {
		row, _, err := svc.CreateLabel(ctx, s.alice, domain.CreateLabelInput{TeamID: teamID, Name: name})
		if err != nil {
			t.Fatalf("create label %q: %v", name, err)
		}
		return row.ID
	}
	s.workspaceLabel = label("Regression", nil)
	s.openLabel = label("Flaky", &f.TeamID)
	s.privateLabel = label("Needs a mock", &design.ID)

	template := func(name string, teamID *uuid.UUID) uuid.UUID {
		row, _, err := svc.CreateIssueTemplate(ctx, s.alice, domain.CreateIssueTemplateInput{
			TeamID: teamID, Name: name,
		})
		if err != nil {
			t.Fatalf("create template %q: %v", name, err)
		}
		return row.ID
	}
	s.workspaceTemplate = template("Incident", nil)
	s.privateTemplate = template("Design review", &design.ID)

	formTemplate := func(name string, teamID *uuid.UUID) uuid.UUID {
		row, _, err := svc.CreateFormTemplate(ctx, s.alice, domain.CreateFormTemplateInput{
			TeamID: teamID, Name: name,
		})
		if err != nil {
			t.Fatalf("create form template %q: %v", name, err)
		}
		if _, _, err := svc.CreateFormTemplateField(ctx, s.alice, domain.CreateFormTemplateFieldInput{
			FormTemplateID: row.ID,
			FieldType:      model.FormFieldText,
			Label:          "Details",
		}); err != nil {
			t.Fatalf("create form template field for %q: %v", name, err)
		}
		return row.ID
	}
	formTemplate("Bug intake", nil)
	formTemplate("Design intake", &design.ID)

	projectTemplate := func(name string, teamID *uuid.UUID) uuid.UUID {
		row, _, err := svc.CreateProjectTemplate(ctx, s.alice, domain.CreateProjectTemplateInput{
			TeamID: teamID, Name: name, Summary: "Default summary",
		})
		if err != nil {
			t.Fatalf("create project template %q: %v", name, err)
		}
		if _, _, err := svc.CreateProjectTemplateMilestone(ctx, s.alice, domain.CreateProjectTemplateMilestoneInput{
			ProjectTemplateID: row.ID, Name: "Milestone",
		}); err != nil {
			t.Fatalf("create project template milestone for %q: %v", name, err)
		}
		if _, _, err := svc.CreateProjectTemplateIssue(ctx, s.alice, domain.CreateProjectTemplateIssueInput{
			ProjectTemplateID: row.ID, Title: "Starter issue",
		}); err != nil {
			t.Fatalf("create project template issue for %q: %v", name, err)
		}
		return row.ID
	}
	projectTemplate("Product launch", nil)
	projectTemplate("Design rollout", &design.ID)

	project, _, err := svc.CreateProject(ctx, s.alice, domain.CreateProjectInput{
		Name: "Shipping", TeamIDs: []uuid.UUID{f.TeamID}, MemberIDs: []uuid.UUID{s.alice.UserID},
	})
	if err != nil {
		t.Fatalf("create the open project: %v", err)
	}
	if _, _, err := svc.CreateProjectMilestone(ctx, s.alice, domain.CreateProjectMilestoneInput{
		ProjectID: project.ID, Name: "Beta",
	}); err != nil {
		t.Fatalf("create the milestone: %v", err)
	}

	on := true
	if _, _, err := svc.UpdateTeamCycles(ctx, s.alice, domain.UpdateTeamCyclesInput{
		TeamID: f.TeamID, Enabled: &on,
	}); err != nil {
		t.Fatalf("enable cycles: %v", err)
	}

	if _, _, err := svc.CreateRecurringIssue(ctx, s.alice, domain.CreateRecurringIssueInput{
		TeamID:       f.TeamID,
		Title:        "Weekly status",
		Cadence:      model.CadenceWeekly,
		FirstDueDate: "2026-09-01",
	}); err != nil {
		t.Fatalf("create the recurring schedule: %v", err)
	}

	view := func(in domain.CreateViewInput) uuid.UUID {
		row, _, err := svc.CreateView(ctx, s.alice, in)
		if err != nil {
			t.Fatalf("create view %q: %v", in.Name, err)
		}
		return row.ID
	}
	s.workspaceView = view(domain.CreateViewInput{Name: "Everything open"})
	s.privateTeamView = view(domain.CreateViewInput{TeamID: &design.ID, Name: "Design backlog"})
	// Alice's own, which no admin and no teammate may see. Anchored to the OPEN team on
	// purpose: a snapshot that judged a private view by its team rather than by its owner
	// would hand it to bob, who is in that team.
	s.alicesOwnView = view(domain.CreateViewInput{TeamID: &f.TeamID, Private: true, Name: "Only mine"})

	preference, _, err := svc.SetViewPreference(ctx, s.alice, "my-issues",
		json.RawMessage(`{"grouping":"status"}`))
	if err != nil {
		t.Fatalf("set alice's view preference: %v", err)
	}
	s.alicesPreference = preference.ID
	if _, _, err := svc.SetViewPreference(ctx, s.bob, "my-issues",
		json.RawMessage(`{"grouping":"assignee"}`)); err != nil {
		t.Fatalf("set bob's view preference: %v", err)
	}

	issue := func(teamID uuid.UUID, title string) uuid.UUID {
		row, _, err := svc.CreateIssue(ctx, s.alice, domain.CreateIssueInput{TeamID: teamID, Title: title})
		if err != nil {
			t.Fatalf("create issue %q: %v", title, err)
		}
		return row.ID
	}
	s.openIssue = issue(f.TeamID, "Something everybody in the team can see")
	s.blockedIssue = issue(f.TeamID, "Waiting on the one above")
	s.privateIssue = issue(design.ID, "Something only the design team can see")

	if _, _, err := svc.AddIssueLabel(ctx, s.alice, s.openIssue, s.openLabel); err != nil {
		t.Fatalf("apply the open label: %v", err)
	}
	if _, _, err := svc.AddIssueLabel(ctx, s.alice, s.privateIssue, s.privateLabel); err != nil {
		t.Fatalf("apply the private label: %v", err)
	}
	if _, _, err := svc.CreateIssueRelation(ctx, s.alice, s.openIssue, s.blockedIssue,
		model.RelationBlocks); err != nil {
		t.Fatalf("create the relation: %v", err)
	}
	if _, _, err := svc.CreateAttachment(ctx, s.alice, domain.CreateAttachmentInput{
		IssueID: s.openIssue, URL: "https://github.com/acme/app/pull/1", Title: "PR 1",
	}); err != nil {
		t.Fatalf("create the attachment: %v", err)
	}
	doc, _, err := svc.CreateDocument(ctx, s.alice, domain.CreateDocumentInput{
		TeamID: f.TeamID, Title: "Team runbook", Body: "How we ship",
	})
	if err != nil {
		t.Fatalf("create the document: %v", err)
	}
	s.openDocument = doc.ID

	update, _, err := svc.CreateProjectUpdate(ctx, s.alice, domain.CreateProjectUpdateInput{
		ProjectID: project.ID,
		Health:    model.ProjectUpdateHealthOnTrack,
		Body:      "Shipping on schedule",
	})
	if err != nil {
		t.Fatalf("create the project update: %v", err)
	}
	s.openProjectUpdate = update.ID

	init, _, err := svc.CreateInitiative(ctx, s.alice, domain.CreateInitiativeInput{
		Name: "Platform reliability",
	})
	if err != nil {
		t.Fatalf("create the initiative: %v", err)
	}
	s.openInitiative = init.ID
	link, _, err := svc.AddInitiativeProject(ctx, s.alice, init.ID, project.ID)
	if err != nil {
		t.Fatalf("link the project: %v", err)
	}
	s.openInitiativeProject = link.ID

	cust, _, err := svc.CreateCustomer(ctx, s.alice, domain.CreateCustomerInput{Name: "Acme"})
	if err != nil {
		t.Fatalf("create the customer: %v", err)
	}
	s.openCustomer = cust.ID
	need, _, err := svc.CreateCustomerRequest(ctx, s.alice, domain.CreateCustomerRequestInput{
		CustomerID: &cust.ID, IssueID: &s.openIssue, Body: "Need SSO",
	})
	if err != nil {
		t.Fatalf("create the customer request: %v", err)
	}
	s.openCustomerRequest = need.ID

	urgent := int32(1440)
	sla, _, err := svc.CreateSlaRule(ctx, s.alice, domain.CreateSlaRuleInput{
		Filter:          json.RawMessage(`{"field":"priority","op":"eq","values":["1"]}`),
		Action:          model.SlaActionApply,
		DurationMinutes: &urgent,
	})
	if err != nil {
		t.Fatalf("create the sla rule: %v", err)
	}
	s.openSlaRule = sla.ID

	dash, _, err := svc.CreateDashboard(ctx, s.alice, domain.CreateDashboardInput{Name: "Delivery"})
	if err != nil {
		t.Fatalf("create the dashboard: %v", err)
	}
	s.openDashboard = dash.ID
	tile, _, err := svc.CreateDashboardTile(ctx, s.alice, domain.CreateDashboardTileInput{
		DashboardID: dash.ID,
		Title:       "Cycle time",
		Measure:     model.DashboardMeasureCycleTime,
		Slice:       model.DashboardSliceTeam,
	})
	if err != nil {
		t.Fatalf("create the dashboard tile: %v", err)
	}
	s.openDashboardTile = tile.ID

	blocker, _, err := svc.CreateProject(ctx, s.alice, domain.CreateProjectInput{
		Name: "Platform foundation", TeamIDs: []uuid.UUID{f.TeamID},
	})
	if err != nil {
		t.Fatalf("create the blocking project: %v", err)
	}
	dep, _, err := svc.AddProjectDependency(ctx, s.alice, blocker.ID, project.ID)
	if err != nil {
		t.Fatalf("create the project dependency: %v", err)
	}
	s.openProjectDependency = dep.ID

	pl, _, err := svc.CreateProjectLabel(ctx, s.alice, domain.CreateProjectLabelInput{
		Name: "Platform",
	})
	if err != nil {
		t.Fatalf("create the project label: %v", err)
	}
	s.openProjectLabel = pl.ID
	linkRow, _, err := svc.AddProjectLabel(ctx, s.alice, project.ID, pl.ID)
	if err != nil {
		t.Fatalf("apply the project label: %v", err)
	}
	s.openProjectLabelLink = linkRow.ID

	if _, _, _, err := svc.CreateGitHubConnection(ctx, s.alice, domain.CreateGitHubConnectionInput{
		OrgLogin: ptr("acme"),
	}); err != nil {
		t.Fatalf("connect GitHub: %v", err)
	}
	if _, _, err := svc.CreateGitHubUserLink(ctx, s.bob, domain.CreateGitHubUserLinkInput{
		GitHubLogin: "bob",
	}); err != nil {
		t.Fatalf("link bob's GitHub account: %v", err)
	}

	// Favourites: alice pins something out of the private team and something workspace-wide,
	// bob pins the team they share. A favourite carries only its owner's scope, which is what
	// makes it the type most easily shipped to the wrong replica.
	s.alicesPrivateFavorite = favorite(t, ctx, svc, s.alice, model.FavoriteIssue, s.privateIssue)
	s.alicesLabelFavorite = favorite(t, ctx, svc, s.alice, model.FavoriteLabel, s.workspaceLabel)
	s.bobsFavorite = favorite(t, ctx, svc, s.bob, model.FavoriteTeam, f.TeamID)

	// Subscriptions and an inbox. Alice's comment names bob, which subscribes him and puts a
	// row in his inbox — the engine never notifies the actor, so nothing alice does can
	// produce one for herself.
	if _, _, err := svc.SetIssueSubscription(ctx, s.alice, s.openIssue, true); err != nil {
		t.Fatalf("subscribe alice: %v", err)
	}
	if _, _, err := svc.CreateComment(ctx, s.alice, domain.CreateCommentInput{
		IssueID: s.openIssue,
		Body:    fmt.Sprintf("@[bob](user:%s) could you look at this", bobID),
	}); err != nil {
		t.Fatalf("create the mention: %v", err)
	}
	// A comment inside the private team too, so the comment stream has something to withhold.
	if _, _, err := svc.CreateComment(ctx, s.alice, domain.CreateCommentInput{
		IssueID: s.privateIssue, Body: "Said inside the private team",
	}); err != nil {
		t.Fatalf("comment on the private issue: %v", err)
	}

	// An issue in the open team that accumulates a star, a watcher, a label and an inbox row
	// before being archived. Archived work is never cached, and each of those four rows is
	// carried by a stream that has to say so for itself — a join on the issue for the label,
	// the subscription and the notification, and the target check for the favourite. Without
	// them the snapshot ships rows whose issue it left out, which is the same shape of bug as
	// an application pointing at a label the replica has never seen.
	s.archivedIssue = issue(f.TeamID, "Finished, and put away")
	applied, _, err := svc.AddIssueLabel(ctx, s.alice, s.archivedIssue, s.openLabel)
	if err != nil {
		t.Fatalf("label the issue that gets archived: %v", err)
	}
	s.archivedIssueLabel = applied.ID
	s.archivedFavorite = favorite(t, ctx, svc, s.alice, model.FavoriteIssue, s.archivedIssue)
	subscription, _, err := svc.SetIssueSubscription(ctx, s.alice, s.archivedIssue, true)
	if err != nil {
		t.Fatalf("watch the issue that gets archived: %v", err)
	}
	s.archivedSubscription = subscription.ID
	if _, _, err := svc.CreateComment(ctx, s.bob, domain.CreateCommentInput{
		IssueID: s.archivedIssue,
		Body:    fmt.Sprintf("@[dev](user:%s) closing this off", f.UserID),
	}); err != nil {
		t.Fatalf("mention alice on the issue that gets archived: %v", err)
	}

	// Before the archive, so that the inbox row exists to be dropped by it. A fan-out that
	// ran afterwards would deliver a notification about an issue no replica holds, which is
	// its own bug and not this one.
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}
	for _, n := range inbox(t, svc, s.alice) {
		if n.IssueID != nil && *n.IssueID == s.archivedIssue {
			s.archivedNotification = n.ID
		}
	}
	if s.archivedNotification == uuid.Nil {
		t.Fatalf("the mention on the issue about to be archived produced no notification, so " +
			"the assertions about one would pass by checking nothing")
	}
	if _, err := svc.ArchiveIssue(ctx, s.alice, s.archivedIssue, true); err != nil {
		t.Fatalf("archive: %v", err)
	}

	// A label, a template and a view that were retired after everybody had already seen them.
	s.retiredLabel = label("Wontfix", &f.TeamID)
	if _, err := svc.ArchiveLabel(ctx, s.alice, s.retiredLabel, true); err != nil {
		t.Fatalf("archive the label: %v", err)
	}
	s.retiredTemplate = template("Old runbook", &f.TeamID)
	if _, _, err := svc.ArchiveIssueTemplate(ctx, s.alice, s.retiredTemplate, true); err != nil {
		t.Fatalf("archive the template: %v", err)
	}
	s.deletedView = view(domain.CreateViewInput{TeamID: &f.TeamID, Name: "No longer used"})
	if _, _, err := svc.DeleteView(ctx, s.alice, s.deletedView); err != nil {
		t.Fatalf("delete the view: %v", err)
	}
	return s
}

// favorite pins something and returns the row's id, which is what the change stream and the
// snapshot both address it by — the caller only knows what it pointed at.
func favorite(
	t *testing.T, ctx context.Context, svc *domain.Service,
	p *authz.Principal, kind string, target uuid.UUID,
) uuid.UUID {
	t.Helper()
	row, _, err := svc.AddFavorite(ctx, p, kind, target, nil)
	if err != nil {
		t.Fatalf("favourite the %s: %v", kind, err)
	}
	return row.ID
}

func ptr[T any](v T) *T { return &v }

// The snapshot must hand every principal exactly what the socket would have handed them.
//
// The test is the same comparison run for four principals rather than a list of things that
// must not appear. A list goes stale the moment a type is added; the comparison covers
// whatever the two sides carry, and it is exactly the property that matters. replayReplica
// filters with SyncChange.Visible, which is the hub's own predicate, so the right-hand side
// of each comparison is what the socket would actually have delivered.
//
// The named absences afterwards are redundant with it, and kept anyway: when the comparison
// fails it prints two lists of uuids, and the assertions after it say in words which rule
// broke.
func TestStreamBootstrap_GivesEachPrincipalWhatTheStreamWouldHaveSent(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	s := newScene(t, ctx, svc, f)

	const (
		aliceName = "alice, in both teams"
		bobName   = "bob, in the open team only"
		gretaName = "greta, a guest in the open team"
		samName   = "sam, a member of no team"
	)
	people := []struct {
		name string
		p    *authz.Principal
	}{
		{aliceName, s.alice}, {bobName, s.bob}, {gretaName, s.greta}, {samName, s.sam},
	}

	snapshots := map[string]map[string]map[uuid.UUID]bool{}
	for _, who := range people {
		streamed := replayReplica(t, ctx, svc, who.p)
		snapshot := bootstrapReplica(t, ctx, svc, who.p)
		snapshots[who.name] = snapshot

		for _, entityType := range replayedTypes {
			got := sortedIDs(snapshot[entityType])
			want := sortedIDs(streamed[entityType])
			if !slices.Equal(got, want) {
				t.Errorf("the snapshot and the change stream disagree about which %s rows "+
					"%s may hold.\n  bootstrapped: %v\n  streamed:     %v\n\n"+
					"Both sides answer the same question, and only one of them is the "+
					"authorisation this product documents. A snapshot holding more is a way to "+
					"read what the hub refuses to send; holding less is two clients disagreeing "+
					"about one workspace with nothing erroring.",
					entityType, who.name, got, want)
			}
		}
	}

	// The rules the comparison enforces, said in words so that a failure names one.
	for _, absent := range []struct {
		who        string
		entityType string
		id         uuid.UUID
		rule       string
	}{
		{bobName, "label", s.privateLabel, "a private team's labels are that team's"},
		{bobName, "issueTemplate", s.privateTemplate, "a private team's templates are that team's"},
		{bobName, "view", s.privateTeamView, "a private team's saved views are that team's"},
		{bobName, "issue", s.privateIssue, "a private team's issues are that team's"},
		{bobName, "view", s.alicesOwnView,
			"a private view belongs to its owner, whatever team it is anchored to"},
		{bobName, "viewPreference", s.alicesPreference,
			"how somebody arranges their own screen is theirs"},
		{bobName, "favorite", s.alicesPrivateFavorite, "a sidebar is one person's"},
		{bobName, "favorite", s.alicesLabelFavorite,
			"a sidebar is one person's, even when what it points at is workspace-wide"},

		{gretaName, "label", s.workspaceLabel,
			"a guest is scoped to their teams and never receives workspace-wide entities"},
		{gretaName, "issueTemplate", s.workspaceTemplate,
			"a guest is scoped to their teams and never receives workspace-wide entities"},
		{gretaName, "view", s.workspaceView,
			"a guest is scoped to their teams and never receives workspace-wide entities"},
		{gretaName, "customer", s.openCustomer,
			"a guest sees nothing related to customers"},
		{gretaName, "customerRequest", s.openCustomerRequest,
			"a guest sees nothing related to customer requests"},
		{gretaName, "slaRule", s.openSlaRule,
			"a guest sees nothing related to SLA rules"},
		{gretaName, "dashboard", s.openDashboard,
			"a guest sees nothing related to dashboards"},
		{gretaName, "dashboardTile", s.openDashboardTile,
			"a guest sees nothing related to dashboard tiles"},

		{samName, "issue", s.openIssue, "team content needs the team"},
		{samName, "label", s.openLabel, "a team's label needs the team"},
		{samName, "favorite", s.bobsFavorite, "a sidebar is one person's"},

		// Archived work is never cached, so nothing hanging off it may be either. Each of
		// these is a different stream's join or target check, and each of them is invisible
		// when it is missing: the row arrives, the client stores it, and it points at an
		// issue the snapshot deliberately did not send.
		{aliceName, "issue", s.archivedIssue, "an archived issue is never cached"},
		{aliceName, "issueLabel", s.archivedIssueLabel,
			"an application whose issue the snapshot left out is a chip on a row nobody holds"},
		{aliceName, "favorite", s.archivedFavorite,
			"a favourite whose target the snapshot left out is a sidebar row that opens nothing"},
		{aliceName, "issueSubscription", s.archivedSubscription,
			"a subscription to an issue the snapshot left out cannot be turned off from the app"},
		{aliceName, "notification", s.archivedNotification,
			"an inbox row about an issue the snapshot left out opens nothing"},

		// Retiring one of these reaches clients as a delete, so the snapshot has to agree
		// that it is gone. Shipping it back is how a label somebody retired reappears in
		// everybody's picker after a reload and nowhere else.
		{aliceName, "label", s.retiredLabel, "an archived label reached every client as a delete"},
		{aliceName, "issueTemplate", s.retiredTemplate,
			"an archived template reached every client as a delete"},
		{aliceName, "view", s.deletedView, "a deleted view reached every client as a delete"},
	} {
		if snapshots[absent.who][absent.entityType][absent.id] {
			t.Errorf("the snapshot for %s carries %s %s — %s",
				absent.who, absent.entityType, absent.id, absent.rule)
		}
	}

	// And present where they should be, so that none of the above passes because the scene
	// shipped nothing to anybody.
	for _, present := range []struct {
		who        string
		entityType string
		id         uuid.UUID
	}{
		{aliceName, "label", s.privateLabel},
		{aliceName, "issueTemplate", s.privateTemplate},
		{aliceName, "view", s.alicesOwnView},
		{aliceName, "viewPreference", s.alicesPreference},
		{aliceName, "favorite", s.alicesPrivateFavorite},
		{aliceName, "issue", s.privateIssue},
		{bobName, "label", s.workspaceLabel},
		{bobName, "issue", s.openIssue},
		{bobName, "document", s.openDocument},
		{bobName, "projectUpdate", s.openProjectUpdate},
		{bobName, "projectDependency", s.openProjectDependency},
		{bobName, "projectLabel", s.openProjectLabel},
		{bobName, "projectLabelLink", s.openProjectLabelLink},
		{bobName, "initiative", s.openInitiative},
		{bobName, "initiativeProject", s.openInitiativeProject},
		{bobName, "customer", s.openCustomer},
		{bobName, "customerRequest", s.openCustomerRequest},
		{bobName, "slaRule", s.openSlaRule},
		{bobName, "dashboard", s.openDashboard},
		{bobName, "dashboardTile", s.openDashboardTile},
		{bobName, "favorite", s.bobsFavorite},
		{gretaName, "label", s.openLabel},
		{gretaName, "issue", s.openIssue},
		{gretaName, "document", s.openDocument},
		{gretaName, "projectUpdate", s.openProjectUpdate},
		{gretaName, "projectDependency", s.openProjectDependency},
		{gretaName, "projectLabel", s.openProjectLabel},
		{gretaName, "projectLabelLink", s.openProjectLabelLink},
		{gretaName, "initiative", s.openInitiative},
		{gretaName, "initiativeProject", s.openInitiativeProject},
		{samName, "label", s.workspaceLabel},
		{samName, "issueTemplate", s.workspaceTemplate},
		{samName, "view", s.workspaceView},
		{samName, "customer", s.openCustomer},
		{samName, "slaRule", s.openSlaRule},
		{samName, "dashboard", s.openDashboard},
		{samName, "dashboardTile", s.openDashboardTile},
	} {
		if !snapshots[present.who][present.entityType][present.id] {
			t.Errorf("the snapshot for %s is missing the %s %s it is entitled to",
				present.who, present.entityType, present.id)
		}
	}

	// Bob's inbox reached him and nobody else's did. The inbox is the one type where both
	// halves of the rule are invisible from the server: the rows are right, the screen is
	// right, and the only symptom of getting it wrong is somebody reading somebody else's
	// notifications.
	//
	// Alice's count is zero rather than absent from the table: she was mentioned too, on the
	// issue that was then archived, so her one inbox row is exactly the row the issue join is
	// there to withhold.
	if got := len(snapshots[bobName]["notification"]); got != 1 {
		t.Errorf("bob's snapshot holds %d notifications, want the one the mention produced", got)
	}
	for _, who := range []string{aliceName, gretaName, samName} {
		if n := len(snapshots[who]["notification"]); n != 0 {
			t.Errorf("the snapshot for %s carries %d notifications; the only inbox row this "+
				"workspace has that is still about a cached issue is bob's", who, n)
		}
	}
}

// Every type the client replicates has to be in the snapshot, and they have to arrive in the
// order the client's dependencies run.
//
// Both halves have been wrong here. The snapshot shipped nine of the sixteen types, so a
// freshly bootstrapped replica had no labels, no saved views, no favourites, no templates, no
// subscriptions and an empty inbox until an unrelated delta happened to carry one — which is
// worse than empty, because it looks like data loss and then silently repairs itself. And
// issueLabel was shipped while label was not, so the replica held label applications pointing
// at labels it had never seen: a chip that is not a label, rendered from a row the snapshot
// itself supplied.
//
// The expected order is read out of the client rather than written down here. It is one list
// in two languages and there is no compiler across that boundary, so a copy in this file
// would be a third place to forget — the same reasoning as the schema pin in
// internal/syncsrv.
func TestStreamBootstrap_CarriesEveryReplicatedTypeInTheClientsOrder(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	s := newScene(t, ctx, svc, f)

	want := clientEntityTypesInOrder(t)

	// Bob, because he is the one principal in the scene who holds a row of every type: a
	// guest receives no workspace-wide entities and alice, as the actor throughout, is the
	// one person the notification engine will never write to.
	order := &orderingBootstrap{}
	if err := svc.StreamBootstrap(ctx, s.bob, order); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}

	if missing := missingFrom(want, order.types); len(missing) > 0 {
		t.Errorf("the snapshot carries no %v.\n\nThe client replicates %d types and this "+
			"scene holds a row of each, so a type absent here is a type a freshly "+
			"bootstrapped replica simply does not have — every screen built on it reads empty "+
			"on first load and fills in later, which looks like data loss.", missing, len(want))
	}

	// A subsequence rather than equality: the snapshot legitimately omits a type this
	// workspace has no rows of, and asserting equality would make this test a second
	// statement of the entity list instead of a statement about the order.
	if !isSubsequence(order.types, want) {
		t.Errorf("the snapshot emits types in the order %v, which is not the client's "+
			"dependency order %v.\n\n"+
			"The client applies rows as they arrive and renders progressively, so a row must "+
			"never reach it before the row it names: an application before its label draws a "+
			"chip with no name on it, and an issue before its template names a template the "+
			"replica does not hold. Nothing errors when this is wrong.",
			order.types, want)
	}

	// The specific inversion that was shipped, named so that a regression reads as itself
	// rather than as a list of sixteen strings.
	if position(order.types, "issueLabel") < position(order.types, "label") {
		t.Error("label applications are emitted before the labels they name — the exact " +
			"ordering bug this snapshot had, arrived at from the other direction")
	}
	if position(order.types, "projectLabelLink") < position(order.types, "projectLabel") {
		t.Error("project label applications are emitted before the project labels they name")
	}
}

// The inbox is the one table in the snapshot that grows forever, and the only stream with a
// ceiling on it.
//
// Every other stream is bounded by something a person maintains. This one is bounded by the
// fan-out, which writes a row per recipient per event and never removes one — so on a
// two-year-old workspace an unbounded inbox is not a slow first load, it is the first load,
// with the whole history of somebody's notifications on the wire before they can see a single
// issue. The cap is a product decision (see domain.bootstrapNotificationLimit) and the thing
// that makes it safe is which rows it keeps: the most recent, in the order the inbox itself
// renders in.
//
// The rows are inserted directly rather than fanned out. What is under test is the ceiling,
// and producing two thousand inbox rows through the engine is minutes of comments — so this
// is the one test in the file whose scene is not on the change stream, and it is therefore
// deliberately not part of the replay comparison above.
func TestStreamBootstrap_CapsTheInboxItCarries(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	issueID := f.NewIssue(t, "The one everybody keeps talking about")

	const rows = 2050
	if _, err := db.Pool().Exec(ctx, `
		INSERT INTO notification (id, workspace_id, user_id, type, issue_id, actor_type,
		                          change_version, group_key, created_at)
		SELECT gen_random_uuid(), $1, $2, 'comment', $3, 'system', i, 'k' || i,
		       now() - (i || ' minutes')::interval
		FROM generate_series(1, $4) AS i`,
		f.WorkspaceID, f.UserID, issueID, rows); err != nil {
		t.Fatalf("insert the inbox: %v", err)
	}

	snapshot := bootstrapReplica(t, ctx, svc, p)
	if got := len(snapshot["notification"]); got != domain.BootstrapNotificationLimit {
		t.Fatalf("the snapshot carries %d of %d inbox rows, want the cap of %d",
			got, rows, domain.BootstrapNotificationLimit)
	}

	// And it kept the recent end. A cap that took the oldest rows would be a bootstrap that
	// hands somebody an inbox of things they dealt with two years ago and none of this week's,
	// which is worse than shipping nothing: the badge would be right and the list wrong.
	var oldest []uuid.UUID
	stale, err := db.Pool().Query(ctx,
		`SELECT id FROM notification WHERE user_id = $1 ORDER BY created_at ASC LIMIT $2`,
		f.UserID, rows-domain.BootstrapNotificationLimit)
	if err != nil {
		t.Fatalf("read the oldest: %v", err)
	}
	for stale.Next() {
		var id uuid.UUID
		if err := stale.Scan(&id); err != nil {
			t.Fatal(err)
		}
		oldest = append(oldest, id)
	}
	stale.Close()
	for _, id := range oldest {
		if snapshot["notification"][id] {
			t.Errorf("the snapshot dropped recent inbox rows and kept %s, which is one of the "+
				"oldest — the cap is meant to take the end of the inbox somebody is looking at", id)
		}
	}
}

// orderingBootstrap records the order entity types first appear in, and nothing else.
type orderingBootstrap struct {
	types []string
	seen  map[string]bool
}

func (o *orderingBootstrap) Meta(int64, int) error { return nil }

func (o *orderingBootstrap) Entity(entityType string, _ uuid.UUID, _ any) error {
	if o.seen == nil {
		o.seen = map[string]bool{}
	}
	if !o.seen[entityType] {
		o.seen[entityType] = true
		o.types = append(o.types, entityType)
	}
	return nil
}

// clientEntityTypesInOrder is ENTITY_TYPES, read out of the client's own source, in the
// order it is written in.
//
// change_scope_test.go reads the same constant and sorts it, because the question there is
// which types exist. The order is the whole question here — the list is written in
// dependency order and says so — so it cannot share that helper, and a sorted copy would
// turn this test into an assertion about the alphabet.
func clientEntityTypesInOrder(t *testing.T) []string {
	t.Helper()
	const relative = "../../../web/src/store/types.ts"

	source, err := os.ReadFile(filepath.Clean(relative))
	if err != nil {
		// A hard failure rather than a skip. A skip would be silent in CI on the day somebody
		// moved the file, which is exactly when this stops holding.
		t.Fatalf("cannot read the client's entity list at %s: %v", relative, err)
	}

	block := regexp.MustCompile(`(?s)export const ENTITY_TYPES:[^=]*=\s*\[(.*?)\]`).FindSubmatch(source)
	if block == nil {
		t.Fatalf("no `export const ENTITY_TYPES = [...]` in %s — if it was renamed, this test "+
			"has to be taught the new name rather than deleted", relative)
	}

	var types []string
	for _, m := range regexp.MustCompile(`'([a-zA-Z]+)'`).FindAllSubmatch(block[1], -1) {
		types = append(types, string(m[1]))
	}
	if len(types) == 0 {
		t.Fatalf("ENTITY_TYPES in %s parsed to nothing", relative)
	}
	return types
}

func missingFrom(want, got []string) []string {
	var missing []string
	for _, w := range want {
		if !slices.Contains(got, w) {
			missing = append(missing, w)
		}
	}
	return missing
}

// isSubsequence reports whether got appears within want in order, skipping is allowed.
func isSubsequence(got, want []string) bool {
	i := 0
	for _, w := range want {
		if i < len(got) && got[i] == w {
			i++
		}
	}
	return i == len(got)
}

func position(types []string, want string) int {
	return slices.Index(types, want)
}
