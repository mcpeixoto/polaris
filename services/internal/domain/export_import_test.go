package domain

import (
	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
)

// NewImportRunForTest builds the handle RunQueuedImport hands a source, without a queue
// or a source behind it, so a test can drive one import write directly.
func NewImportRunForTest(s *Service, p *authz.Principal, jobID, workspaceID uuid.UUID) *ImportRun {
	return &ImportRun{s: s, JobID: jobID, WorkspaceID: workspaceID, Source: "linear", p: p}
}
