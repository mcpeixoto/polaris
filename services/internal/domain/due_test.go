package domain_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The due sweep against a real Postgres. notify.DueNotice is tested without one; what
// these prove is the part only a database can: who is told, that a morning's deadlines
// fold into one row, and that the next morning does not say the same thing again.

func TestSweepDue_AssigneeHearsOnceAndWatchersDoNot(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	morning := time.Date(2026, 9, 23, 9, 0, 0, 0, time.UTC)
	today := model.Date("2026-09-23")

	first := mustIssue(t, svc, alice, f, "Ship the thing")
	second := mustIssue(t, svc, alice, f, "Write the notes")
	mustUpdate(t, svc, alice, domain.UpdateIssueInput{ID: first, DueDate: &today, AssigneeID: &bobID})
	mustUpdate(t, svc, alice, domain.UpdateIssueInput{ID: second, DueDate: &today, AssigneeID: &bobID})

	n, err := svc.SweepDueNotifications(ctx, morning)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 1 {
		t.Fatalf("two deadlines the same morning should be one notice, wrote %d", n)
	}

	got := inbox(t, svc, bob)
	if len(got) != 1 {
		t.Fatalf("the assignee has %d notifications, want 1: %+v", len(got), got)
	}
	if got[0].Type != model.NotifyIssueDue || got[0].Count != 2 {
		t.Fatalf("notice = type %s count %d, want issue_due x2", got[0].Type, got[0].Count)
	}
	var payload struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(got[0].Payload, &payload); err != nil {
		t.Fatalf("payload: %v", err)
	}
	if payload.Kind != "today" {
		t.Fatalf("kind = %q, want today", payload.Kind)
	}

	if others := inbox(t, svc, alice); len(others) != 0 {
		t.Fatalf("a watcher of an assigned issue was told about its deadline: %+v", others)
	}

	// The same morning, said again, changes nothing.
	n, err = svc.SweepDueNotifications(ctx, morning.Add(30*time.Minute))
	if err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if n != 0 {
		t.Fatalf("a repeated sweep wrote %d notices, want 0", n)
	}
	if again := inbox(t, svc, bob); len(again) != 1 || again[0].Count != 2 {
		t.Fatalf("the row changed on the second sweep: %+v", again)
	}
}

func TestSweepDue_BeforeMorningSaysNothing(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	issue := mustIssue(t, svc, alice, f, "Not yet")
	today := model.Date("2026-09-23")
	mustUpdate(t, svc, alice, domain.UpdateIssueInput{ID: issue, DueDate: &today, AssigneeID: &alice.UserID})

	n, err := svc.SweepDueNotifications(ctx, time.Date(2026, 9, 23, 7, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 0 || len(inbox(t, svc, alice)) != 0 {
		t.Fatalf("a sweep before morning wrote a notice")
	}
}

func TestSweepDue_OverdueIsSaidOnce(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	issue := mustIssue(t, svc, alice, f, "Late")
	yesterday := model.Date("2026-09-22")
	mustUpdate(t, svc, alice, domain.UpdateIssueInput{ID: issue, DueDate: &yesterday, AssigneeID: &alice.UserID})

	firstMorning := time.Date(2026, 9, 23, 9, 0, 0, 0, time.UTC)
	if _, err := svc.SweepDueNotifications(ctx, firstMorning); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	got := inbox(t, svc, alice)
	if len(got) != 1 {
		t.Fatalf("overdue notices: %d, want 1", len(got))
	}
	var payload struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(got[0].Payload, &payload); err != nil {
		t.Fatalf("payload: %v", err)
	}
	if payload.Kind != "overdue" {
		t.Fatalf("kind = %q, want overdue", payload.Kind)
	}

	// The morning after that, and the one after. Still the one row.
	for _, later := range []time.Time{firstMorning.AddDate(0, 0, 1), firstMorning.AddDate(0, 0, 8)} {
		n, err := svc.SweepDueNotifications(ctx, later)
		if err != nil {
			t.Fatalf("later sweep: %v", err)
		}
		if n != 0 {
			t.Fatalf("overdue was said again on %s", later.Format("2006-01-02"))
		}
	}
	if again := inbox(t, svc, alice); len(again) != 1 {
		t.Fatalf("inbox grew after the overdue notice: %+v", again)
	}
}

func TestSweepDue_CompletedAndMutedAreSilent(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	if _, _, err := svc.UpdateNotificationPrefs(ctx, bob, json.RawMessage(`{"muted":["issue_due"]}`)); err != nil {
		t.Fatalf("mute: %v", err)
	}

	yesterday := model.Date("2026-09-22")
	done := mustIssue(t, svc, alice, f, "Finished")
	muted := mustIssue(t, svc, alice, f, "Not his problem")
	mustUpdate(t, svc, alice, domain.UpdateIssueInput{
		ID: done, DueDate: &yesterday, AssigneeID: &alice.UserID, StateID: &f.Done,
	})
	mustUpdate(t, svc, alice, domain.UpdateIssueInput{
		ID: muted, DueDate: &yesterday, AssigneeID: &bobID,
	})

	n, err := svc.SweepDueNotifications(ctx, time.Date(2026, 9, 23, 9, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 0 {
		t.Fatalf("wrote %d notices for a finished issue and a muted assignee", n)
	}
	if len(inbox(t, svc, alice)) != 0 || len(inbox(t, svc, bob)) != 0 {
		t.Fatal("somebody was told")
	}
}

func TestSweepDue_UnassignedReachesSubscribers(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	issue := mustIssue(t, svc, alice, f, "Nobody's yet")
	today := model.Date("2026-09-23")
	mustUpdate(t, svc, alice, domain.UpdateIssueInput{ID: issue, DueDate: &today})

	if _, err := svc.SweepDueNotifications(ctx, time.Date(2026, 9, 23, 9, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if got := inbox(t, svc, alice); len(got) != 1 || got[0].Type != model.NotifyIssueDue {
		t.Fatalf("the creator, who is watching, was not told: %+v", got)
	}
	if got := inbox(t, svc, bob); len(got) != 0 {
		t.Fatalf("somebody who is not watching was told: %+v", got)
	}
}

func mustIssue(t *testing.T, svc *domain.Service, p *authz.Principal, f *testutil.Fixture, title string) uuid.UUID {
	t.Helper()
	issue, _, err := svc.CreateIssue(context.Background(), p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: title,
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	return issue.ID
}

func mustUpdate(t *testing.T, svc *domain.Service, p *authz.Principal, in domain.UpdateIssueInput) {
	t.Helper()
	if _, _, err := svc.UpdateIssue(context.Background(), p, in); err != nil {
		t.Fatalf("update issue: %v", err)
	}
}
