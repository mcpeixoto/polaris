//go:build ee

package domain

import (
	"context"

	"github.com/google/uuid"

	eeaudit "github.com/peixotolabs/polaris/ee/audit"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// The enterprise half of the audit-log seam.
//
// THIS FILE IS THE ONLY PLACE IN THE CORE MODULE THAT IMPORTS ee/. That is what makes the
// separation real: `go build ./...` with no tags never compiles this file, so the ee module
// never enters the dependency graph and the community binary cannot contain it however the
// linker is invoked. scripts/lint-editions.sh checks exactly that, by reading
// `go list -deps` of the built binaries rather than by trusting these tags to be right.
//
// The file itself stays AGPL and stays thin on purpose: it is an adapter, and adapters are
// boring. Everything with any judgement in it is on one side or the other — the vocabulary
// and the redaction decisions in audit.go, the storage and the SQL in ee/audit.
//
// It exists at all because the two sides cannot name each other's types. ee/ is a separate
// module (see ee/LICENSE on why the code lives under the directory whose licence covers it),
// so Go's internal rule puts services/internal/* out of its reach entirely. Hence: core
// types in, ee types out, one conversion each way, in a file that only one edition compiles.

// eeRecorder adapts the commercial audit package to the seam the domain layer declares.
type eeRecorder struct{}

// newAuditRecorder returns the real thing. Paired with audit_core.go's version, which
// returns nil; exactly one of the two is compiled.
func newAuditRecorder() auditRecorder { return eeRecorder{} }

// Record converts a core entry into the storage shape and appends it inside the caller's
// transaction.
//
// q.Conn() rather than q: *store.Queries is an internal type the ee module cannot name, so
// the handle is passed through the structurally identical interface ee/audit declares. The
// handle is the caller's transaction, which is the point — the entry commits with the
// mutation it describes or not at all.
func (eeRecorder) Record(ctx context.Context, q *store.Queries, e AuditEntry) error {
	before, err := auditJSON(e.Before)
	if err != nil {
		return err
	}
	after, err := auditJSON(e.After)
	if err != nil {
		return err
	}

	entry := eeaudit.Entry{
		WorkspaceID: e.WorkspaceID,
		ActorUserID: e.Actor.ID,
		ActorType:   string(e.Actor.Type),
		ActorLabel:  e.ActorLabel,
		Action:      string(e.Action),
		TargetID:    e.TargetID,
		Before:      before,
		After:       after,
		IP:          e.IP,
	}
	// Empty strings become NULL rather than ''. The columns are nullable because the fact
	// is genuinely absent — a sign-in has no target, and a GraphQL mutation carries no
	// user agent today — and '' would render as a blank cell that reads like a value.
	if e.TargetType != "" {
		entry.TargetType = &e.TargetType
	}
	if e.TargetLabel != "" {
		entry.TargetLabel = &e.TargetLabel
	}
	if e.UserAgent != "" {
		entry.UserAgent = &e.UserAgent
	}

	if err := eeaudit.Record(ctx, q.Conn(), entry); err != nil {
		return platform.Internal(err)
	}
	return nil
}

// List reads a page back and converts it to the client-facing model.
func (eeRecorder) List(
	ctx context.Context, q *store.Queries, workspaceID uuid.UUID, first int, after *uuid.UUID,
) ([]model.AuditLogEntry, error) {
	rows, err := eeaudit.List(ctx, q.Conn(), workspaceID, first, after)
	if err != nil {
		return nil, platform.Internal(err)
	}

	out := make([]model.AuditLogEntry, 0, len(rows))
	for _, r := range rows {
		entry := model.AuditLogEntry{
			ID:          r.ID,
			ActorUserID: r.ActorUserID,
			ActorType:   r.ActorType,
			ActorLabel:  r.ActorLabel,
			Action:      r.Action,
			TargetType:  r.TargetType,
			TargetID:    r.TargetID,
			TargetLabel: r.TargetLabel,
			Before:      r.Before,
			After:       r.After,
			UserAgent:   r.UserAgent,
			CreatedAt:   r.CreatedAt,
		}
		if r.IP != nil {
			// Rendered here rather than carried as a netip.Addr, because the wire shape is
			// a string in both transports and the zero Addr would serialise as "invalid IP"
			// if it ever escaped a nil check.
			text := r.IP.String()
			entry.IP = &text
		}
		out = append(out, entry)
	}
	return out, nil
}
