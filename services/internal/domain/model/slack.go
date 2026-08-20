package model

import (
	"time"

	"github.com/google/uuid"
)

// SlackConnection is the workspace's Slack install, minus the incoming-webhook URL.
//
// On the sync stream so every client can show that Slack is connected and which team
// slash-created issues land on. The webhook URL stays in a column listing queries never
// select.
type SlackConnection struct {
	ID             uuid.UUID  `json:"id"`
	WorkspaceID    uuid.UUID  `json:"workspaceId"`
	CreatorID      uuid.UUID  `json:"creatorId"`
	Enabled        bool       `json:"enabled"`
	DefaultTeamID  uuid.UUID  `json:"defaultTeamId"`
	ChannelName    *string    `json:"channelName,omitempty"`
	NotifyIssues   bool       `json:"notifyIssues"`
	NotifyComments bool       `json:"notifyComments"`
	ConnectedAt    *time.Time `json:"connectedAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}
