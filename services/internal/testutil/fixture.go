package testutil

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Fixture is a minimal but real workspace: one account, one workspace, one admin user,
// one team with the five default statuses, and whatever issues a test asks for.
//
// It writes through store directly rather than through the domain layer, on purpose.
// A fixture that used the domain layer would make every domain test depend on the
// correctness of the code it is testing, and a bug in issue creation would show up as
// dozens of unrelated failures.
type Fixture struct {
	DB *store.DB

	AccountID   uuid.UUID
	WorkspaceID uuid.UUID
	UserID      uuid.UUID
	TeamID      uuid.UUID
	TeamKey     string

	// The five seeded statuses, by category.
	Backlog    uuid.UUID
	Todo       uuid.UUID
	InProgress uuid.UUID
	Done       uuid.UUID
	Canceled   uuid.UUID

	issueCounter int64
}

// NewFixture builds the fixture in one transaction.
func NewFixture(t *testing.T, db *store.DB) *Fixture {
	t.Helper()
	ctx := context.Background()

	f := &Fixture{
		DB:          db,
		AccountID:   uuid.Must(uuid.NewV7()),
		WorkspaceID: uuid.Must(uuid.NewV7()),
		UserID:      uuid.Must(uuid.NewV7()),
		TeamID:      uuid.Must(uuid.NewV7()),
		TeamKey:     "ENG",
	}

	err := db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := q.CreateAccount(ctx, store.CreateAccountParams{
			ID: f.AccountID,
			// The whole id, not a prefix of it.
			//
			// It was the first eight characters, which in a UUIDv7 are the top 32 bits of a
			// millisecond timestamp — so they only change about once a minute, and two
			// fixtures built against the same database inside that window collided on
			// account_email_lower_key. The failure is a unique-violation from a helper
			// nobody suspects, in a test that is about something else entirely, and it goes
			// away when you run the test on its own.
			Email: fmt.Sprintf("dev+%s@example.com", f.AccountID),
		}); err != nil {
			return fmt.Errorf("account: %w", err)
		}

		if _, err := q.CreateWorkspace(ctx, store.CreateWorkspaceParams{
			ID:   f.WorkspaceID,
			Name: "Acme",
			// Whole id, for the same reason as the account email above: the first eight
			// characters of a UUIDv7 are a timestamp that barely moves.
			UrlKey: "acme-" + f.WorkspaceID.String(),
			// Self-hosted, which is what CreateWorkspace gives a caller with no opinion
			// and what this repository's product actually is.
			//
			// It was "free" — the cloud's starter tier — which put every test that uses this
			// fixture under a five-seat, two-team cap. That was invisible while nothing
			// enforced entitlements and became a failure the moment something did: a test
			// about GraphQL field resolution refused to create its third team, citing a
			// paywall. A fixture must not carry a policy the code under test is not about;
			// the tests that ARE about the caps build their own workspace through
			// CreateWorkspace and name the plan.
			Plan:     string(entitlement.PlanSelfHosted),
			Settings: json.RawMessage(`{}`),
		}); err != nil {
			return fmt.Errorf("workspace: %w", err)
		}
		if err := q.InitWorkspaceVersion(ctx, f.WorkspaceID); err != nil {
			return fmt.Errorf("version: %w", err)
		}

		if _, err := q.CreateUser(ctx, store.CreateUserParams{
			ID:          f.UserID,
			WorkspaceID: f.WorkspaceID,
			AccountID:   &f.AccountID,
			Name:        "Dev User",
			DisplayName: "dev",
			Timezone:    "UTC",
			Role:        "admin",
			Kind:        "human",
		}); err != nil {
			return fmt.Errorf("user: %w", err)
		}

		if _, err := q.CreateTeam(ctx, store.CreateTeamParams{
			ID:          f.TeamID,
			WorkspaceID: f.WorkspaceID,
			Key:         f.TeamKey,
			Name:        "Engineering",
			Timezone:    "UTC",
			Private:     false,
			Settings:    json.RawMessage(`{}`),
		}); err != nil {
			return fmt.Errorf("team: %w", err)
		}

		mid := uuid.Must(uuid.NewV7())
		if _, err := q.AddTeamMember(ctx, store.AddTeamMemberParams{
			ID: mid, WorkspaceID: f.WorkspaceID, TeamID: f.TeamID, UserID: f.UserID, Role: "owner",
		}); err != nil {
			return fmt.Errorf("membership: %w", err)
		}

		// The default workflow, matching what a real team creation seeds.
		states := []struct {
			target    *uuid.UUID
			name      string
			category  string
			position  string
			color     string
			isDefault bool
		}{
			{&f.Backlog, "Backlog", "backlog", "a0", "#bec2c8", true},
			{&f.Todo, "Todo", "unstarted", "a1", "#e2e2e2", false},
			{&f.InProgress, "In Progress", "started", "a2", "#f2c94c", false},
			{&f.Done, "Done", "completed", "a3", "#5e6ad2", false},
			{&f.Canceled, "Canceled", "canceled", "a4", "#95a2b3", false},
		}
		for _, s := range states {
			id := uuid.Must(uuid.NewV7())
			*s.target = id
			if _, err := q.CreateWorkflowState(ctx, store.CreateWorkflowStateParams{
				ID:          id,
				WorkspaceID: f.WorkspaceID,
				TeamID:      f.TeamID,
				Name:        s.name,
				Color:       s.color,
				Category:    s.category,
				Position:    s.position,
				IsDefault:   s.isDefault,
				IsSystem:    false,
			}); err != nil {
				return fmt.Errorf("state %s: %w", s.name, err)
			}
		}

		// The same five project statuses CreateWorkspace seeds, so a fixture can create a
		// project without inventing a status the rest of the workspace has never seen.
		projectStatuses := []struct {
			name      string
			category  string
			position  string
			color     string
			isDefault bool
		}{
			{"Backlog", "backlog", "a0", "#bec2c8", true},
			{"Planned", "planned", "a1", "#e2e2e2", false},
			{"In Progress", "started", "a2", "#f2c94c", false},
			{"Completed", "completed", "a3", "#5e6ad2", false},
			{"Canceled", "canceled", "a4", "#95a2b3", false},
		}
		for _, s := range projectStatuses {
			if _, err := q.CreateProjectStatus(ctx, store.CreateProjectStatusParams{
				ID:          uuid.Must(uuid.NewV7()),
				WorkspaceID: f.WorkspaceID,
				Name:        s.name,
				Color:       &s.color,
				Category:    s.category,
				Position:    s.position,
				IsDefault:   s.isDefault,
			}); err != nil {
				return fmt.Errorf("project status %s: %w", s.name, err)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("build fixture: %v", err)
	}
	return f
}

// SetPlan moves the fixture's workspace onto another entitlement plan.
//
// A helper rather than an argument to NewFixture, because the plan matters to a handful of
// tests and to none of the rest: a fixture that asked every caller which tier they wanted
// would make a policy decision visible in a hundred tests that are not about policy.
//
// Written straight to the column, which is exactly what the billing job does — there is no
// domain method for changing a workspace's plan and there should not be one, since the plan
// is a fact about a subscription rather than something a request may set.
func (f *Fixture) SetPlan(t *testing.T, plan entitlement.Plan) {
	t.Helper()
	if _, err := f.DB.Pool().Exec(context.Background(),
		`UPDATE workspace SET plan = $2 WHERE id = $1`, f.WorkspaceID, string(plan),
	); err != nil {
		t.Fatalf("set plan %q: %v", plan, err)
	}
}

// Principal returns the fixture's owner, as the domain layer expects to receive one.
//
// Built explicitly rather than read back from the database, because that is exactly what
// the request path does: a Principal is assembled once at the entry point and passed down,
// and nothing below re-reads permissions. A test that constructed one by querying would be
// testing a code path the product does not have.
func (f *Fixture) Principal() *authz.Principal {
	return &authz.Principal{
		AccountID:   f.AccountID,
		UserID:      f.UserID,
		WorkspaceID: f.WorkspaceID,
		Role:        authz.RoleOwner,
		Teams:       authz.NewTeamSet(f.TeamID),
	}
}

// PrincipalFor returns another member, for the tests that need two people.
//
// teams is explicit and not defaulted to the fixture's team: the interesting cases are the
// ones where somebody cannot reach a team, and a helper that quietly granted access would
// make those tests pass for the wrong reason.
func (f *Fixture) PrincipalFor(userID uuid.UUID, role authz.Role, teams ...uuid.UUID) *authz.Principal {
	return &authz.Principal{
		UserID:      userID,
		WorkspaceID: f.WorkspaceID,
		Role:        role,
		Teams:       authz.NewTeamSet(teams...),
	}
}

// NewIssue inserts an issue directly and returns its id. title may be empty for a
// generated one.
func (f *Fixture) NewIssue(t *testing.T, title string) uuid.UUID {
	t.Helper()
	ctx := context.Background()

	f.issueCounter++
	n := f.issueCounter
	if title == "" {
		title = fmt.Sprintf("Issue %d", n)
	}
	id := uuid.Must(uuid.NewV7())

	err := f.DB.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		// Keep team.issue_counter in step so a later domain-layer create does not
		// collide with a fixture-created number.
		if _, err := q.AllocateIssueNumber(ctx, f.TeamID); err != nil {
			return err
		}
		_, err := q.CreateIssue(ctx, store.CreateIssueParams{
			ID:          id,
			WorkspaceID: f.WorkspaceID,
			TeamID:      f.TeamID,
			Number:      n,
			Title:       title,
			Description: "",
			StateID:     f.Backlog,
			CreatorID:   &f.UserID,
			Priority:    0,
			SortOrder:   fmt.Sprintf("a%04d", n),
		})
		return err
	})
	if err != nil {
		t.Fatalf("create fixture issue: %v", err)
	}
	return id
}

// NewUser adds another member to the workspace, optionally to the fixture's team.
func (f *Fixture) NewUser(t *testing.T, displayName, role string, joinTeam bool) uuid.UUID {
	t.Helper()
	ctx := context.Background()

	accountID := uuid.Must(uuid.NewV7())
	userID := uuid.Must(uuid.NewV7())

	err := f.DB.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := q.CreateAccount(ctx, store.CreateAccountParams{
			ID:    accountID,
			Email: fmt.Sprintf("%s+%s@example.com", displayName, accountID),
		}); err != nil {
			return err
		}
		if _, err := q.CreateUser(ctx, store.CreateUserParams{
			ID:          userID,
			WorkspaceID: f.WorkspaceID,
			AccountID:   &accountID,
			Name:        displayName,
			DisplayName: displayName,
			Timezone:    "UTC",
			Role:        role,
			Kind:        "human",
		}); err != nil {
			return err
		}
		if joinTeam {
			if _, err := q.AddTeamMember(ctx, store.AddTeamMemberParams{
				ID: uuid.Must(uuid.NewV7()), WorkspaceID: f.WorkspaceID,
				TeamID: f.TeamID, UserID: userID, Role: "member",
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("create fixture user: %v", err)
	}
	return userID
}
