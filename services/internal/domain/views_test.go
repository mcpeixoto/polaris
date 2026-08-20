package domain_test

import (
	"context"
	"encoding/json"
	"errors"
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

// A saved view holds a filter that will be compiled to SQL months from now, by somebody
// else's request, on behalf of somebody who has left. The only moment anybody can act on a
// filter the compiler cannot read is the moment it is saved — after that it is a view that
// fails every time it is opened and nothing on the screen says why.
func TestCreateView_AFilterTheCompilerCannotReadIsRefusedAtSaveTime(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	cases := []struct {
		name   string
		filter string
		// names is the part of the filter the message has to quote back. A refusal that
		// does not say which of a dozen clauses is wrong sends the author guessing.
		names string
	}{
		{"a misspelled field", `{"conj":"and","nodes":[{"field":"asignee","op":"eq","values":["x"]}]}`, "asignee"},
		{"an operator the field's type does not support", `{"field":"assignee","op":"contains","values":["x"]}`, "contains"},
		{"a misspelled key, which would otherwise read as an empty group matching everything", `{"feild":"assignee","op":"eq","values":["x"]}`, "feild"},
		{"a value of the wrong type", `{"field":"priority","op":"eq","values":["urgent"]}`, "urgent"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := svc.CreateView(ctx, admin, domain.CreateViewInput{
				Name:   "Broken",
				Filter: json.RawMessage(tc.filter),
			})
			if err == nil {
				t.Fatal("the view was saved with a filter the compiler rejects")
			}
			if code := platform.CodeOf(err); code != platform.CodeValidation {
				t.Fatalf("got code %s (%v), want VALIDATION — this is something the author can fix", code, err)
			}
			var perr *platform.Error
			if errors.As(err, &perr) && perr.Field != "filter" {
				t.Errorf("error is attached to field %q, want %q so the client can mark the right control", perr.Field, "filter")
			}
			if !strings.Contains(err.Error(), tc.names) {
				t.Errorf("message %q does not name %q, so the author cannot tell which clause is wrong", err.Error(), tc.names)
			}
		})
	}

	views, err := svc.ListViews(ctx, admin)
	if err != nil {
		t.Fatalf("list views: %v", err)
	}
	if len(views) != 0 {
		t.Fatalf("%d views were stored despite every filter being rejected", len(views))
	}
}

// The same rule on the way in applies on the way out: a view saved with a good filter and
// then edited into a bad one is the same broken saved view, arriving a week later. The
// stored filter must survive the refusal untouched.
func TestUpdateView_RevalidatesTheFilterAndKeepsTheOldOneOnRefusal(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	good := `{"conj":"and","nodes":[{"field":"stateCategory","op":"in","values":["started"]}]}`
	view := mustView(t, svc, admin, domain.CreateViewInput{
		Name:   "In flight",
		Filter: json.RawMessage(good),
	})

	_, _, err := svc.UpdateView(ctx, admin, domain.UpdateViewInput{
		ID:     view.ID,
		Filter: json.RawMessage(`{"field":"stateCategory","op":"eq","values":["shipping"]}`),
	})
	if code := platform.CodeOf(err); code != platform.CodeValidation {
		t.Fatalf("got code %s (%v), want VALIDATION", code, err)
	}
	if !strings.Contains(err.Error(), "shipping") {
		t.Errorf("message %q does not name the unknown category", err.Error())
	}

	after, err := svc.GetView(ctx, admin, view.ID)
	if err != nil {
		t.Fatalf("get view: %v", err)
	}
	if !jsonBlobsEqual(t, after.Filter, json.RawMessage(good)) {
		t.Fatalf("the stored filter is now %s, want the original %s — a rejected edit must not land", after.Filter, good)
	}
}

