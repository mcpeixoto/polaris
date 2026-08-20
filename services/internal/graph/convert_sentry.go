package graph

import (
	"strings"

	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

func toSentryConnection(c model.SentryConnection) generated.SentryConnection {
	return generated.SentryConnection{
		ID:               c.ID,
		WorkspaceID:      c.WorkspaceID,
		CreatorID:        c.CreatorID,
		Enabled:          c.Enabled,
		DefaultTeamID:    c.DefaultTeamID,
		OrganizationSlug: c.OrganizationSlug,
		ConnectedAt:      c.ConnectedAt,
		CreatedAt:        c.CreatedAt,
		UpdatedAt:        c.UpdatedAt,
	}
}

func sentryWebhookURL(publicURL string, workspaceID string) string {
	base := strings.TrimRight(strings.TrimSpace(publicURL), "/")
	if base == "" {
		return "/webhooks/sentry/" + workspaceID
	}
	return base + "/webhooks/sentry/" + workspaceID
}
