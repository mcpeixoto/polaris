package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Workspace administration: what an admin does to somebody else's access, and what this
// workspace's plan permits.

// RemoveUser takes somebody out of the workspace without taking their work with them.
//
// Removal is an archive plus a suspension plus the loss of every team membership and every
// API key — never a DELETE. The foreign keys from issue, comment and issue_history to
// "user" are ON DELETE SET NULL, so deleting the row would not delete their work; it would
// silently unattribute it, turning years of issues and comments into authorless rows that
// no restore can repair. Keeping the row keeps every reference intact, and the archive is
// what removes them from the directory, the assignee picker and the seat count.
//
// Nothing is reassigned. An issue assigned to somebody who has left stays assigned to them:
// it is true, it is visible, and it is the state a team triages from. Silently reassigning
// to the remover would put work in the wrong queue and lose the fact that it was ever
// anybody else's.
func (s *Service) RemoveUser(ctx context.Context, p *authz.Principal, userID uuid.UUID) (uuid.UUID, int64, error) {
	if !authz.Can(p, authz.ActionMemberRemove) {
		return uuid.Nil, 0, platform.Forbidden("only admins can remove people from the workspace")
	}
	return s.archiveWorkspaceMember(ctx, p, userID)
}

// LeaveWorkspace takes the caller out of this workspace.
//
// It is the same archive RemoveUser performs, without the admin gate: a member who is
// no longer part of a workspace should not have to ask a colleague to press the same
// button. An OAuth app user cannot leave this way — it is not a person, and uninstall
// is a different mutation. The last-owner rule still applies: leaving must not strand
// a workspace with nobody who can invite, change a role, or manage billing.
func (s *Service) LeaveWorkspace(ctx context.Context, p *authz.Principal) (uuid.UUID, int64, error) {
	if p == nil || p.UserID == uuid.Nil {
		return uuid.Nil, 0, platform.Unauthorized("")
	}
	if p.ActorType == authz.ActorAppUser {
		return uuid.Nil, 0, platform.Forbidden("an application cannot leave a workspace")
	}
	return s.archiveWorkspaceMember(ctx, p, p.UserID)
}

// isCountedAdmin reports whether this row is one of the administrators the workspace is
// actually relying on right now.
//
// Every last-administrator refusal in the product compares against
// CountActiveAdminsInWorkspace, whose WHERE clause is `role IN ('owner','admin') AND status =
// 'active' AND archived_at IS NULL`. So the question the guard has to ask about its target is
// the same three-part one, and asking only about the role made every suspended administrator
// a person the rule protected without ever having counted them.
//
// The consequence was a workspace with one active admin and one suspended one, where the
// suspended row could not be demoted, could not be removed, and could not leave: the count
// came back 1 — correctly, the active admin — the target "was an admin", and the refusal
// announced that the workspace's last owner was being taken away while the actual last owner
// was the person pressing the button. The only way out was to restore them, which takes a
// seat back, change the role, and suspend them again.
func isCountedAdmin(u store.User) bool {
	return authz.Role(u.Role).IsAdmin() && u.Status == "active" && u.ArchivedAt == nil
}