// A private view is one person's saved filter. It is not merely hidden from the API: its
// change rows carry a user scope, which is what stops the sync hub from ever handing it to
// anybody else's session.
func TestCreateView_APrivateViewIsInvisibleToEverybodyElse(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	mine := mustView(t, svc, admin, domain.CreateViewInput{
		Name:    "My week",
		Private: true,
		Filter:  json.RawMessage(`{"field":"assignee","op":"isNotNull"}`),
	})

	// A colleague in the same team, and an admin at that — OwnsResource has no admin
	// override, deliberately.
	otherID := f.NewUser(t, "other", "admin", true)
	other := f.PrincipalFor(otherID, authz.RoleAdmin, f.TeamID)

	if seen := viewIDs(t, svc, other); seen[mine.ID] {
		t.Fatal("somebody else's private view was listed")
	}
	if _, err := svc.GetView(ctx, other, mine.ID); platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("reading somebody else's private view gave %v, want NOT_FOUND — forbidden would confirm it exists", err)
	}
	stolen := "Yours now"
	if _, _, err := svc.UpdateView(ctx, other, domain.UpdateViewInput{ID: mine.ID, Name: &stolen}); platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("editing somebody else's private view gave %v, want NOT_FOUND", err)
	}

	if seen := viewIDs(t, svc, admin); !seen[mine.ID] {
		t.Fatal("the owner cannot see their own private view")
	}

	scope := viewScopeOf(t, db, f.WorkspaceID, mine.ID)
	if scope.Kind != authz.ScopeUser || scope.UserID == nil || *scope.UserID != f.UserID {
		t.Fatalf("a private view travels under %+v, want a user scope naming its owner — any other scope hands it to the wrong sessions", scope)
	}
}

// A shared team view is the team's, and membership is the whole test: it is not an admin
// action, and it does not reach anybody outside the team.
func TestCreateView_ASharedTeamViewReachesTheTeamAndNobodyElse(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	memberID := f.NewUser(t, "mem", "member", true)
	member := f.PrincipalFor(memberID, authz.RoleMember, f.TeamID)

	teamView, _, err := svc.CreateView(ctx, member, domain.CreateViewInput{
		Name:   "Triage",
		TeamID: &f.TeamID,
		Filter: json.RawMessage(`{"field":"stateCategory","op":"in","values":["triage","backlog"]}`),
	})
	if err != nil {
		t.Fatalf("a team member could not save a view for their own team: %v", err)
	}

	// Another member of the same team.
	mateID := f.NewUser(t, "mate", "member", true)
	mate := f.PrincipalFor(mateID, authz.RoleMember, f.TeamID)
	if seen := viewIDs(t, svc, mate); !seen[teamView.ID] {
		t.Fatal("a team member was not shown their team's shared view")
	}
	if _, err := svc.GetView(ctx, mate, teamView.ID); err != nil {
		t.Fatalf("a team member could not read their team's shared view: %v", err)
	}

	// Somebody in the workspace but not in the team.
	outsiderID := f.NewUser(t, "outsider", "member", false)
	outsider := f.PrincipalFor(outsiderID, authz.RoleMember)
	if seen := viewIDs(t, svc, outsider); seen[teamView.ID] {
		t.Fatal("a non-member was shown a team's view; which views a team keeps is information about that team")
	}
	if _, err := svc.GetView(ctx, outsider, teamView.ID); platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("a non-member read a team view (%v), want NOT_FOUND", err)
	}

	if scope := viewScopeOf(t, db, f.WorkspaceID, teamView.ID); scope.Kind != authz.ScopeTeam ||
		len(scope.TeamIDs) != 1 || scope.TeamIDs[0] != f.TeamID {
		t.Fatalf("a team view travels under %+v, want a team scope naming %s", scope, f.TeamID)
	}
}

// A project-attached view is the project's, and membership in any of its teams is the
// whole test. It does not appear in the sidebar listing.
func TestCreateView_AProjectAttachedViewReachesProjectMembers(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	project, _, err := svc.CreateProject(ctx, admin, domain.CreateProjectInput{
		Name: "Portal", TeamIDs: []uuid.UUID{f.TeamID}, MemberIDs: []uuid.UUID{admin.UserID},
	})
	if err != nil {
		t.Fatalf("project: %v", err)
	}

	tab, _, err := svc.CreateView(ctx, admin, domain.CreateViewInput{
		Name:      "Bugs",
		ProjectID: &project.ID,
		Filter:    json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatalf("create project view: %v", err)
	}
	if tab.ProjectID == nil || *tab.ProjectID != project.ID {
		t.Fatalf("view.projectId = %v, want %s", tab.ProjectID, project.ID)
	}

	memberID := f.NewUser(t, "mem", "member", true)
	member := f.PrincipalFor(memberID, authz.RoleMember, f.TeamID)
	if _, err := svc.GetView(ctx, member, tab.ID); err != nil {
		t.Fatalf("project member could not read attached view: %v", err)
	}
	if seen := viewIDs(t, svc, member); seen[tab.ID] {
		t.Fatal("project view appeared in sidebar listing")
	}

	outsiderID := f.NewUser(t, "outsider", "member", false)
	outsider := f.PrincipalFor(outsiderID, authz.RoleMember)
	if _, err := svc.GetView(ctx, outsider, tab.ID); platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("outsider read project view (%v), want NOT_FOUND", err)
	}

	if scope := viewScopeOf(t, db, f.WorkspaceID, tab.ID); scope.Kind != authz.ScopeProject {
		t.Fatalf("project view travels under %+v, want project scope", scope)
	}
}

