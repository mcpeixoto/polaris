package domain_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestCreateView_TargetDecidesWhichFilterIsLegal(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	lead := json.RawMessage(`{"field":"lead","op":"isNull"}`)
	saved, _, err := svc.CreateView(ctx, admin, domain.CreateViewInput{
		Name:   "Unled",
		Target: model.ViewTargetProject,
		Filter: lead,
	})
	if err != nil {
		t.Fatalf("a project view may filter on lead: %v", err)
	}
	if saved.Target != model.ViewTargetProject {
		t.Fatalf("target = %q, want project", saved.Target)
	}

	_, _, err = svc.CreateView(ctx, admin, domain.CreateViewInput{
		Name:   "Issues with a lead",
		Filter: lead,
	})
	if platform.CodeOf(err) != platform.CodeValidation || !strings.Contains(err.Error(), "lead") {
		t.Fatalf("an issue view accepted a project field: %v", err)
	}

	_, _, err = svc.CreateView(ctx, admin, domain.CreateViewInput{
		Name:   "Projects with an assignee",
		Target: model.ViewTargetProject,
		Filter: json.RawMessage(`{"field":"assignee","op":"isNull"}`),
	})
	if platform.CodeOf(err) != platform.CodeValidation || !strings.Contains(err.Error(), "assignee") {
		t.Fatalf("a project view accepted an issue field: %v", err)
	}
}

func TestUpdateView_RevalidatesAgainstTheStoredTarget(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	admin := f.Principal()

	saved, _, err := svc.CreateView(ctx, admin, domain.CreateViewInput{
		Name:   "Unled",
		Target: model.ViewTargetProject,
		Filter: json.RawMessage(`{"field":"name","op":"contains","values":["a"]}`),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, _, err = svc.UpdateView(ctx, admin, domain.UpdateViewInput{
		ID:     saved.ID,
		Filter: json.RawMessage(`{"field":"assignee","op":"isNull"}`),
	})
	if platform.CodeOf(err) != platform.CodeValidation {
		t.Fatalf("updating a project view with an issue field: %v", err)
	}

	updated, _, err := svc.UpdateView(ctx, admin, domain.UpdateViewInput{
		ID:     saved.ID,
		Filter: json.RawMessage(`{"field":"lead","op":"isNull"}`),
	})
	if err != nil {
		t.Fatalf("a project field is legal on the stored project view: %v", err)
	}
	if updated.Target != model.ViewTargetProject {
		t.Fatalf("target changed to %q", updated.Target)
	}
}
