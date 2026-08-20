package domain_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateIssue_AppliesTheFirstMatchingSLA(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	urgent := int32(1440)
	if _, _, err := svc.CreateSlaRule(ctx, p, domain.CreateSlaRuleInput{
		Filter:          json.RawMessage(`{"field":"priority","op":"eq","values":["1"]}`),
		Action:          model.SlaActionApply,
		DurationMinutes: &urgent,
	}); err != nil {
		t.Fatalf("rule: %v", err)
	}

	issue, version, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Pager", Priority: 1,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if version == 0 {
		t.Fatal("an SLA write must land on the sync stream")
	}
	if issue.DueDateSource != model.DueDateSLA {
		t.Fatalf("source = %q, want sla", issue.DueDateSource)
	}
	if issue.DueDate == nil {
		t.Fatal("an apply rule must set a due date")
	}
}

func TestCreateIssue_DoesNotResetAnSLAClock(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	urgent := int32(1440)
	if _, _, err := svc.CreateSlaRule(ctx, p, domain.CreateSlaRuleInput{
		Filter:          json.RawMessage(`{"field":"priority","op":"eq","values":["1"]}`),
		Action:          model.SlaActionApply,
		DurationMinutes: &urgent,
	}); err != nil {
		t.Fatalf("rule: %v", err)
	}

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Pager", Priority: 1,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if issue.DueDate == nil {
		t.Fatal("expected an SLA date")
	}
	first := *issue.DueDate

	title := "Pager still ringing"
	updated, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{
		ID: issue.ID, Title: &title,
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.DueDate == nil || *updated.DueDate != first {
		t.Fatalf("clock reset: got %v, want %s", updated.DueDate, first)
	}
	if updated.DueDateSource != model.DueDateSLA {
		t.Fatalf("source = %q", updated.DueDateSource)
	}
}

func TestUpdateIssue_RemoveRuleClearsAnSLADate(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	urgent := int32(1440)
	if _, _, err := svc.CreateSlaRule(ctx, p, domain.CreateSlaRuleInput{
		Filter:          json.RawMessage(`{"field":"priority","op":"eq","values":["1"]}`),
		Action:          model.SlaActionApply,
		DurationMinutes: &urgent,
	}); err != nil {
		t.Fatalf("apply rule: %v", err)
	}
	if _, _, err := svc.CreateSlaRule(ctx, p, domain.CreateSlaRuleInput{
		Filter: json.RawMessage(`{"field":"priority","op":"in","values":["0","3","4"]}`),
		Action: model.SlaActionRemove,
	}); err != nil {
		t.Fatalf("remove rule: %v", err)
	}

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Pager", Priority: 1,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if issue.DueDateSource != model.DueDateSLA {
		t.Fatalf("source = %q", issue.DueDateSource)
	}

	priority := 3
	updated, _, err := svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{
		ID: issue.ID, Priority: &priority,
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.DueDateSource != model.DueDateManual {
		t.Fatalf("source = %q, want manual", updated.DueDateSource)
	}
	if updated.DueDate != nil {
		t.Fatalf("due date still set: %v", *updated.DueDate)
	}
}

func TestUpdateIssue_RefusesAHumanDueDateWhileSLAOwnsIt(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	urgent := int32(1440)
	if _, _, err := svc.CreateSlaRule(ctx, p, domain.CreateSlaRuleInput{
		Filter:          json.RawMessage(`{"field":"priority","op":"eq","values":["1"]}`),
		Action:          model.SlaActionApply,
		DurationMinutes: &urgent,
	}); err != nil {
		t.Fatalf("rule: %v", err)
	}
	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Pager", Priority: 1,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	due := model.Date("2026-12-01")
	_, _, err = svc.UpdateIssue(ctx, p, domain.UpdateIssueInput{ID: issue.ID, DueDate: &due})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("got %v, want validation", err)
	}
}

func TestCreateSlaRule_RefusedOnFree(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	f.SetPlan(t, entitlement.PlanFree)

	urgent := int32(1440)
	_, _, err := svc.CreateSlaRule(ctx, f.Principal(), domain.CreateSlaRuleInput{
		Filter:          json.RawMessage(`{}`),
		Action:          model.SlaActionApply,
		DurationMinutes: &urgent,
	})
	if platform.CodeOf(err) != platform.CodeEntitlement {
		t.Fatalf("code = %s, want ENTITLEMENT (%v)", platform.CodeOf(err), err)
	}
}

func TestSetIssueSLA_DoesNotReEvaluateRules(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	// A remove rule that would match everything, so a re-evaluation after a manual set
	// would wipe the date we just applied.
	if _, _, err := svc.CreateSlaRule(ctx, p, domain.CreateSlaRuleInput{
		Filter: json.RawMessage(`{}`),
		Action: model.SlaActionRemove,
	}); err != nil {
		t.Fatalf("rule: %v", err)
	}

	issue, _, err := svc.CreateIssue(ctx, p, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Manual SLA",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	set, _, err := svc.SetIssueSLA(ctx, p, domain.SetIssueSLAInput{
		IssueID: issue.ID, DurationMinutes: 1440,
	})
	if err != nil {
		t.Fatalf("set: %v", err)
	}
	if set.DueDateSource != model.DueDateSLA || set.DueDate == nil {
		t.Fatalf("manual set did not stick: source=%q due=%v", set.DueDateSource, set.DueDate)
	}

	cleared, _, err := svc.ClearIssueSLA(ctx, p, issue.ID)
	if err != nil {
		t.Fatalf("clear: %v", err)
	}
	if cleared.DueDateSource != model.DueDateManual || cleared.DueDate != nil {
		t.Fatalf("clear left %q / %v", cleared.DueDateSource, cleared.DueDate)
	}
}