// A workspace-wide view lands in everybody's sidebar. That reach is what makes creating one
// an admin action, while creating the team's is not.
func TestCreateView_AWorkspaceWideViewIsAdminsOnly(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	memberID := f.NewUser(t, "mem", "member", true)
	member := f.PrincipalFor(memberID, authz.RoleMember, f.TeamID)

	if _, _, err := svc.CreateView(ctx, member, domain.CreateViewInput{Name: "Everything"}); platform.CodeOf(err) != platform.CodeForbidden {
		t.Fatalf("a member created a workspace-wide view (%v), want FORBIDDEN", err)
	}

	// The same person may keep it to themselves, because a private view needs no action at
	// all: it is theirs.
	if _, _, err := svc.CreateView(ctx, member, domain.CreateViewInput{Name: "Everything", Private: true}); err != nil {
		t.Fatalf("a member could not save their own private view: %v", err)
	}

	shared := mustView(t, svc, f.Principal(), domain.CreateViewInput{Name: "Everything"})
	if scope := viewScopeOf(t, db, f.WorkspaceID, shared.ID); scope.Kind != authz.ScopeWorkspace {
		t.Fatalf("a workspace view travels under %+v, want a workspace scope", scope)
	}

	// A guest is scoped to their teams and never receives workspace-wide entities, so
	// listing one to them would show a view the sync hub then never updates.
	guestID := f.NewUser(t, "guest", "guest", true)
	guest := f.PrincipalFor(guestID, authz.RoleGuest, f.TeamID)
	if seen := viewIDs(t, svc, guest); seen[shared.ID] {
		t.Fatal("a guest was shown a workspace-wide view")
	}
}

// Deleting a shared view has to reach everybody who had it, which means the delete travels
// under the same scope the view did.
func TestDeleteView_TellsTheWholeScopeToForgetIt(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	view := mustView(t, svc, admin, domain.CreateViewInput{Name: "Triage", TeamID: &f.TeamID})

	id, _, err := svc.DeleteView(ctx, admin, view.ID)
	if err != nil {
		t.Fatalf("delete view: %v", err)
	}
	if id != view.ID {
		t.Fatalf("delete returned %s, want %s — the id is how every client names the row it must drop", id, view.ID)
	}

	if seen := viewIDs(t, svc, admin); seen[view.ID] {
		t.Fatal("a deleted view is still listed")
	}
	if _, err := svc.GetView(ctx, admin, view.ID); platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("a deleted view still reads back (%v)", err)
	}

	var deletes int
	for _, c := range changesForEntity(t, db, f.WorkspaceID, "view") {
		if c.EntityID != view.ID || c.Op != string(domain.OpDelete) {
			continue
		}
		deletes++
		scope, err := authz.ParseScope(c.Scope)
		if err != nil {
			t.Fatalf("parse scope: %v", err)
		}
		if scope.Kind != authz.ScopeTeam || len(scope.TeamIDs) != 1 || scope.TeamIDs[0] != f.TeamID {
			t.Fatalf("the delete travels under %+v, want the team scope the view itself had", scope)
		}
	}
	if deletes != 1 {
		t.Fatalf("%d delete changes were emitted, want exactly 1", deletes)
	}
}

