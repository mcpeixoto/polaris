package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// GitLabTeamAutomation is the per-team mapping from a GitLab MR event to a workflow
// status. It is not a replicated entity: clients load it on the team settings page.
//
// Configured is false when the team has no row. The webhook then uses the product
// defaults. A present row with a nil field is an explicit no-op for that event.
type GitLabTeamAutomation struct {
	TeamID                 uuid.UUID
	Configured             bool
	DraftedStateID         *uuid.UUID
	OpenedStateID          *uuid.UUID
	ReviewRequestedStateID *uuid.UUID
	ReadyForMergeStateID   *uuid.UUID
	MergedStateID          *uuid.UUID
}

type UpdateGitLabTeamAutomationInput struct {
	TeamID                 uuid.UUID
	DraftedStateID         *uuid.UUID
	OpenedStateID          *uuid.UUID
	ReviewRequestedStateID *uuid.UUID
	ReadyForMergeStateID   *uuid.UUID
	MergedStateID          *uuid.UUID
}

func (s *Service) GetGitLabTeamAutomation(
	ctx context.Context, p *authz.Principal, teamID uuid.UUID,
) (GitLabTeamAutomation, error) {
	team, err := s.db.Queries().GetTeam(ctx, teamID)
	if err != nil {
		if store.IsNotFound(err) {
			return GitLabTeamAutomation{}, platform.NotFound("team")
		}
		return GitLabTeamAutomation{}, platform.Internal(err)
	}
	if team.WorkspaceID != p.WorkspaceID {
		return GitLabTeamAutomation{}, platform.NotFound("team")
	}
	if !p.Role.IsAdmin() && !p.Teams.Has(teamID) {
		return GitLabTeamAutomation{}, platform.Forbidden("")
	}
	return s.loadGitLabTeamAutomation(ctx, p.WorkspaceID, teamID)
}

func (s *Service) UpdateGitLabTeamAutomation(
	ctx context.Context, p *authz.Principal, in UpdateGitLabTeamAutomationInput,
) (GitLabTeamAutomation, error) {
	var out GitLabTeamAutomation
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
		row, err := q.UpsertGitLabTeamAutomation(ctx, store.UpsertGitLabTeamAutomationParams{
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
		out = gitLabTeamAutomationFromStore(row)
		return nil
	})
	return out, err
}

func (s *Service) DeleteGitLabTeamAutomation(
	ctx context.Context, p *authz.Principal, teamID uuid.UUID,
) (GitLabTeamAutomation, error) {
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := s.requireTeamAccess(ctx, q, p, teamID, authz.ActionTeamUpdate); err != nil {
			return err
		}
		if err := q.DeleteGitLabTeamAutomation(ctx, store.DeleteGitLabTeamAutomationParams{
			WorkspaceID: p.WorkspaceID, TeamID: teamID,
		}); err != nil {
			return platform.Internal(err)
		}
		return nil
	})
	if err != nil {
		return GitLabTeamAutomation{}, err
	}
	return GitLabTeamAutomation{TeamID: teamID}, nil
}

func (s *Service) loadGitLabTeamAutomation(
	ctx context.Context, workspaceID, teamID uuid.UUID,
) (GitLabTeamAutomation, error) {
	row, err := s.db.Queries().GetGitLabTeamAutomation(ctx, store.GetGitLabTeamAutomationParams{
		WorkspaceID: workspaceID, TeamID: teamID,
	})
	if err != nil {
		if store.IsNotFound(err) {
			return GitLabTeamAutomation{TeamID: teamID}, nil
		}
		return GitLabTeamAutomation{}, platform.Internal(err)
	}
	return gitLabTeamAutomationFromStore(row), nil
}

func gitLabTeamAutomationFromStore(row store.GitlabTeamAutomation) GitLabTeamAutomation {
	return GitLabTeamAutomation{
		TeamID:                 row.TeamID,
		Configured:             true,
		DraftedStateID:         row.DraftedStateID,
		OpenedStateID:          row.OpenedStateID,
		ReviewRequestedStateID: row.ReviewRequestedStateID,
		ReadyForMergeStateID:   row.ReadyForMergeStateID,
		MergedStateID:          row.MergedStateID,
	}
}

func (a GitLabTeamAutomation) mappedState(ev gitlabMREvent) *uuid.UUID {
	switch ev {
	case gitlabMRDrafted:
		return a.DraftedStateID
	case gitlabMROpened:
		return a.OpenedStateID
	case gitlabMRReviewRequested:
		return a.ReviewRequestedStateID
	case gitlabMRReadyForMerge:
		return a.ReadyForMergeStateID
	case gitlabMRMerged:
		return a.MergedStateID
	default:
		return nil
	}
}
