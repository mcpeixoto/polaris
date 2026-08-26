//go:build ee

// Package audit is the enterprise audit log: the permanent, workspace-wide record of who
// did what, readable by administrators long after the person it describes has gone.
//
// COMMERCIALLY LICENSED. See ../LICENSE. This is not AGPL code, and the `ee` build tag on
// every file in this package is what keeps it out of the community binary — not a runtime
// flag, because "a licence check that can be flipped by editing a boolean is not a licence
// check" (../README.md). scripts/lint-editions.sh fails the build if a file here loses its
// tag or if a core binary ever links this package.
//
// # Why this package owns its SQL
//
// Everything else in Polaris reaches the database through sqlc-generated queries in
// services/internal/store. This package cannot: `internal` is enforced by import path, and
// this module is `github.com/peixotolabs/polaris/ee`, which is not under
// `.../polaris/services/`. Going through sqlc would also defeat the point — the generated
// query set is compiled into every binary, so the community build would contain the audit
// log's reads and writes while claiming not to.
//
// So the SQL is here, hand-written, against the table that core migration
// 000077_audit_log.up.sql creates. The split is deliberate and documented at both ends: the
// schema is shared because there is one migration history for both image sets, and the code
// that uses it is not.
//
// # What it is not
//
// It is not change_log. That table is the sync engine's replication stream: pruned at 30
// days, scoped per recipient, and a row per field of every mutation. An auditor needs the
// opposite of all three. The migration's header comment sets out the distinction in full.
package audit

import (
	"context"
	"net/netip"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// DBTX is the pool-or-transaction handle this package runs on.
//
// It is declared here rather than imported because services/internal/store is unreachable
// from this module (see the package comment). It is structurally identical to store.DBTX on
// purpose: Go interfaces are satisfied structurally, so the *store.Queries handle the domain
// layer holds passes straight into these functions with no adapter and no reflection.
//
// The practical consequence, and the reason it is a parameter rather than a field on some
// long-lived object: a write lands in the caller's transaction. An audit row that committed
// independently of the mutation it describes would be a log of something that may have
// rolled back.
type DBTX interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

// Entry is one row of the audit log.
//
// The types are the ones the database uses, not the ones the domain layer uses, because
// this struct is the storage shape. The domain layer has its own and converts at the seam —
// which is what keeps this module free of any dependency on the core's internal packages.
//
// Before and After are raw JSON rather than `any` so that whoever builds an entry has
// already decided what is safe to store. Marshalling a domain object here would mean this
// package deciding, and it is not the layer that knows which field is a credential.
type Entry struct {
	ID          uuid.UUID
	WorkspaceID uuid.UUID

	// ActorUserID is nil for the system and for an actor whose user row has since been
	// deleted; ActorLabel still names them either way. See the migration's comment on why
	// both are stored.
	ActorUserID *uuid.UUID
	ActorType   string
	ActorLabel  string

	// Action is a dotted `subject.verb_past_tense` name from the vocabulary the core
	// declares (domain.AuditAction). It is a plain string here rather than a second set of
	// constants, and that is the deliberate choice: which events the product audits is
	// decided where the hooks are, and the hooks are core domain methods that this package
	// cannot see. Two constant lists either side of a licence boundary would drift, and the
	// drift would be silent — an event written under a name no filter knows.
	Action string

	// TargetType and TargetID are both set or both nil — the database enforces it with
	// audit_log_target_is_whole. A sign-in has no target.
	TargetType  *string
	TargetID    *uuid.UUID
	TargetLabel *string

	Before []byte
	After  []byte

	IP        *netip.Addr
	UserAgent *string

	CreatedAt time.Time
}

// The page cursor is the id of the last entry of the previous page — see List.
//
// A keyset rather than an offset. OFFSET on a table that is appended to while somebody is
// reading it silently repeats and skips rows, because every insert shifts the window under
// the reader, and the one screen where a row must never be quietly omitted is this one.
