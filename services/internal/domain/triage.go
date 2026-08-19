package domain

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/fractional"
	"github.com/peixotolabs/polaris/services/internal/notify"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Triage is a status category and a per-team switch. Off, the team has no intake queue
// and new issues land in the default status. On, a workspace member who is not in the
// team — and anyone filing from the inbox itself — lands in the reserved Triage status,
// which every ordinary view excludes unless the filter names a status.
//
// Duplicate is the other reserved status: system-managed, one per team, reached only by
// marking an issue as a duplicate of another. Enabling triage creates both if they are
// missing. Disabling does not delete them; issues may still sit there.

type UpdateTeamTriageInput struct {
	TeamID          uuid.UUID
	Enabled         *bool
	RequirePriority *bool
}

func (s *Service) UpdateTeamTriage(
	ctx context.Context, p *authz.Principal, in UpdateTeamTriageInput,
) (model.Team, int64, error) {
	var out model.Team
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := s.requireTeamAccess(ctx, q, p, in.TeamID, authz.ActionTeamUpdate)
		if err != nil {
			return err
		}

		row, err := q.UpdateTeamTriage(ctx, store.UpdateTeamTriageParams{
			ID:                    in.TeamID,
			TriageEnabled:         in.Enabled,
			TriageRequirePriority: in.RequirePriority,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toTeam(row)

		var extra []Change
		if out.TriageEnabled && (!before.TriageEnabled || in.Enabled != nil) {
			extra, err = ensureTriageStatuses(ctx, q, row)
			if err != nil {
				return err
			}
		}

		changes := append([]Change{{
			EntityType: "team", EntityID: out.ID, Op: OpUpsert, TeamID: &out.ID,
			Scope: authz.TeamScope(out.ID, out.Private), Payload: out,
		}}, extra...)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...)
		return err
	})
	return out, version, err
}

func ensureTriageStatuses(ctx context.Context, q *store.Queries, team store.Team) ([]Change, error) {
	wanted := []struct {
		category string
		name     string
		color    string
		system   bool
	}{
		{CategoryTriage, "Triage", "#f2a65a", false},
		{CategoryDuplicate, "Duplicate", "#95a2b3", true},
	}

	var extra []Change
	for _, want := range wanted {
		st, err := q.GetWorkflowStateByTeamAndCategory(ctx, store.GetWorkflowStateByTeamAndCategoryParams{
			TeamID: team.ID, Category: want.category,
		})
		switch {
		case err == nil:
			if st.ArchivedAt != nil {
				st, err = q.UnarchiveWorkflowState(ctx, st.ID)
				if err != nil {
					return nil, platform.Internal(err)
				}
				out := toWorkflowState(st)
				extra = append(extra, Change{
					EntityType: "workflowState", EntityID: out.ID, Op: OpUpsert, TeamID: &team.ID,
					Scope: authz.TeamScope(team.ID, team.Private), Payload: out,
				})
			}
		case store.IsNotFound(err):
			id, err := uuid.NewV7()
			if err != nil {
				return nil, platform.Internal(err)
			}
			st, err = q.CreateWorkflowState(ctx, store.CreateWorkflowStateParams{
				ID:          id,
				WorkspaceID: team.WorkspaceID,
				TeamID:      team.ID,
				Name:        want.name,
				Color:       want.color,
				Category:    want.category,
				Position:    fractional.First(),
				IsDefault:   false,
				IsSystem:    want.system,
			})
			if err != nil {
				return nil, platform.Internal(fmt.Errorf("seed %s status: %w", want.category, err))
			}
			out := toWorkflowState(st)
			extra = append(extra, Change{
				EntityType: "workflowState", EntityID: out.ID, Op: OpUpsert, TeamID: &team.ID,
				Scope: authz.TeamScope(team.ID, team.Private), Payload: out,
			})
		default:
			return nil, platform.Internal(err)
		}
	}
	return extra, nil
}