func (s *Service) archiveWorkspaceMember(ctx context.Context, p *authz.Principal, userID uuid.UUID) (uuid.UUID, int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetUser(ctx, userID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("user")
			}
			return platform.Internal(err)
		}
		// Another workspace's user is not-found rather than forbidden: confirming that an id
		// exists elsewhere is itself a leak. Somebody already removed answers the same way,
		// because as far as this workspace is concerned they are gone.
		if existing.WorkspaceID != p.WorkspaceID || existing.ArchivedAt != nil {
			return platform.NotFound("user")
		}

		// A workspace must never lose its last owner. With no admin left nobody can invite,
		// change a role, manage billing or delete the workspace, and there is no
		// self-service way back in — the recovery is a support ticket against the database.
		//
		// Removing yourself is otherwise allowed: it is how somebody leaves a workspace they
		// are no longer part of, and refusing it would only send them to ask a colleague to
		// press the same button. This rule is what stops that being a way to strand one.
		//
		// The count runs inside the transaction that does the archiving, against the rows it
		// is about to change, and it is the same rule and the same query SetUserRole and
		// SuspendUser apply to the other two routes to the same state.
		if isCountedAdmin(existing) {
			admins, err := q.CountActiveAdminsInWorkspace(ctx, p.WorkspaceID)
			if err != nil {
				return platform.Internal(err)
			}
			if admins <= 1 {
				return platform.Conflict(
					"this is the workspace's last owner — make somebody else an admin first, or the workspace will have nobody who can administer it")
			}
		}

		// Their keys go with them. An account that is gone while its access path is not is
		// precisely the case migration 000016 warns about, and it is invisible: nothing
		// errors, the requests simply keep working.
		if _, err := q.RevokeAPIKeysForUser(ctx, userID); err != nil {
			return platform.Internal(err)
		}

		teams, err := q.ListTeamsInWorkspace(ctx, p.WorkspaceID)
		if err != nil {
			return platform.Internal(err)
		}
		private := make(map[uuid.UUID]bool, len(teams))
		for _, t := range teams {
			private[t.ID] = t.Private
		}

		memberships, err := q.ListMembershipsInWorkspace(ctx, p.WorkspaceID)
		if err != nil {
			return platform.Internal(err)
		}

		var changes []Change
		for _, m := range memberships {
			if m.UserID != userID {
				continue
			}
			if _, err := q.RemoveTeamMember(ctx, store.RemoveTeamMemberParams{
				TeamID: m.TeamID, UserID: userID,
			}); err != nil {
				return platform.Internal(err)
			}
			changes = append(changes,
				// The team's remaining members drop the membership row, so their member
				// lists do not keep showing somebody who left.
				Change{
					EntityType: "teamMembership", EntityID: m.ID, Op: OpDelete, TeamID: &m.TeamID,
					Scope: authz.TeamScope(m.TeamID, private[m.TeamID]),
				},
				// And the person leaving forgets the team, the same revoke RemoveTeamMember
				// emits and for the same reason: a socket already open keeps its principal
				// until it disconnects, so without this they hold a readable replica of a
				// team they have just been removed from. Their next connect is refused by
				// ResolvePrincipal, which is why the revoke matters only for the session
				// that is open right now.
				Change{
					EntityType: "team", EntityID: m.TeamID, Op: OpRevoke, TeamID: &m.TeamID,
					Scope: authz.UserScope(userID),
				},
			)
		}

		row, err := q.RemoveUserFromWorkspace(ctx, userID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("user")
			}
			return platform.Internal(err)
		}

		// An upsert of the archived row, not a delete.
		//
		// A delete would have every client drop the user, and every issue they ever created
		// or were assigned would render with a blank name — the replica has no other source
		// for it. Sending the archived row instead keeps the name available for attribution
		// while archivedAt tells the client to leave them out of pickers and directories,
		// which is the same rule the bootstrap applies by not streaming archived users at
		// all.
		changes = append(changes, Change{
			EntityType: "user", EntityID: userID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: toUser(row),
		})

		// Removal and departure are one code path and two audit events, distinguished by
		// whether the actor is the target. "Alice removed Bob" and "Bob left" describe the
		// same row change and are not the same fact to whoever reads this later — one is an
		// administrative act, the other is not — and the distinction is unrecoverable from
		// the row afterwards if it is not written down now.
		action := AuditMemberRemoved
		if p.UserID == userID {
			action = AuditMemberLeft
		}
		entry := s.auditBy(ctx, q, p, action)
		entry.TargetType = "user"
		entry.TargetID = &userID
		entry.TargetLabel = existing.DisplayName
		entry.Before = map[string]any{"role": existing.Role, "status": existing.Status}
		// No `after`: the membership is gone. A payload here would have to invent a shape
		// for absence, and null already means it.
		if err := s.recordAudit(ctx, q, entry); err != nil {
			return err
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...)
		return err
	})
	if err != nil {
		return uuid.Nil, 0, err
	}
	return userID, version, nil
}

// RevokeInvite cancels a pending invitation.
func (s *Service) RevokeInvite(ctx context.Context, p *authz.Principal, id uuid.UUID) (uuid.UUID, int64, error) {
	if !authz.Can(p, authz.ActionMemberInvite) {
		return uuid.Nil, 0, platform.Forbidden("only admins can manage invitations")
	}

	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		// The query is scoped to the caller's workspace, so an id from another workspace and
		// an id that never existed answer identically — neither confirms an invitation
		// exists somewhere the caller cannot see. It reports no row for an invitation that
		// was already revoked or already accepted, which is right: an accepted invitation is
		// a member now, and revoking it would suggest their access had been taken away.
		if _, err := q.RevokeInvite(ctx, store.RevokeInviteParams{
			ID: id, WorkspaceID: p.WorkspaceID,
		}); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("invitation")
			}
			return platform.Internal(err)
		}

		var err error
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	if err != nil {
		return uuid.Nil, 0, err
	}
	return id, version, nil
}

