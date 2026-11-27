package graph

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/graph/generated"
	"github.com/peixotolabs/polaris/services/internal/store"
)

func TestUpdateIssue_DelegateIDRoundTrips(t *testing.T) {
	h := newHarness(t)
	agent := newGraphAppUser(t, h)

	created := h.createIssue(t, generated.CreateIssueInput{
		TeamID: h.f.TeamID, Title: "Needs an agent", AssigneeID: &h.f.UserID,
	})

	updated, err := h.Mutation().UpdateIssue(h.ctx, generated.UpdateIssueInput{
		ID: created.Issue.ID, DelegateID: &agent,
	}, nil, nil)
	if err != nil {
		t.Fatalf("update delegate: %v", err)
	}
	if updated.Issue.DelegateID == nil || *updated.Issue.DelegateID != agent {
		t.Fatalf("update returned delegate %v, want %s", updated.Issue.DelegateID, agent)
	}
	if updated.Issue.AssigneeID == nil || *updated.Issue.AssigneeID != h.f.UserID {
		t.Fatalf("update returned assignee %v, want the owner kept", updated.Issue.AssigneeID)
	}

	got, err := h.Query().Issue(h.ctx, created.Issue.ID)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if got.DelegateID == nil || *got.DelegateID != agent {
		t.Fatalf("read delegate %v, want %s", got.DelegateID, agent)
	}

	cleared, err := h.Mutation().UpdateIssue(h.ctx, generated.UpdateIssueInput{
		ID: created.Issue.ID, ClearDelegate: ptr(true),
	}, nil, nil)
	if err != nil {
		t.Fatalf("clear delegate: %v", err)
	}
	if cleared.Issue.DelegateID != nil {
		t.Fatalf("cleared delegate = %v, want none", cleared.Issue.DelegateID)
	}
}

func newGraphAppUser(t *testing.T, h *harness) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	err := h.f.DB.InTx(context.Background(), func(ctx context.Context, q *store.Queries) error {
		_, err := q.CreateUser(ctx, store.CreateUserParams{
			ID: id, WorkspaceID: h.f.WorkspaceID, Name: "Helper", DisplayName: "Helper",
			Timezone: "UTC", Role: "member", Kind: "app",
		})
		return err
	})
	if err != nil {
		t.Fatalf("create app user: %v", err)
	}
	return id
}
