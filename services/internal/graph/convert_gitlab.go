package graph

import (
	"strings"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

func toGitLabConnection(c model.GitLabConnection) generated.GitLabConnection {
	return generated.GitLabConnection{
		ID:               c.ID,
		WorkspaceID:      c.WorkspaceID,
		CreatorID:        c.CreatorID,
		Enabled:          c.Enabled,
		InstanceURL:      c.InstanceURL,
		BranchNameFormat: c.BranchNameFormat,
		LinkCommits:      c.LinkCommits,
		Linkbacks:        c.Linkbacks,
		ConnectedAt:      c.ConnectedAt,
		CreatedAt:        c.CreatedAt,
		UpdatedAt:        c.UpdatedAt,
	}
}

func toGitLabUserLink(l model.GitLabUserLink) generated.GitLabUserLink {
	return generated.GitLabUserLink{
		ID:             l.ID,
		WorkspaceID:    l.WorkspaceID,
		UserID:         l.UserID,
		GitlabUsername: l.GitLabUsername,
		CreatedAt:      l.CreatedAt,
		UpdatedAt:      l.UpdatedAt,
	}
}

func toGitLabTeamAutomation(a domain.GitLabTeamAutomation) generated.GitLabTeamAutomation {
	return generated.GitLabTeamAutomation{
		TeamID:                 a.TeamID,
		Configured:             a.Configured,
		DraftedStateID:         a.DraftedStateID,
		OpenedStateID:          a.OpenedStateID,
		ReviewRequestedStateID: a.ReviewRequestedStateID,
		ReadyForMergeStateID:   a.ReadyForMergeStateID,
		MergedStateID:          a.MergedStateID,
	}
}

func gitlabTeamAutomationPayload(a domain.GitLabTeamAutomation) *generated.GitLabTeamAutomationPayload {
	out := toGitLabTeamAutomation(a)
	return &generated.GitLabTeamAutomationPayload{GitlabTeamAutomation: &out}
}

func gitlabWebhookURL(publicURL string, workspaceID string) string {
	base := strings.TrimRight(strings.TrimSpace(publicURL), "/")
	if base == "" {
		return "/webhooks/gitlab/" + workspaceID
	}
	return base + "/webhooks/gitlab/" + workspaceID
}