// The natural key of a preference is (user, view key) and the write is an upsert, so the id
// the caller mints is thrown away on every call but the first. Everything downstream has to
// use the id the row actually has: a fresh one each time would leave every client holding a
// second preference for the same view every time somebody changed their grouping.
func TestSetViewPreference_KeepsOneRowAndOneIDPerViewKey(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	first, _, err := svc.SetViewPreference(ctx, admin, "my-issues", json.RawMessage(`{"grouping":"assignee"}`))
	if err != nil {
		t.Fatalf("set preference: %v", err)
	}
	second, _, err := svc.SetViewPreference(ctx, admin, "my-issues", json.RawMessage(`{"grouping":"priority"}`))
	if err != nil {
		t.Fatalf("set preference again: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("the second write minted a new id (%s then %s); the client now holds two preferences for one view", first.ID, second.ID)
	}
	if !jsonBlobsEqual(t, second.Display, json.RawMessage(`{"grouping":"priority"}`)) {
		t.Fatalf("display is %s, want the value just written", second.Display)
	}

	prefs, err := svc.ListViewPreferences(ctx, admin)
	if err != nil {
		t.Fatalf("list preferences: %v", err)
	}
	if len(prefs) != 1 {
		t.Fatalf("%d preference rows for one view key, want 1", len(prefs))
	}

	for _, c := range changesForEntity(t, db, f.WorkspaceID, "viewPreference") {
		if c.EntityID != first.ID {
			t.Fatalf("a change named %s, but the stored row is %s — the client would apply it to a row it does not have", c.EntityID, first.ID)
		}
		scope, err := authz.ParseScope(c.Scope)
		if err != nil {
			t.Fatalf("parse scope: %v", err)
		}
		if scope.Kind != authz.ScopeUser || scope.UserID == nil || *scope.UserID != f.UserID {
			t.Fatalf("a preference travels under %+v, want a user scope naming its owner", scope)
		}
	}
}

// target_id is deliberately not a foreign key — a favourite can point at four different
// tables — so nothing but this check stands between favouriting and an existence oracle: a
// uuid that stores successfully is one that exists, which is how somebody enumerates a
// private team's issues without ever being able to read one.
func TestAddFavorite_ATargetTheCallerCannotSeeIsRefusedTheSameWayAsOneThatDoesNotExist(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	secretTeam, secretIssue := privateTeamWithIssue(t, f)

	// In the workspace and in the public team, but not in the private one.
	outsiderID := f.NewUser(t, "outsider", "member", true)
	outsider := f.PrincipalFor(outsiderID, authz.RoleMember, f.TeamID)

	_, _, hidden := svc.AddFavorite(ctx, outsider, model.FavoriteIssue, secretIssue, nil)
	if platform.CodeOf(hidden) != platform.CodeValidation {
		t.Fatalf("favouriting an issue in a private team gave %v, want a refusal", hidden)
	}
	_, _, absent := svc.AddFavorite(ctx, outsider, model.FavoriteIssue, uuid.Must(uuid.NewV7()), nil)
	if platform.CodeOf(absent) != platform.CodeValidation {
		t.Fatalf("favouriting an issue that does not exist gave %v, want a refusal", absent)
	}
	// The two answers must be indistinguishable, or the refusal itself confirms the id.
	if hidden.Error() != absent.Error() {
		t.Fatalf("an invisible target says %q and a missing one says %q; the difference is the oracle", hidden, absent)
	}

	if _, _, err := svc.AddFavorite(ctx, outsider, model.FavoriteTeam, secretTeam, nil); platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("favouriting a private team gave %v, want a refusal", err)
	}

	// The visible case still works, or the check above would be proving nothing.
	fav, _, err := svc.AddFavorite(ctx, outsider, model.FavoriteTeam, f.TeamID, nil)
	if err != nil {
		t.Fatalf("favouriting a team the caller is in: %v", err)
	}
	favs, err := svc.ListFavorites(ctx, outsider)
	if err != nil {
		t.Fatalf("list favourites: %v", err)
	}
	if len(favs) != 1 || favs[0].ID != fav.ID {
		t.Fatalf("the sidebar holds %+v, want exactly the one favourite just added", favs)
	}

	// A favourite is personal, so nobody else's sidebar acquired it.
	if others, err := svc.ListFavorites(ctx, f.Principal()); err != nil {
		t.Fatalf("list favourites: %v", err)
	} else if len(others) != 0 {
		t.Fatalf("somebody else's sidebar shows %d entries", len(others))
	}
}

