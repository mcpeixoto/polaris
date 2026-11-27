package model

import (
	"time"

	"github.com/google/uuid"
)

// Import job statuses. A job is queued until a worker claims it, running while it copies,
// and then done or failed for good — a failed import is retried by starting another one,
// which the import links let pick up where this one stopped.
const (
	ImportStatusQueued  = "queued"
	ImportStatusRunning = "running"
	ImportStatusDone    = "done"
	ImportStatusFailed  = "failed"

	ImportSourceLinear = "linear"
)

// ImportJob is one import somebody started. The source's API key is deliberately not a
// field: the type is what GraphQL returns, and a struct that could carry the key is one a
// future resolver could serialise.
type ImportJob struct {
	ID          uuid.UUID            `json:"id"`
	WorkspaceID uuid.UUID            `json:"workspaceId"`
	Source      string               `json:"source"`
	Status      string               `json:"status"`
	CreatedBy   *uuid.UUID           `json:"createdBy,omitempty"`
	Progress    []ImportProgressStep `json:"progress"`
	Error       *string              `json:"error,omitempty"`
	CreatedAt   time.Time            `json:"createdAt"`
	StartedAt   *time.Time           `json:"startedAt,omitempty"`
	FinishedAt  *time.Time           `json:"finishedAt,omitempty"`
}

// ImportProgressStep is how far one kind of entity has got.
type ImportProgressStep struct {
	Entity string `json:"entity"`
	Done   int    `json:"done"`
	Total  int    `json:"total"`
}
