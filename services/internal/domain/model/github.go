package model

import (
	"time"

	"github.com/google/uuid"
)

// GitHubConnection is the workspace's GitHub install, minus credentials.
//
// On the sync stream so every client can format a git branch name and show that GitHub
// is connected without a settings round-trip. The commit-webhook secret and any OAuth
// token stay in columns listing queries never select.
type GitHubConnection struct {
	ID               uuid.UUID  `json:"id"`
	WorkspaceID      uuid.UUID  `json:"workspaceId"`
	CreatorID        uuid.UUID  `json:"creatorId"`
	Enabled          bool       `json:"enabled"`
	OrgLogin         *string    `json:"orgLogin,omitempty"`
	BranchNameFormat string     `json:"branchNameFormat"`
	LinkCommits      bool       `json:"linkCommits"`
	ConnectedAt      *time.Time `json:"connectedAt,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

// GitHubUserLink is one person's GitHub login, scoped to that person.
//
// Tokens are absent for the same reason APIKey has no token. The replica only needs to
// know "I am connected as @login" so the settings screen and attribution can render.
type GitHubUserLink struct {
	ID           uuid.UUID `json:"id"`
	WorkspaceID  uuid.UUID `json:"workspaceId"`
	UserID       uuid.UUID `json:"userId"`
	GitHubLogin  string    `json:"githubLogin"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}