// A favourite outlives what it points at, because target_id has no foreign key to cascade.
// The entry is dropped from the sidebar rather than deleted from the table: access comes
// back — somebody re-added to a team finds their favourites intact — where a row deleted the
// moment they left is gone for good, and deleting here would make a read path write.
func TestListFavorites_DropsAnEntryWhoseTargetIsGoneWithoutDeletingIt(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	view := mustView(t, svc, admin, domain.CreateViewInput{Name: "Triage", TeamID: &f.TeamID})
	if _, _, err := svc.AddFavorite(ctx, admin, model.FavoriteView, view.ID, nil); err != nil {
		t.Fatalf("favourite the view: %v", err)
	}
	if _, _, err := svc.DeleteView(ctx, admin, view.ID); err != nil {
		t.Fatalf("delete view: %v", err)
	}

	favs, err := svc.ListFavorites(ctx, admin)
	if err != nil {
		t.Fatalf("list favourites: %v", err)
	}
	if len(favs) != 0 {
		t.Fatalf("the sidebar still offers %d entries pointing at a deleted view", len(favs))
	}

	rows, err := db.Queries().ListFavorites(ctx, store.ListFavoritesParams{
		WorkspaceID: f.WorkspaceID, UserID: f.UserID,
	})
	if err != nil {
		t.Fatalf("read favourites: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("%d favourite rows survive, want the row left alone so it returns if access does", len(rows))
	}
}

// A drag lands the view where the person dropped it, and costs one row: the neighbours keep
// the keys they had. The anchor has to be a view the caller can actually see, or dropping
// something below a guessed id both confirms that id exists and sorts a sidebar by a
// position nobody was ever shown.
func TestUpdateView_AfterViewIDPlacesItBetweenTheNeighboursTheCallerCanSee(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	first := mustView(t, svc, admin, domain.CreateViewInput{Name: "First"})
	second := mustView(t, svc, admin, domain.CreateViewInput{Name: "Second"})
	third := mustView(t, svc, admin, domain.CreateViewInput{Name: "Third"})

	if got := viewOrder(t, svc, admin); got != "First,Second,Third" {
		t.Fatalf("views append in the order %q, want First,Second,Third", got)
	}

	if _, _, err := svc.UpdateView(ctx, admin, domain.UpdateViewInput{
		ID: third.ID, AfterViewID: &first.ID,
	}); err != nil {
		t.Fatalf("move view: %v", err)
	}
	if got := viewOrder(t, svc, admin); got != "First,Third,Second" {
		t.Fatalf("after the move the order is %q, want First,Third,Second", got)
	}

	before, err := svc.GetView(ctx, admin, second.ID)
	if err != nil {
		t.Fatalf("get view: %v", err)
	}
	if before.Position != second.Position {
		t.Fatalf("the neighbour's position changed from %q to %q; a drag must write one row",
			second.Position, before.Position)
	}

	// An anchor the caller cannot see is refused, and refused as a bad argument rather than
	// as a forbidden view — which is also the answer a made-up id gets.
	otherID := f.NewUser(t, "other", "member", true)
	other := f.PrincipalFor(otherID, authz.RoleMember, f.TeamID)
	theirs := mustView(t, svc, other, domain.CreateViewInput{Name: "Theirs", Private: true})

	_, _, hidden := svc.UpdateView(ctx, admin, domain.UpdateViewInput{ID: first.ID, AfterViewID: &theirs.ID})
	if platform.CodeOf(hidden) != platform.CodeValidation {
		t.Fatalf("anchoring to somebody else's private view gave %v, want a refusal", hidden)
	}
	missing := uuid.Must(uuid.NewV7())
	_, _, absent := svc.UpdateView(ctx, admin, domain.UpdateViewInput{ID: first.ID, AfterViewID: &missing})
	if hidden.Error() != absent.Error() {
		t.Fatalf("an invisible anchor says %q and a missing one says %q; the difference is the oracle", hidden, absent)
	}
}

// The sidebar is the user's own order, so a favourite dropped below another lands there and
// stays there. Positions are per-user: nobody else's sidebar moves.
func TestAddFavorite_AfterIDPlacesItBetweenItsNeighbours(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	team, _, err := svc.AddFavorite(ctx, admin, model.FavoriteTeam, f.TeamID, nil)
	if err != nil {
		t.Fatalf("favourite the team: %v", err)
	}
	first := mustView(t, svc, admin, domain.CreateViewInput{Name: "First"})
	second := mustView(t, svc, admin, domain.CreateViewInput{Name: "Second"})

	if _, _, err := svc.AddFavorite(ctx, admin, model.FavoriteView, first.ID, nil); err != nil {
		t.Fatalf("favourite the first view: %v", err)
	}
	// Dropped directly below the team, so it comes second of three.
	if _, _, err := svc.AddFavorite(ctx, admin, model.FavoriteView, second.ID, &team.ID); err != nil {
		t.Fatalf("favourite the second view: %v", err)
	}

	favs, err := svc.ListFavorites(ctx, admin)
	if err != nil {
		t.Fatalf("list favourites: %v", err)
	}
	got := make([]uuid.UUID, 0, len(favs))
	for _, fav := range favs {
		got = append(got, fav.TargetID)
	}
	want := []uuid.UUID{f.TeamID, second.ID, first.ID}
	if len(got) != len(want) {
		t.Fatalf("the sidebar holds %d entries, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("the sidebar reads %v, want %v", got, want)
		}
	}
}

func TestCreateFavoriteFolder_GroupsTheSidebar(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	admin := f.Principal()
	ctx := context.Background()

	folder, _, err := svc.CreateFavoriteFolder(ctx, admin, "Later", nil)
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}
	if folder.Kind != model.FavoriteFolder || folder.Name == nil || *folder.Name != "Later" {
		t.Fatalf("folder = %+v, want named Later", folder)
	}
	if folder.TargetID != folder.ID {
		t.Fatal("a folder's target is itself, so bootstrap does not have to look elsewhere")
	}

	if _, _, err := svc.AddFavorite(ctx, admin, model.FavoriteTeam, f.TeamID, nil); err != nil {
		t.Fatalf("favourite the team: %v", err)
	}
	favs, err := svc.ListFavorites(ctx, admin)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var teamFav model.Favorite
	for _, fav := range favs {
		if fav.Kind == model.FavoriteTeam {
			teamFav = fav
		}
	}
	if teamFav.ID == uuid.Nil {
		t.Fatal("the team was not favourited")
	}

	moved, _, err := svc.MoveFavorite(ctx, admin, domain.MoveFavoriteInput{
		ID:       teamFav.ID,
		FolderID: &folder.ID,
	})
	if err != nil {
		t.Fatalf("move into folder: %v", err)
	}
	if moved.FolderID == nil || *moved.FolderID != folder.ID {
		t.Fatalf("moved folderId = %v, want %s", moved.FolderID, folder.ID)
	}

	if _, _, err := svc.MoveFavorite(ctx, admin, domain.MoveFavoriteInput{
		ID:       folder.ID,
		FolderID: &folder.ID,
	}); err == nil {
		t.Fatal("a folder must not sit in itself")
	}

	if _, _, err := svc.RemoveFavorite(ctx, admin, model.FavoriteFolder, folder.ID); err != nil {
		t.Fatalf("delete folder: %v", err)
	}
	favs, err = svc.ListFavorites(ctx, admin)
	if err != nil {
		t.Fatalf("list after delete: %v", err)
	}
	for _, fav := range favs {
		if fav.Kind == model.FavoriteFolder {
			t.Fatal("the folder survived its delete")
		}
		if fav.ID == teamFav.ID && fav.FolderID != nil {
			t.Fatal("deleting a folder must lift its children to the root, not leave them pointing at a missing heading")
		}
	}
}

