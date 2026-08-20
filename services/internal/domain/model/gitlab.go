package model

import (
	"time"

	"github.com/google/uuid"
)

// GitLabConnection is the workspace's GitLab instance, minus credentials.
//
// On the sync stream so every client can format a git branch name and show that GitLab
// is connected without a settings round-trip. The webhook secret and any access token
// stay in columns listing queries never select.
type GitLabConnection struct {
	ID               uuid.UUID  `json:"id"`
	WorkspaceID      uuid.UUID  `json:"workspaceId"`
	CreatorID        uuid.UUID  `json:"creatorId"`
	Enabled          bool       `json:"enabled"`
	InstanceURL      string     `json:"instanceUrl"`
	BranchNameFormat string     `json:"branchNameFormat"`
	LinkCommits      bool       `json:"linkCommits"`
	Linkbacks        bool       `json:"linkbacks"`
	ConnectedAt      *time.Time `json:"connectedAt,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

// GitLabUserLink is one person's GitLab username, scoped to that person.
//
// Tokens are absent for the same reason APIKey has no token. The replica only needs to
// know "I am connected as @username" so the settings screen and attribution can render.
type GitLabUserLink struct {
	ID             uuid.UUID `json:"id"`
	WorkspaceID    uuid.UUID `json:"workspaceId"`
	UserID         uuid.UUID `json:"userId"`
	GitLabUsername string    `json:"gitlabUsername"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}