func (s *Service) AcceptTriageIssue(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (model.Issue, int64, error) {
	return s.leaveTriage(ctx, p, id, func(ctx context.Context, q *store.Queries, team store.Team) (store.WorkflowState, error) {
		st, err := q.GetDefaultWorkflowStateForTeam(ctx, team.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return store.WorkflowState{}, platform.Internal(errNoDefaultState{team.ID})
			}
			return store.WorkflowState{}, platform.Internal(err)
		}
		return st, nil
	}, nil)
}

func (s *Service) DeclineTriageIssue(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (model.Issue, int64, error) {
	return s.leaveTriage(ctx, p, id, func(ctx context.Context, q *store.Queries, team store.Team) (store.WorkflowState, error) {
		states, err := q.ListWorkflowStatesForTeam(ctx, team.ID)
		if err != nil {
			return store.WorkflowState{}, platform.Internal(err)
		}
		for _, st := range states {
			if st.Category == CategoryCanceled {
				return st, nil
			}
		}
		return store.WorkflowState{}, platform.Validation("stateId", "this team has no canceled status to decline into")
	}, nil)
}

func (s *Service) MarkIssueDuplicate(
	ctx context.Context, p *authz.Principal, id, canonicalID uuid.UUID,
) (model.Issue, int64, error) {
	if id == canonicalID {
		return model.Issue{}, 0, platform.Validation("canonicalId", "an issue cannot be a duplicate of itself")
	}
	return s.leaveTriage(ctx, p, id, func(ctx context.Context, q *store.Queries, team store.Team) (store.WorkflowState, error) {
		st, err := q.GetWorkflowStateByTeamAndCategory(ctx, store.GetWorkflowStateByTeamAndCategoryParams{
			TeamID: team.ID, Category: CategoryDuplicate,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return store.WorkflowState{}, platform.Validation("stateId", "this team has no duplicate status")
			}
			return store.WorkflowState{}, platform.Internal(err)
		}
		return st, nil
	}, &canonicalID)
}

func (s *Service) SnoozeIssue(
	ctx context.Context, p *authz.Principal, id uuid.UUID, until time.Time,
) (model.Issue, int64, error) {
	if until.Before(time.Now()) {
		return model.Issue{}, 0, platform.Validation("until", "a snooze has to be in the future")
	}

	var out model.Issue
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := q.GetIssueForUpdate(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("issue")
			}
			return platform.Internal(err)
		}
		team, err := s.requireTeamAccess(ctx, q, p, before.TeamID, authz.ActionIssueUpdate)
		if err != nil {
			return err
		}
		if err := requireInTriage(ctx, q, before); err != nil {
			return err
		}

		row, err := q.SetIssueSnooze(ctx, store.SetIssueSnoozeParams{ID: id, SnoozedUntil: &until})
		if err != nil {
			return platform.Internal(err)
		}
		out = toIssue(row, team.Key)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "issue", EntityID: id, Op: OpUpsert, TeamID: &before.TeamID,
			Scope:         authz.TeamScope(before.TeamID, team.Private),
			Payload:       out,
			ChangedFields: []string{"snoozedUntil"},
		})
		return err
	})
	return out, version, err
}

type destState func(context.Context, *store.Queries, store.Team) (store.WorkflowState, error)