func TestCreateFavoriteFolder_BlankNameIsRefused(t *testing.T) {
	t.Parallel()
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	if _, _, err := svc.CreateFavoriteFolder(context.Background(), f.Principal(), "  ", nil); err == nil {
		t.Fatal("a folder without a name must be refused")
	}
}

// --- helpers ------------------------------------------------------------------------

func mustView(t *testing.T, svc *domain.Service, p *authz.Principal, in domain.CreateViewInput) model.View {
	t.Helper()
	view, _, err := svc.CreateView(context.Background(), p, in)
	if err != nil {
		t.Fatalf("create view %q: %v", in.Name, err)
	}
	return view
}

func viewIDs(t *testing.T, svc *domain.Service, p *authz.Principal) map[uuid.UUID]bool {
	t.Helper()
	views, err := svc.ListViews(context.Background(), p)
	if err != nil {
		t.Fatalf("list views: %v", err)
	}
	seen := make(map[uuid.UUID]bool, len(views))
	for _, v := range views {
		seen[v.ID] = true
	}
	return seen
}

// viewOrder is the sidebar as the caller reads it: names in stored position order.
func viewOrder(t *testing.T, svc *domain.Service, p *authz.Principal) string {
	t.Helper()
	views, err := svc.ListViews(context.Background(), p)
	if err != nil {
		t.Fatalf("list views: %v", err)
	}
	names := make([]string, 0, len(views))
	for _, v := range views {
		names = append(names, v.Name)
	}
	return strings.Join(names, ",")
}