// ListInvites returns the workspace's outstanding invitations.
//
// Admin-gated, and not because an invitation is a secret: the list is a set of email
// addresses of people who do not work here yet, which is exactly what a workspace should
// not hand to every member who asks. The token is not in model.Invite for the same reason
// it is not in model.APIKey — it exists in the email that went out and nowhere else.
func (s *Service) ListInvites(ctx context.Context, p *authz.Principal) ([]model.Invite, error) {
	if !authz.Can(p, authz.ActionMemberInvite) {
		return nil, platform.Forbidden("only admins can see pending invitations")
	}

	rows, err := s.db.Queries().ListPendingInvites(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Invite, 0, len(rows))
	for _, r := range rows {
		out = append(out, toInvite(r))
	}
	return out, nil
}

// Entitlements is what this workspace's plan permits.
//
// It returns Features and not the lapse-narrowed set: the lapse is reported separately
// (EntitlementSet, and entitlement.Set.Lapsed) rather than folded into the numbers, so a
// workspace whose card failed sees what it is paying for next to a message about billing
// instead of silently seeing free-tier limits it never bought. See the comment on
// entitlement.Set.Features — reads are never gated by a lapse, only writes are.
func (s *Service) Entitlements(ctx context.Context, p *authz.Principal) (entitlement.Features, error) {
	set, err := s.EntitlementSet(ctx, p)
	if err != nil {
		return entitlement.Features{}, err
	}
	return set.Features(), nil
}

// EntitlementSet is the same answer with the workspace's own facts still attached: which
// plan, how many seats are used, and whether billing has lapsed.
//
// Both exist because the API's Entitlements type needs all of it while Features carries
// only the matrix half. A caller holding Features alone would have to re-read the workspace
// for the other three fields, and two reads a moment apart can disagree — which is how one
// screen ends up saying a workspace is over its seat limit while the next says it is under.
func (s *Service) EntitlementSet(ctx context.Context, p *authz.Principal) (entitlement.Set, error) {
	return entitlementSetFor(ctx, s.db.Queries(), p.WorkspaceID)
}

// entitlementSetFor resolves one workspace's facts against the plan matrix. Takes a
// *store.Queries so a gated write can resolve entitlements inside its own transaction,
// against the same snapshot as the write it is about to permit.
func entitlementSetFor(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) (entitlement.Set, error) {
	ws, err := q.GetWorkspace(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return entitlement.Set{}, platform.NotFound("workspace")
		}
		return entitlement.Set{}, platform.Internal(err)
	}

	// The one seat count in the product, and it has to stay the one: app users are an
	// integration's identity rather than a person, and suspended or archived people are not
	// billed — which is what makes suspension the way an admin frees a seat. Two call sites
	// counting differently is how one screen says the workspace is full and another lets an
	// invitation through.
	seats, err := q.CountWorkspaceSeats(ctx, workspaceID)
	if err != nil {
		return entitlement.Set{}, platform.Internal(err)
	}

	// seat_limit is an int32 in the column and an int in the policy layer. The pointer
	// survives the conversion because nil genuinely means "whatever the plan says", which is
	// a different claim from any number.
	var seatLimit *int
	if ws.SeatLimit != nil {
		n := int(*ws.SeatLimit)
		seatLimit = &n
	}

	// plan_lapsed_at is passed through rather than derived from plan_expires_at and a clock:
	// whether a plan has lapsed is decided once, by the billing job that writes the column.
	return entitlement.New(entitlement.Facts{
		Plan:         entitlement.Plan(ws.Plan),
		PlanLapsedAt: ws.PlanLapsedAt,
		SeatLimit:    seatLimit,
		SeatsUsed:    int(seats),
	}), nil
}

// syncWatermark reads the workspace's current version, for the two mutations that
// legitimately emit nothing.
//
// API keys and invitations are the only entities in the product that are not replicated
// (see model.APIKey): both are read on one settings screen, rarely, and putting a
// credential's metadata — or the list of addresses a workspace is hiring — in every device's
// local store buys nothing. A mutation payload still has to carry a version, because that
// is what every client uses to place the response against its own stream. The current
// watermark says "nothing on the stream moved", which is exactly true; minting a version
// instead would wake every socket in the workspace for a row none of them will ever receive.
func syncWatermark(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) (int64, error) {
	v, err := q.GetWorkspaceVersion(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return 0, platform.NotFound("workspace")
		}
		return 0, platform.Internal(err)
	}
	return v, nil
}

// toInvite drops token_hash and accepted_by on the way out: the first is a credential and
// the second names a user id in an object a pending invitation has no reason to carry.
func toInvite(i store.Invite) model.Invite {
	return model.Invite{
		ID:          i.ID,
		WorkspaceID: i.WorkspaceID,
		Email:       i.Email,
		Role:        i.Role,
		InvitedBy:   i.InvitedBy,
		TeamIDs:     i.TeamIds,
		AcceptedAt:  i.AcceptedAt,
		RevokedAt:   i.RevokedAt,
		ExpiresAt:   i.ExpiresAt,
		CreatedAt:   i.CreatedAt,
	}
}
