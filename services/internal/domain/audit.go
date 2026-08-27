package domain

import (
	"context"
	"encoding/json"
	"net/netip"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// The audit log's core half: the seam, the vocabulary, and the two call sites every hook in
// this package goes through.
//
// The implementation behind the seam is commercially licensed and lives in the ee/ module.
// This file is AGPL and contains no part of it. In a community build auditRecorder is nil,
// the recording helper writes nothing, and the read path refuses — the feature is absent
// from the binary, not disabled in it, which is the claim ee/README.md makes and
// scripts/lint-editions.sh enforces.
//
// Which events are audited is decided HERE and not in ee/, even though the storage is
// there. The hooks are calls inside core domain methods, so core has to name the event; a
// second vocabulary on the far side of the licence boundary would drift, and an event
// written under a name no filter knows is an event that did not get logged.

// AuditAction names a security-relevant event.
//
// Dotted `subject.verb_past_tense`. The past tense is not a style preference: an entry
// records something that has already happened and committed. Constants rather than string
// literals at the call sites because these names are what an administrator filters on and
// what a SIEM export keys on, and a typo produces an event invisible to every filter while
// looking perfectly ordinary in the table.
type AuditAction string

const (
	// Authentication. The highest-value row in the table — the one that answers "was that
	// really them" — and the only one that reliably carries an IP address today.
	AuditSignedIn AuditAction = "auth.signed_in"

	// Membership. Between them these answer "who can reach this workspace, and who let them
	// in", which is the first question of every access review.
	AuditInviteSent        AuditAction = "invite.sent"
	AuditInviteAccepted    AuditAction = "invite.accepted"
	AuditMemberRoleChanged AuditAction = "member.role_changed"
	AuditMemberSuspended   AuditAction = "member.suspended"
	AuditMemberRestored    AuditAction = "member.restored"
	AuditMemberRemoved     AuditAction = "member.removed"
	AuditMemberLeft        AuditAction = "member.left"

	// Credentials. A key outlives the session that minted it, so both ends of its life are
	// audit events even though neither is replicated — apikeys.go says as much at the point
	// where it explains why it does not Emit.
	AuditAPIKeyCreated AuditAction = "api_key.created"
	AuditAPIKeyRevoked AuditAction = "api_key.revoked"

	// Configuration that changes who can see what.
	AuditWorkspaceUpdated   AuditAction = "workspace.updated"
	AuditTeamPrivacyChanged AuditAction = "team.privacy_changed"
)

// AuditEntry is one event as the core hands it over: domain types, not storage types, and
// Before/After still as Go values so the caller decides what is safe to keep rather than
// this layer guessing.
type AuditEntry struct {
	WorkspaceID uuid.UUID

	// Actor is who did it. Taken as an authz.Actor so that an integration or the system is
	// expressible, not only a person — the doc comment on authz.ActorType names the audit
	// log as the reason that distinction is typed at all.
	Actor authz.Actor
	// ActorLabel is the actor's name as it read at the time, written into the row and never
	// updated. See the migration comment: an audit entry has to say who it was *then*.
	ActorLabel string

	Action AuditAction

	// TargetType is empty when the event has no target — a sign-in does not. TargetID must
	// be nil exactly when TargetType is empty; the database enforces the pair with
	// audit_log_target_is_whole, and buildAuditRow keeps this side honest.
	TargetType  string
	TargetID    *uuid.UUID
	TargetLabel string

	// Before and After are marshalled at the seam. Anything unmarshallable is a programming
	// error and is reported as one rather than silently stored as null.
	//
	// NOTHING SECRET GOES IN EITHER. An API key's name and prefix, never its token; a
	// workspace's settings, never its signing secrets. There is no redaction pass here on
	// purpose — a filter that strips "known" secret fields is a filter that misses the next
	// one, and this table is permanent.
	Before any
	After  any

	IP        *netip.Addr
	UserAgent string
}

// auditRecorder is the seam between the AGPL core and the commercial implementation.
//
// It is satisfied by an adapter in audit_ee.go, which is the only file in this package that
// imports the ee module and is itself excluded from a community build by `//go:build ee`.
// The interface deals in *store.Queries because that is what the domain layer holds; the
// adapter unwraps it to a plain connection handle the ee module can name.
//
// nil is a valid value and means "this build has no audit log". Every use goes through the
// two methods below, so there is exactly one nil check per direction.
type auditRecorder interface {
	Record(ctx context.Context, q *store.Queries, e AuditEntry) error
	List(ctx context.Context, q *store.Queries, workspaceID uuid.UUID, first int, after *uuid.UUID) ([]model.AuditLogEntry, error)
}

// recordAudit writes one entry inside the caller's transaction, if this build has an audit
// log and this workspace's plan includes it.
//
// Three refusals, and the order matters:
//
//  1. No recorder — a community build. Nothing to write to; not an error.
//  2. The plan does not include the audit log. Skipped, NOT refused: this is called from
//     inside sign-in and from inside a role change, and returning the entitlement error
//     here would abort the mutation. A Free workspace would be unable to sign anybody in
//     because it is not paying for the audit log, which is an outage dressed as packaging.
//     Same shape as applyMatchingSLA, and for the same reason.
//  3. Anything else that goes wrong IS returned, and because this runs inside the caller's
//     InTx it rolls the mutation back with it. That is the deliberate direction for a
//     compliance artefact: an audit log that silently drops entries when the write fails is
//     worse than no audit log, because it is trusted. The failure it can realistically hit
//     is the database being unavailable, in which case the mutation was going to fail too.
//
// Allow rather than Has, on the same reasoning apikeys.go gives: writing an entry is a
// write, so a lapsed plan stops new entries while the existing ones stay readable — which
// is exactly the behaviour docs/06-product-model/01-licensing-and-distribution.md specifies
// for an expired licence.
func (s *Service) recordAudit(ctx context.Context, q *store.Queries, e AuditEntry) error {
	if s.audit == nil {
		return nil
	}
	ent, err := entitlementSetFor(ctx, q, e.WorkspaceID)
	if err != nil {
		return err
	}
	if err := ent.Allow(entitlement.FeatureAuditLog); err != nil {
		return nil
	}
	return s.audit.Record(ctx, q, e)
}

// ListAuditLog returns a page of the workspace's audit entries, newest first.
//
// after is the id of the last entry the caller already has, or nil for the first page.
//
// Named with the List prefix on purpose: internal/graph/api_parity_coverage_test.go
// classifies every exported Service method by verb, and an unrecognised prefix fails the
// build rather than quietly landing in the "mutation with no API" bucket.
func (s *Service) ListAuditLog(
	ctx context.Context, p *authz.Principal, first int, after *uuid.UUID,
) ([]model.AuditLogEntry, error) {
	if !authz.Can(p, authz.ActionAuditLogRead) {
		return nil, platform.Forbidden("only admins can read the audit log")
	}

	// Has, not Allow, and this is the distinction the entitlement package is emphatic
	// about: reading is a read. A workspace whose card expired keeps access to the audit
	// entries it already has — losing the record of who did what because a payment failed
	// is the opposite of what the artefact is for.
	ent, err := s.EntitlementSet(ctx, p)
	if err != nil {
		return nil, err
	}
	if !ent.Has(entitlement.FeatureAuditLog) {
		// Built by the same matrix that answers every other paywall, so it names the plan
		// that would permit it and unwraps to PLAN_LIMIT/402 without a conversion here.
		return nil, ent.Deny(entitlement.FeatureAuditLog)
	}

	if s.audit == nil {
		// A community binary whose workspace row nonetheless says "enterprise" — a database
		// restored from the cloud into a self-hosted install, say. The matrix expects this
		// not to happen (PlanSelfHosted has AuditLog false precisely "because that code is
		// compiled out by the `ee` build tag"), but the binary is the authority when the two
		// disagree.
		//
		// Refused loudly rather than answered with an empty page. An empty audit log does
		// not read as "this build cannot show you one", it reads as "nothing happened", and
		// for this one screen that difference is the entire value of the screen.
		//
		// Forbidden rather than a new error code: the transports and the client share a
		// closed vocabulary of codes, and widening it for an edge case that resolves to
		// "you cannot have this here" earns less than the message does. The sentence is the
		// part the reader needs.
		return nil, platform.Forbidden(
			"this build of Polaris does not include the audit log — it is an enterprise " +
				"feature and is not compiled into the community image")
	}

	if first <= 0 || first > 200 {
		first = 50
	}
	return s.audit.List(ctx, s.db.Queries(), p.WorkspaceID, first, after)
}

// auditBy starts an entry attributed to the calling principal, in their workspace.
//
// The label is resolved here, once, at the moment of the event, so that every call site gets
// the actor's name as it read then without having to remember to look it up. See the
// migration's comment on why the name is stored rather than joined.
//
// Callers fill in the target and the before/after themselves: those are the parts only the
// call site knows, and a helper that guessed them would guess wrong.
func (s *Service) auditBy(
	ctx context.Context, q *store.Queries, p *authz.Principal, action AuditAction,
) AuditEntry {
	return AuditEntry{
		WorkspaceID: p.WorkspaceID,
		Actor:       p.Actor(),
		ActorLabel:  actorLabelFor(ctx, q, p.UserID),
		Action:      action,
	}
}

// auditSignIn records a successful authentication, once per workspace the account can
// reach.
//
// A sign-in happens to an ACCOUNT and the audit log is scoped to a WORKSPACE, so the fan-out
// is not incidental — it is the translation between the two. One person with memberships in
// three workspaces produces three entries, and each workspace's administrators see the
// sign-in that concerns them and nothing about the other two. Recording it once against
// "some workspace" would either leak the existence of the others or hide the event from
// everyone but one.
//
// Deliberately NOT called from RefreshSession. A refresh is the same session continuing, and
// auditing it would add a row every few minutes per active client — burying the sign-ins
// that matter under machine traffic, which is how an audit log becomes something nobody
// reads.
//
// Best effort on the lookup: if the memberships cannot be listed the sign-in still succeeds.
// Refusing to let somebody in because their audit rows could not be written would turn this
// feature into an availability risk for authentication itself, and the recordAudit call
// below is already strict about the write it does attempt.
func (s *Service) auditSignIn(ctx context.Context, q *store.Queries, accountID uuid.UUID, userAgent string, ip *netip.Addr) error {
	if s.audit == nil {
		return nil
	}
	// A pointer because user.account_id is nullable — app users are agents and have no
	// account. A nil here would match no rows rather than every agent, but the caller always
	// has a real account id, so the pointer is plumbing rather than a case to handle.
	members, err := q.ListUsersForAccount(ctx, &accountID)
	if err != nil {
		return nil
	}
	for _, m := range members {
		if err := s.recordAudit(ctx, q, AuditEntry{
			WorkspaceID: m.WorkspaceID,
			Actor:       authz.UserActor(m.ID),
			ActorLabel:  m.DisplayName,
			Action:      AuditSignedIn,
			// No target: the sign-in is about the actor. audit_log_target_is_whole is
			// satisfied by leaving both halves empty.
			IP:        ip,
			UserAgent: userAgent,
		}); err != nil {
			return err
		}
	}
	return nil
}

// auditJSON marshals one side of a change for storage.
//
// nil in, nil out — a creation has no `before` and the column is nullable, so an absent
// side stays absent rather than becoming the four bytes "null", which would be
// indistinguishable from a value that genuinely was null.
func auditJSON(v any) ([]byte, error) {
	if v == nil {
		return nil, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil, platform.Internal(err)
	}
	return b, nil
}

// actorLabelFor reads the display name to stamp on an entry.
//
// Best effort by design: it runs inside the mutation's transaction and a failure to name
// the actor must not fail the mutation. An empty label still leaves a usable row — the
// actor's id and type are on it — whereas an aborted role change because the name lookup
// hiccuped is a real outage caused by bookkeeping.
func actorLabelFor(ctx context.Context, q *store.Queries, userID uuid.UUID) string {
	if userID == uuid.Nil {
		return ""
	}
	u, err := q.GetUser(ctx, userID)
	if err != nil {
		return ""
	}
	return u.DisplayName
}
