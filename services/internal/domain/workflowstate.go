package domain

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/fractional"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// The six status categories are fixed by the product, in this order. Cycle completion,
// project progress, insights, triage semantics, auto-archival and the git integrations
// all branch on category, so this is not a list a customer gets to extend — they rename
// and reorder statuses *within* a category, and that is the whole of the flexibility.
const (
	CategoryTriage    = "triage"
	CategoryBacklog   = "backlog"
	CategoryUnstarted = "unstarted"
	CategoryStarted   = "started"
	CategoryCompleted = "completed"
	CategoryCanceled  = "canceled"
	CategoryDuplicate = "duplicate"
)

var categoryOrder = map[string]int{
	CategoryTriage: 0, CategoryBacklog: 1, CategoryUnstarted: 2,
	CategoryStarted: 3, CategoryCompleted: 4, CategoryCanceled: 5, CategoryDuplicate: 6,
}

// ValidCategory reports whether c is one a user may assign. Duplicate is excluded: it is
// system-managed and reached only by marking an issue as a duplicate.
func ValidCategory(c string) bool {
	_, ok := categoryOrder[c]
	return ok && c != CategoryDuplicate
}

// defaultStates is the workflow every new team starts with. Matching the source product's
// defaults matters more than it looks: teams migrating from it expect their muscle memory
// and their saved filters to carry over.
var defaultStates = []struct {
	Name      string
	Category  string
	Color     string
	IsDefault bool
}{
	{"Backlog", CategoryBacklog, "#bec2c8", true},
	{"Todo", CategoryUnstarted, "#e2e2e2", false},
	{"In Progress", CategoryStarted, "#f2c94c", false},
	{"Done", CategoryCompleted, "#5e6ad2", false},
	{"Canceled", CategoryCanceled, "#95a2b3", false},
}

// seedWorkflowStates creates a team's default workflow. Called from team creation, inside
// the same transaction: a team without statuses cannot hold an issue, so the two must not
// be separable.
func seedWorkflowStates(ctx context.Context, q *store.Queries, workspaceID, teamID uuid.UUID) ([]model.WorkflowState, error) {
	out := make([]model.WorkflowState, 0, len(defaultStates))
	pos := fractional.First()

	for i, d := range defaultStates {
		if i > 0 {
			pos = fractional.After(pos)
		}
		id, err := uuid.NewV7()
		if err != nil {
			return nil, platform.Internal(err)
		}
		row, err := q.CreateWorkflowState(ctx, store.CreateWorkflowStateParams{
			ID:          id,
			WorkspaceID: workspaceID,
			TeamID:      teamID,
			Name:        d.Name,
			Color:       d.Color,
			Category:    d.Category,
			Position:    pos,
			IsDefault:   d.IsDefault,
			IsSystem:    false,
		})
		if err != nil {
			return nil, platform.Internal(fmt.Errorf("seed workflow state %q: %w", d.Name, err))
		}
		out = append(out, toWorkflowState(row))
	}
	return out, nil
}

type CreateWorkflowStateInput struct {
	TeamID   uuid.UUID
	Name     string
	Category string
	Color    string
	// AfterStateID places the new status immediately after an existing one in the same
	// category. Nil appends to the end of the category.
	AfterStateID *uuid.UUID
	Description  *string
}

func (s *Service) CreateWorkflowState(ctx context.Context, p *authz.Principal, in CreateWorkflowStateInput) (model.WorkflowState, int64, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return model.WorkflowState{}, 0, platform.Validation("name", "status name is required")
	}
	if !ValidCategory(in.Category) {
		return model.WorkflowState{}, 0, platform.Validation("category",
			"category must be one of triage, backlog, unstarted, started, completed, canceled")
	}
	if in.Color == "" {
		in.Color = "#6b7280"
	}

	var out model.WorkflowState
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		team, err := s.requireTeamAccess(ctx, q, p, in.TeamID, authz.ActionWorkflowStateManage)
		if err != nil {
			return err
		}

		pos, err := s.positionInCategory(ctx, q, in.TeamID, in.Category, in.AfterStateID)
		if err != nil {
			return err
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateWorkflowState(ctx, store.CreateWorkflowStateParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			TeamID:      in.TeamID,
			Name:        in.Name,
			Description: in.Description,
			Color:       in.Color,
			Category:    in.Category,
			Position:    pos,
			IsDefault:   false,
			IsSystem:    false,
		})
		if err != nil {
			if store.IsUniqueViolation(err, "workflow_state_team_name_key") {
				return platform.Validation("name", "a status with that name already exists in this team")
			}
			if store.IsUniqueViolation(err, "workflow_state_team_singleton_category_key") {
				return platform.Validation("category", "this team already has a status in that category")
			}
			return platform.Internal(err)
		}

		out = toWorkflowState(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "workflowState",
			EntityID:   out.ID,
			Op:         OpUpsert,
			TeamID:     &in.TeamID,
			Scope:      authz.TeamScope(in.TeamID, team.Private),
			Payload:    out,
		})
		return err
	})
	return out, version, err
}

type UpdateWorkflowStateInput struct {
	ID          uuid.UUID
	Name        *string
	Description *string
	Color       *string
	// AfterStateID moves the status within its category. Reordering across categories is
	// not offered: a status's category determines its semantics, so moving one would
	// silently reinterpret every issue sitting in it.
	AfterStateID *uuid.UUID
	MakeDefault  bool
}