func (s *Service) leaveTriage(
	ctx context.Context, p *authz.Principal, id uuid.UUID, dest destState, canonical *uuid.UUID,
) (model.Issue, int64, error) {
	var out model.Issue
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := q.GetIssueForUpdate(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("issue")
			}
			return platform.Internal(err)
		}
		team, err := s.requireTeamAccess(ctx, q, p, before.TeamID, authz.ActionIssueUpdate)
		if err != nil {
			return err
		}
		if err := requireInTriage(ctx, q, before); err != nil {
			return err
		}
		if err := requirePriorityToLeaveTriage(team, int(before.Priority)); err != nil {
			return err
		}

		st, err := dest(ctx, q, team)
		if err != nil {
			return err
		}

		sortOrder, err := s.sortOrderFor(ctx, q, before.TeamID, st.ID, nil)
		if err != nil {
			return err
		}

		row, err := q.UpdateIssue(ctx, store.UpdateIssueParams{
			ID:            id,
			StateID:       &st.ID,
			SortOrder:     &sortOrder,
			SetTimestamps: true,
			StartedAt:     startedAtFor(st.Category, before.StartedAt),
			CompletedAt:   completedAtFor(st.Category),
			CanceledAt:    canceledAtFor(st.Category),
			ClearSnooze:   true,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toIssue(row, team.Key)

		oldState, err := q.GetWorkflowState(ctx, before.StateID)
		if err != nil {
			return platform.Internal(err)
		}
		changes := []Change{{
			EntityType: "issue", EntityID: id, Op: OpUpsert, TeamID: &before.TeamID,
			Scope:         authz.TeamScope(before.TeamID, team.Private),
			Payload:       out,
			ChangedFields: []string{notify.FieldState, "snoozedUntil"},
		}}

		if canonical != nil {
			rel, err := s.linkDuplicate(ctx, q, p, before, *canonical)
			if err != nil {
				return err
			}
			changes = append(changes, Change{
				EntityType: "issueRelation", EntityID: rel.ID, Op: OpUpsert,
				Scope:   relationScope(rel.TeamID, rel.RelatedTeamID),
				Payload: rel,
			})
		}

		if version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...); err != nil {
			return err
		}
		return s.em.History(ctx, q, p.WorkspaceID, p.Actor(), before.CreatedAt, HistoryEntry{
			IssueID: id, Kind: "state", FromValue: oldState.Name, ToValue: st.Name,
		})
	})
	return out, version, err
}

func (s *Service) linkDuplicate(
	ctx context.Context, q *store.Queries, p *authz.Principal, subject store.Issue, canonicalID uuid.UUID,
) (model.IssueRelation, error) {
	object, err := q.GetIssue(ctx, canonicalID)
	if err != nil {
		if store.IsNotFound(err) {
			return model.IssueRelation{}, platform.NotFound("issue")
		}
		return model.IssueRelation{}, platform.Internal(err)
	}
	if !authz.CanRelateIssues(p, subject.TeamID, object.TeamID) {
		return model.IssueRelation{}, platform.NotFound("issue")
	}

	relID, err := uuid.NewV7()
	if err != nil {
		return model.IssueRelation{}, platform.Internal(err)
	}
	row, err := q.CreateIssueRelation(ctx, store.CreateIssueRelationParams{
		ID:             relID,
		WorkspaceID:    p.WorkspaceID,
		IssueID:        subject.ID,
		RelatedIssueID: canonicalID,
		Type:           model.RelationDuplicate,
		CreatedBy:      &p.UserID,
	})
	if err != nil {
		if store.IsUniqueViolation(err, "issue_relation_key") {
			return model.IssueRelation{}, platform.Validation("canonicalId", "these issues are already linked that way")
		}
		return model.IssueRelation{}, platform.Internal(err)
	}
	return toIssueRelation(row), nil
}

func requireInTriage(ctx context.Context, q *store.Queries, issue store.Issue) error {
	st, err := q.GetWorkflowState(ctx, issue.StateID)
	if err != nil {
		return platform.Internal(err)
	}
	if st.Category != CategoryTriage {
		return platform.Validation("id", "that issue is not in triage")
	}
	return nil
}

func requirePriorityToLeaveTriage(team store.Team, priority int) error {
	if team.TriageRequirePriority && priority == 0 {
		return platform.Validation("priority", "this team requires a priority before an issue can leave triage")
	}
	return nil
}

func (s *Service) unsnooze(
	ctx context.Context, q *store.Queries, p *authz.Principal, team store.Team, issue store.Issue,
) (int64, error) {
	if issue.SnoozedUntil == nil {
		return 0, nil
	}
	row, err := q.SetIssueSnooze(ctx, store.SetIssueSnoozeParams{ID: issue.ID})
	if err != nil {
		return 0, platform.Internal(err)
	}
	out := toIssue(row, team.Key)
	return s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
		EntityType: "issue", EntityID: issue.ID, Op: OpUpsert, TeamID: &issue.TeamID,
		Scope:         authz.TeamScope(issue.TeamID, team.Private),
		Payload:       out,
		ChangedFields: []string{"snoozedUntil"},
	})
}
