package domain

import (
	"context"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// GitHubTeamAutomation is the per-team mapping from a GitHub PR event to a workflow
// status. It is not a replicated entity: clients load it on the team settings page.
//
// Configured is false when the team has no row. The webhook then uses the product
// defaults. A present row with a nil field is an explicit no-op for that event.
type GitHubTeamAutomation struct {
	TeamID                 uuid.UUID
	Configured             bool
	DraftedStateID         *uuid.UUID
	OpenedStateID          *uuid.UUID
	ReviewRequestedStateID *uuid.UUID
	ReadyForMergeStateID   *uuid.UUID
	MergedStateID          *uuid.UUID
}

type UpdateGitHubTeamAutomationInput struct {
	TeamID                 uuid.UUID
	DraftedStateID         *uuid.UUID
	OpenedStateID          *uuid.UUID
	ReviewRequestedStateID *uuid.UUID
	ReadyForMergeStateID   *uuid.UUID
	MergedStateID          *uuid.UUID
}

func (s *Service) GetGitHubTeamAutomation(
	ctx context.Context, p *authz.Principal, teamID uuid.UUID,
) (GitHubTeamAutomation, error) {
	team, err := s.db.Queries().GetTeam(ctx, teamID)
	if err != nil {
		if store.IsNotFound(err) {
			return GitHubTeamAutomation{}, platform.NotFound("team")
		}
		return GitHubTeamAutomation{}, platform.Internal(err)
	}
	if team.WorkspaceID != p.WorkspaceID {
		return GitHubTeamAutomation{}, platform.NotFound("team")
	}
	if !p.Role.IsAdmin() && !p.Teams.Has(teamID) {
		return GitHubTeamAutomation{}, platform.Forbidden("")
	}
	return s.loadGitHubTeamAutomation(ctx, p.WorkspaceID, teamID)
}

func (s *Service) UpdateGitHubTeamAutomation(
	ctx context.Context, p *authz.Principal, in UpdateGitHubTeamAutomationInput,
) (GitHubTeamAutomation, error) {
	var out GitHubTeamAutomation
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		team, err := s.requireTeamAccess(ctx, q, p, in.TeamID, authz.ActionTeamUpdate)
		if err != nil {
			return err
		}
		if err := validateGitHubMappedState(ctx, q, "draftedStateId", in.TeamID, in.DraftedStateID); err != nil {
			return err
		}
		if err := validateGitHubMappedState(ctx, q, "openedStateId", in.TeamID, in.OpenedStateID); err != nil {
			return err
		}
		if err := validateGitHubMappedState(ctx, q, "reviewRequestedStateId", in.TeamID, in.ReviewRequestedStateID); err != nil {
			return err
		}
		if err := validateGitHubMappedState(ctx, q, "readyForMergeStateId", in.TeamID, in.ReadyForMergeStateID); err != nil {
			return err
		}
		if err := validateGitHubMappedState(ctx, q, "mergedStateId", in.TeamID, in.MergedStateID); err != nil {
			return err
		}
		row, err := q.UpsertGitHubTeamAutomation(ctx, store.UpsertGitHubTeamAutomationParams{
			TeamID:                 in.TeamID,
			WorkspaceID:            team.WorkspaceID,
			DraftedStateID:         in.DraftedStateID,
			OpenedStateID:          in.OpenedStateID,
			ReviewRequestedStateID: in.ReviewRequestedStateID,
			ReadyForMergeStateID:   in.ReadyForMergeStateID,
			MergedStateID:          in.MergedStateID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = gitHubTeamAutomationFromStore(row)
		return nil
	})
	return out, err
}

func (s *Service) DeleteGitHubTeamAutomation(
	ctx context.Context, p *authz.Principal, teamID uuid.UUID,
) (GitHubTeamAutomation, error) {
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := s.requireTeamAccess(ctx, q, p, teamID, authz.ActionTeamUpdate); err != nil {
			return err
		}
		if err := q.DeleteGitHubTeamAutomation(ctx, store.DeleteGitHubTeamAutomationParams{
			WorkspaceID: p.WorkspaceID, TeamID: teamID,
		}); err != nil {
			return platform.Internal(err)
		}
		return nil
	})
	if err != nil {
		return GitHubTeamAutomation{}, err
	}
	return GitHubTeamAutomation{TeamID: teamID}, nil
}

func (s *Service) loadGitHubTeamAutomation(
	ctx context.Context, workspaceID, teamID uuid.UUID,
) (GitHubTeamAutomation, error) {
	row, err := s.db.Queries().GetGitHubTeamAutomation(ctx, store.GetGitHubTeamAutomationParams{
		WorkspaceID: workspaceID, TeamID: teamID,
	})
	if err != nil {
		if store.IsNotFound(err) {
			return GitHubTeamAutomation{TeamID: teamID}, nil
		}
		return GitHubTeamAutomation{}, platform.Internal(err)
	}
	return gitHubTeamAutomationFromStore(row), nil
}

func gitHubTeamAutomationFromStore(row store.GithubTeamAutomation) GitHubTeamAutomation {
	return GitHubTeamAutomation{
		TeamID:                 row.TeamID,
		Configured:             true,
		DraftedStateID:         row.DraftedStateID,
		OpenedStateID:          row.OpenedStateID,
		ReviewRequestedStateID: row.ReviewRequestedStateID,
		ReadyForMergeStateID:   row.ReadyForMergeStateID,
		MergedStateID:          row.MergedStateID,
	}
}

func validateGitHubMappedState(
	ctx context.Context, q *store.Queries, field string, teamID uuid.UUID, stateID *uuid.UUID,
) error {
	if stateID == nil {
		return nil
	}
	st, err := q.GetWorkflowState(ctx, *stateID)
	if err != nil {
		if store.IsNotFound(err) {
			return platform.Validation(field, "status must belong to this team")
		}
		return platform.Internal(err)
	}
	if st.TeamID != teamID || st.ArchivedAt != nil {
		return platform.Validation(field, "status must belong to this team")
	}
	if st.Category == CategoryDuplicate {
		return platform.Validation(field, "duplicate is not a mapping target")
	}
	return nil
}

func (a GitHubTeamAutomation) mappedState(ev githubPREvent) *uuid.UUID {
	switch ev {
	case githubPRDrafted:
		return a.DraftedStateID
	case githubPROpened:
		return a.OpenedStateID
	case githubPRReviewRequested:
		return a.ReviewRequestedStateID
	case githubPRReadyForMerge:
		return a.ReadyForMergeStateID
	case githubPRMerged:
		return a.MergedStateID
	default:
		return nil
	}
}

func githubPRAutomationEvent(in LinkGitHubPullRequestInput) githubPREvent {
	switch {
	case in.Merged:
		return githubPRMerged
	case in.Draft:
		return githubPRDrafted
	case in.ReviewRequested:
		return githubPRReviewRequested
	case strings.EqualFold(strings.TrimSpace(in.MergeableState), "clean"):
		return githubPRReadyForMerge
	default:
		return githubPROpened
	}
}
