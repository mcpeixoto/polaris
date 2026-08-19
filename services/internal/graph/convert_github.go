package graph

import (
	"strings"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// The GitHub types live here rather than in schema.resolvers.go because gqlgen rewrites
// that file and has already silently commented out helpers that sat next to a resolver.

func toGitHubConnection(c model.GitHubConnection) generated.GitHubConnection {
	return generated.GitHubConnection{
		ID:               c.ID,
		WorkspaceID:      c.WorkspaceID,
		CreatorID:        c.CreatorID,
		Enabled:          c.Enabled,
		OrgLogin:         c.OrgLogin,
		BranchNameFormat: c.BranchNameFormat,
		LinkCommits:      c.LinkCommits,
		Linkbacks:        c.Linkbacks,
		ConnectedAt:      c.ConnectedAt,
		CreatedAt:        c.CreatedAt,
		UpdatedAt:        c.UpdatedAt,
	}
}

func toGitHubUserLink(l model.GitHubUserLink) generated.GitHubUserLink {
	return generated.GitHubUserLink{
		ID:          l.ID,
		WorkspaceID: l.WorkspaceID,
		UserID:      l.UserID,
		GithubLogin: l.GitHubLogin,
		CreatedAt:   l.CreatedAt,
		UpdatedAt:   l.UpdatedAt,
	}
}

func toGitHubTeamAutomation(a domain.GitHubTeamAutomation) generated.GitHubTeamAutomation {
	return generated.GitHubTeamAutomation{
		TeamID:                 a.TeamID,
		Configured:             a.Configured,
		DraftedStateID:         a.DraftedStateID,
		OpenedStateID:          a.OpenedStateID,
		ReviewRequestedStateID: a.ReviewRequestedStateID,
		ReadyForMergeStateID:   a.ReadyForMergeStateID,
		MergedStateID:          a.MergedStateID,
	}
}

func githubTeamAutomationPayload(a domain.GitHubTeamAutomation) *generated.GitHubTeamAutomationPayload {
	out := toGitHubTeamAutomation(a)
	return &generated.GitHubTeamAutomationPayload{GithubTeamAutomation: &out}
}

func githubCommitWebhookURL(publicURL string, workspaceID string) string {
	base := strings.TrimRight(strings.TrimSpace(publicURL), "/")
	if base == "" {
		return "/webhooks/github/commits/" + workspaceID
	}
	return base + "/webhooks/github/commits/" + workspaceID
}

func isNotFound(err error) bool {
	return platform.CodeOf(err) == platform.CodeNotFound
}