func (s *Service) UpdateWorkflowState(ctx context.Context, p *authz.Principal, in UpdateWorkflowStateInput) (model.WorkflowState, int64, error) {
	var out model.WorkflowState
	var version int64

	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetWorkflowState(ctx, in.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("status")
			}
			return platform.Internal(err)
		}

		team, err := s.requireTeamAccess(ctx, q, p, existing.TeamID, authz.ActionWorkflowStateManage)
		if err != nil {
			return err
		}
		if existing.IsSystem {
			return platform.Validation("id", "the Duplicate status is managed by the system and cannot be edited")
		}

		var newPos *string
		if in.AfterStateID != nil {
			pos, err := s.positionInCategory(ctx, q, existing.TeamID, existing.Category, in.AfterStateID)
			if err != nil {
				return err
			}
			newPos = &pos
		}

		if in.Name != nil {
			trimmed := strings.TrimSpace(*in.Name)
			if trimmed == "" {
				return platform.Validation("name", "status name is required")
			}
			in.Name = &trimmed
		}

		row, err := q.UpdateWorkflowState(ctx, store.UpdateWorkflowStateParams{
			ID:          in.ID,
			Name:        in.Name,
			Description: in.Description,
			Color:       in.Color,
			Position:    newPos,
		})
		if err != nil {
			if store.IsUniqueViolation(err, "workflow_state_team_name_key") {
				return platform.Validation("name", "a status with that name already exists in this team")
			}
			return platform.Internal(err)
		}

		if in.MakeDefault {
			if row.Category != CategoryBacklog && row.Category != CategoryUnstarted {
				return platform.Validation("makeDefault",
					"the default status must be in the backlog or unstarted category — a new issue may not be born started or finished")
			}
			// The partial unique index permits one default per team, so the old one has
			// to be cleared first, in this same transaction.
			if err := q.ClearDefaultWorkflowState(ctx, row.TeamID); err != nil {
				return platform.Internal(err)
			}
			if err := q.SetDefaultWorkflowState(ctx, row.ID); err != nil {
				return platform.Internal(err)
			}
			row.IsDefault = true
		}

		out = toWorkflowState(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "workflowState",
			EntityID:   out.ID,
			Op:         OpUpsert,
			TeamID:     &out.TeamID,
			Scope:      authz.TeamScope(out.TeamID, team.Private),
			Payload:    out,
		})
		return err
	})
	return out, version, err
}

// ArchiveWorkflowState retires a status. It refuses while issues still sit in it: the
// alternative is either orphaning those issues or silently moving them somewhere the user
// did not choose, and both are worse than an error message.
func (s *Service) ArchiveWorkflowState(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetWorkflowState(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("status")
			}
			return platform.Internal(err)
		}
		team, err := s.requireTeamAccess(ctx, q, p, existing.TeamID, authz.ActionWorkflowStateManage)
		if err != nil {
			return err
		}
		if existing.IsSystem {
			return platform.Validation("id", "the Duplicate status is managed by the system")
		}
		if existing.IsDefault {
			return platform.Validation("id", "set another status as the default before archiving this one")
		}

		count, err := q.CountIssuesInWorkflowState(ctx, id)
		if err != nil {
			return platform.Internal(err)
		}
		if count > 0 {
			return platform.Conflict(fmt.Sprintf("%d issues still use this status; move them first", count))
		}

		if err := q.ArchiveWorkflowState(ctx, id); err != nil {
			return platform.Internal(err)
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "workflowState",
			EntityID:   id,
			Op:         OpDelete,
			TeamID:     &existing.TeamID,
			Scope:      authz.TeamScope(existing.TeamID, team.Private),
		})
		return err
	})
	return version, err
}

func (s *Service) ListWorkflowStates(ctx context.Context, p *authz.Principal, teamID uuid.UUID) ([]model.WorkflowState, error) {
	if !p.Teams.Has(teamID) {
		return nil, platform.Forbidden("")
	}
	rows, err := s.db.Queries().ListWorkflowStatesForTeam(ctx, teamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.WorkflowState, 0, len(rows))
	for _, r := range rows {
		out = append(out, toWorkflowState(r))
	}
	return out, nil
}

// positionInCategory mints a fractional index placing a status after `after` within its
// category, or at the end when after is nil.
func (s *Service) positionInCategory(
	ctx context.Context, q *store.Queries, teamID uuid.UUID, category string, after *uuid.UUID,
) (string, error) {
	states, err := q.ListWorkflowStatesForTeam(ctx, teamID)
	if err != nil {
		return "", platform.Internal(err)
	}

	inCategory := make([]store.WorkflowState, 0, len(states))
	for _, st := range states {
		if st.Category == category {
			inCategory = append(inCategory, st)
		}
	}

	if after == nil {
		if len(inCategory) == 0 {
			return fractional.First(), nil
		}
		return fractional.After(inCategory[len(inCategory)-1].Position), nil
	}

	for i, st := range inCategory {
		if st.ID != *after {
			continue
		}
		next := ""
		if i+1 < len(inCategory) {
			next = inCategory[i+1].Position
		}
		pos, err := fractional.Between(st.Position, next)
		if err != nil {
			return "", platform.Internal(fmt.Errorf("position between %q and %q: %w", st.Position, next, err))
		}
		return pos, nil
	}

	return "", platform.Validation("afterStateId", "that status is not in the same category")
}
