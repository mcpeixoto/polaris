package graph

import (
	"strings"

	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

func toSlackConnection(c model.SlackConnection) generated.SlackConnection {
	return generated.SlackConnection{
		ID:             c.ID,
		WorkspaceID:    c.WorkspaceID,
		CreatorID:      c.CreatorID,
		Enabled:        c.Enabled,
		DefaultTeamID:  c.DefaultTeamID,
		ChannelName:    c.ChannelName,
		NotifyIssues:   c.NotifyIssues,
		NotifyComments: c.NotifyComments,
		AsksEnabled:    c.AsksEnabled,
		ConnectedAt:    c.ConnectedAt,
		CreatedAt:      c.CreatedAt,
		UpdatedAt:      c.UpdatedAt,
	}
}

func slackInboundURL(publicURL, workspaceID, kind string) string {
	base := strings.TrimRight(strings.TrimSpace(publicURL), "/")
	path := "/webhooks/slack/" + workspaceID + "/" + kind
	if base == "" {
		return path
	}
	return base + path
}
