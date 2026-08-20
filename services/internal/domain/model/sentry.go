package model

import (
	"time"

	"github.com/google/uuid"
)

// SentryConnection is the workspace's Sentry install, minus the webhook secret.
//
// On the sync stream so every client can show that Sentry is connected and which team
// new issues land on without a settings round-trip. The webhook secret stays in a
// column listing queries never select.
type SentryConnection struct {
	ID               uuid.UUID  `json:"id"`
	WorkspaceID      uuid.UUID  `json:"workspaceId"`
	CreatorID        uuid.UUID  `json:"creatorId"`
	Enabled          bool       `json:"enabled"`
	DefaultTeamID    uuid.UUID  `json:"defaultTeamId"`
	OrganizationSlug *string    `json:"organizationSlug,omitempty"`
	ConnectedAt      *time.Time `json:"connectedAt,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}