// viewScopeOf reads the scope a view's change rows carry. That scope, and not the API's
// filtering, is what the sync hub judges every session by — a view the API hides and the
// stream ships is still leaked.
func viewScopeOf(t *testing.T, db *store.DB, workspaceID, viewID uuid.UUID) authz.Scope {
	t.Helper()
	for _, c := range changesForEntity(t, db, workspaceID, "view") {
		if c.EntityID != viewID {
			continue
		}
		scope, err := authz.ParseScope(c.Scope)
		if err != nil {
			t.Fatalf("parse scope: %v", err)
		}
		return scope
	}
	t.Fatalf("no change was emitted for view %s — clients never learn it exists", viewID)
	return authz.Scope{}
}

// privateTeamWithIssue builds a second team nobody in the fixture belongs to, with one
// issue in it. Written through store rather than through the domain layer for the reason
// the fixture itself is: a test about who can see what should not depend on the code that
// creates teams being correct.
func privateTeamWithIssue(t *testing.T, f *testutil.Fixture) (teamID, issueID uuid.UUID) {
	t.Helper()
	teamID = uuid.Must(uuid.NewV7())
	stateID := uuid.Must(uuid.NewV7())
	issueID = uuid.Must(uuid.NewV7())

	err := f.DB.InTx(context.Background(), func(ctx context.Context, q *store.Queries) error {
		if _, err := q.CreateTeam(ctx, store.CreateTeamParams{
			ID: teamID, WorkspaceID: f.WorkspaceID, Key: "SEC", Name: "Security",
			Timezone: "UTC", Private: true, Settings: json.RawMessage(`{}`),
		}); err != nil {
			return err
		}
		if _, err := q.CreateWorkflowState(ctx, store.CreateWorkflowStateParams{
			ID: stateID, WorkspaceID: f.WorkspaceID, TeamID: teamID, Name: "Backlog",
			Color: "#bec2c8", Category: "backlog", Position: "a0", IsDefault: true,
		}); err != nil {
			return err
		}
		if _, err := q.AllocateIssueNumber(ctx, teamID); err != nil {
			return err
		}
		_, err := q.CreateIssue(ctx, store.CreateIssueParams{
			ID: issueID, WorkspaceID: f.WorkspaceID, TeamID: teamID, Number: 1,
			Title: "Rotate the signing keys", StateID: stateID, CreatorID: &f.UserID,
			Priority: 0, SortOrder: "a0",
		})
		return err
	})
	if err != nil {
		t.Fatalf("build private team: %v", err)
	}
	return teamID, issueID
}

// changesForEntity reads the stream the way the sync hub does. It is the only place that
// can prove a mutation reaches clients at all, and the only place the scope a change
// travels under is observable.
func changesForEntity(t *testing.T, db *store.DB, workspaceID uuid.UUID, entityType string) []store.ChangeLog {
	t.Helper()
	rows, err := db.Queries().ReadChangesSince(context.Background(), store.ReadChangesSinceParams{
		WorkspaceID: workspaceID, AfterVersion: 0, ThroughVersion: 1 << 40, PageSize: 500,
	})
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	var out []store.ChangeLog
	for _, r := range rows {
		if r.EntityType == entityType {
			out = append(out, r)
		}
	}
	if len(out) == 0 {
		t.Fatalf("no %s changes were emitted at all — clients never learn about it", entityType)
	}
	return out
}

// jsonBlobsEqual compares two blobs as JSON rather than as bytes: these columns are opaque
// bags and neither side promises key order or whitespace.
func jsonBlobsEqual(t *testing.T, a, b json.RawMessage) bool {
	t.Helper()
	var x, y any
	if err := json.Unmarshal(a, &x); err != nil {
		t.Fatalf("decode %s: %v", a, err)
	}
	if err := json.Unmarshal(b, &y); err != nil {
		t.Fatalf("decode %s: %v", b, err)
	}
	ax, err := json.Marshal(x)
	if err != nil {
		t.Fatalf("re-encode: %v", err)
	}
	by, err := json.Marshal(y)
	if err != nil {
		t.Fatalf("re-encode: %v", err)
	}
	return string(ax) == string(by)
}
