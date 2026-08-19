package domain_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateRecurringIssue_MintsTheFirstOccurrenceImmediately(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	rec, _, err := svc.CreateRecurringIssue(ctx, p, domain.CreateRecurringIssueInput{
		TeamID:       f.TeamID,
		Title:        "Weekly backup",
		Cadence:      model.CadenceWeekly,
		FirstDueDate: model.Date("2026-01-15"),
	})
	if err != nil {
		t.Fatalf("create schedule: %v", err)
	}
	if rec.NextDueDate != "2026-01-15" {
		t.Fatalf("nextDueDate = %q, want the first occurrence's due date", rec.NextDueDate)
	}

	issues, err := svc.ListIssuesForTeam(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(issues) != 1 {
		t.Fatalf("got %d issues, want the first occurrence", len(issues))
	}
	got := issues[0]
	if got.Title != "Weekly backup" {
		t.Fatalf("title = %q, want the snapshot", got.Title)
	}
	if got.DueDate == nil || string(*got.DueDate) != "2026-01-15" {
		t.Fatalf("dueDate = %v, want 2026-01-15", got.DueDate)
	}
	if got.RecurringIssueID == nil || *got.RecurringIssueID != rec.ID {
		t.Fatalf("recurringIssueId = %v, want %s", got.RecurringIssueID, rec.ID)
	}
}

func TestCreateRecurringIssue_ConvertLinksTheExistingIssue(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	existing, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Already filed",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}

	rec, _, err := svc.CreateRecurringIssue(ctx, p, domain.CreateRecurringIssueInput{
		TeamID:        f.TeamID,
		Title:         "Already filed",
		Cadence:       model.CadenceMonthly,
		FirstDueDate:  model.Date("2026-02-01"),
		SourceIssueID: &existing.ID,
	})
	if err != nil {
		t.Fatalf("convert: %v", err)
	}

	issues, err := svc.ListIssuesForTeam(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(issues) != 1 {
		t.Fatalf("got %d issues, want the existing one rather than a newly minted first occurrence", len(issues))
	}
	got := issues[0]
	if got.ID != existing.ID {
		t.Fatalf("id = %s, want the issue that was converted", existing.ID)
	}
	if got.RecurringIssueID == nil || *got.RecurringIssueID != rec.ID {
		t.Fatalf("recurringIssueId = %v, want %s", got.RecurringIssueID, rec.ID)
	}
	if got.DueDate == nil || string(*got.DueDate) != "2026-02-01" {
		t.Fatalf("dueDate = %v, want the first due date applied to the converted issue", got.DueDate)
	}
}

func TestCreateIssue_RecurringCadenceAttachesASchedule(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	weekly := model.CadenceWeekly
	due := model.Date("2026-03-01")
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID:                f.TeamID,
		Title:                 "Composer recurring",
		RecurringCadence:      &weekly,
		RecurringFirstDueDate: &due,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if issue.RecurringIssueID == nil {
		t.Fatal("the composer path did not attach a schedule")
	}
	if issue.DueDate == nil || string(*issue.DueDate) != "2026-03-01" {
		t.Fatalf("dueDate = %v, want the first due date", issue.DueDate)
	}
}

func TestAdvanceRecurringIssues_MintsAfterTheDueDatePassesInTeamTimezone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	rec, _, err := svc.CreateRecurringIssue(ctx, p, domain.CreateRecurringIssueInput{
		TeamID:       f.TeamID,
		Title:        "Nightly",
		Cadence:      model.CadenceDaily,
		FirstDueDate: model.Date("2026-01-01"),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Still the due day in UTC — a pass on the due date itself must not mint.
	if n, err := svc.AdvanceRecurringIssues(ctx, time.Date(2026, 1, 1, 23, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("advance on the due day: %v", err)
	} else if n != 0 {
		t.Fatalf("minted %d on the due day, want 0", n)
	}

	if n, err := svc.AdvanceRecurringIssues(ctx, time.Date(2026, 1, 2, 0, 1, 0, 0, time.UTC)); err != nil {
		t.Fatalf("advance after: %v", err)
	} else if n != 1 {
		t.Fatalf("minted %d after the due date, want 1", n)
	}

	issues, err := svc.ListIssuesForTeam(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(issues) != 2 {
		t.Fatalf("got %d issues, want the first occurrence plus the one the worker minted", len(issues))
	}
	updated, err := svc.GetRecurringIssue(ctx, p, rec.ID)
	if err != nil {
		t.Fatalf("get schedule: %v", err)
	}
	if updated.NextDueDate != "2026-01-02" {
		t.Fatalf("nextDueDate = %q, want the newly minted occurrence's due date", updated.NextDueDate)
	}
}

func TestCreateRecurringIssue_SnapshotDoesNotFollowALaterTemplateEdit(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	title := "Before"
	tpl, _, err := svc.CreateIssueTemplate(ctx, p, domain.CreateIssueTemplateInput{
		TeamID: &f.TeamID, Name: "Source", Title: &title,
	})
	if err != nil {
		t.Fatalf("create template: %v", err)
	}

	if _, _, err := svc.CreateRecurringIssue(ctx, p, domain.CreateRecurringIssueInput{
		TeamID:       f.TeamID,
		Title:        "Before",
		TemplateID:   &tpl.ID,
		Cadence:      model.CadenceWeekly,
		FirstDueDate: model.Date("2026-01-01"),
	}); err != nil {
		t.Fatalf("create schedule: %v", err)
	}

	after := "After"
	if _, _, err := svc.UpdateIssueTemplate(ctx, p, domain.UpdateIssueTemplateInput{
		ID: tpl.ID, Title: &after,
	}); err != nil {
		t.Fatalf("edit template: %v", err)
	}

	if _, err := svc.AdvanceRecurringIssues(ctx, time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("advance: %v", err)
	}
	issues, err := svc.ListIssuesForTeam(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, issue := range issues {
		if issue.Title != "Before" {
			t.Fatalf("minted %q after the template was renamed; the snapshot must not follow", issue.Title)
		}
	}
}

func TestAddCadence_MonthlyClampsToLastDay(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	if _, _, err := svc.CreateRecurringIssue(ctx, p, domain.CreateRecurringIssueInput{
		TeamID:       f.TeamID,
		Title:        "Month end",
		Cadence:      model.CadenceMonthly,
		FirstDueDate: model.Date("2026-01-31"),
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := svc.AdvanceRecurringIssues(ctx, time.Date(2026, 2, 1, 12, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("advance: %v", err)
	}
	issues, err := svc.ListIssuesForTeam(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var next *model.Date
	for i := range issues {
		if issues[i].DueDate != nil && string(*issues[i].DueDate) != "2026-01-31" {
			next = issues[i].DueDate
		}
	}
	if next == nil || string(*next) != "2026-02-28" {
		t.Fatalf("next due = %v, want 2026-02-28 — January 31 has to clamp", next)
	}
}

func TestCreateRecurringIssue_PropertiesRoundTripOnTheSnapshot(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	properties := json.RawMessage(`{"priority":2,"estimate":5}`)
	rec, _, err := svc.CreateRecurringIssue(ctx, p, domain.CreateRecurringIssueInput{
		TeamID:       f.TeamID,
		Title:        "With properties",
		Properties:   properties,
		Cadence:      model.CadenceWeekly,
		FirstDueDate: model.Date("2026-04-01"),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !jsonBlobsEqual(t, rec.Properties, properties) {
		t.Fatalf("snapshot properties = %s, want %s", rec.Properties, properties)
	}
	issues, err := svc.ListIssuesForTeam(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(issues) != 1 || issues[0].Priority != 2 {
		t.Fatalf("first occurrence did not take the snapshot's priority: %+v", issues)
	}
}
