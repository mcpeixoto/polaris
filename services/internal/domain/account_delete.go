package domain

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// DeleteAccount erases the signed-in login.
//
// Sessions and saved sign-in methods go with the account row. Each membership is archived
// and renamed, which is the erasure the user table was given a nullable account_id for:
// the work stays, the person does not. The last owner of a workspace that still has other
// people is refused, because deleting them would leave that workspace with nobody who can
// administer it and no account left to repair it with. A workspace whose only person is
// this account is not refused — there is nobody to hand it to.
func (s *Service) DeleteAccount(ctx context.Context, p *authz.Principal) (uuid.UUID, int64, error) {
	if p == nil || p.AccountID == uuid.Nil {
		return uuid.Nil, 0, platform.Unauthorized("")
	}
	if p.ActorType == authz.ActorAppUser {
		return uuid.Nil, 0, platform.Forbidden("an application cannot delete an account")
	}

	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		acct, err := q.GetAccount(ctx, p.AccountID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("account")
			}
			return platform.Internal(err)
		}
		accountID := p.AccountID
		members, err := q.ListUsersForAccount(ctx, &accountID)
		if err != nil {
			return platform.Internal(err)
		}
		if err := s.accountDeletionBlocked(ctx, q, members); err != nil {
			return err
		}

		version = 0
		for _, member := range members {
			emitted, err := s.eraseMembership(ctx, q, member)
			if err != nil {
				return err
			}
			if member.ID == p.UserID {
				version = emitted
			}
		}
		if err := q.DeleteInvitesForEmail(ctx, acct.Email); err != nil {
			return platform.Internal(err)
		}
		if err := q.DeleteAccount(ctx, p.AccountID); err != nil {
			return platform.Internal(err)
		}
		return nil
	})
	if err != nil {
		return uuid.Nil, 0, err
	}
	return p.UserID, version, nil
}

// accountDeletionBlocked refuses when this account is the last administrator of a
// workspace that still has someone else in it.
func (s *Service) accountDeletionBlocked(ctx context.Context, q *store.Queries, members []store.User) error {
	for _, member := range members {
		if !isCountedAdmin(member) {
			continue
		}
		admins, err := q.CountActiveAdminsInWorkspace(ctx, member.WorkspaceID)
		if err != nil {
			return platform.Internal(err)
		}
		if admins > 1 {
			continue
		}
		others, err := q.CountOtherActiveHumans(ctx, store.CountOtherActiveHumansParams{
			WorkspaceID: member.WorkspaceID,
			UserID:      member.ID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		if others == 0 {
			continue
		}
		ws, err := q.GetWorkspace(ctx, member.WorkspaceID)
		if err != nil {
			return platform.Internal(err)
		}
		return platform.Conflict(fmt.Sprintf(
			"you are the last owner of %s — make somebody else an admin, then delete your account",
			ws.Name))
	}
	return nil
}

// eraseMembership takes one workspace presence off the account: keys, push tokens, team
// membership, then the anonymised archive. The version it returns is that workspace's.
func (s *Service) eraseMembership(ctx context.Context, q *store.Queries, member store.User) (int64, error) {
	if _, err := q.RevokeAPIKeysForUser(ctx, member.ID); err != nil {
		return 0, platform.Internal(err)
	}
	if err := q.DeletePushDevicesForUser(ctx, member.ID); err != nil {
		return 0, platform.Internal(err)
	}

	teams, err := q.ListTeamsInWorkspace(ctx, member.WorkspaceID)
	if err != nil {
		return 0, platform.Internal(err)
	}
	private := make(map[uuid.UUID]bool, len(teams))
	for _, team := range teams {
		private[team.ID] = team.Private
	}
	memberships, err := q.ListMembershipsInWorkspace(ctx, member.WorkspaceID)
	if err != nil {
		return 0, platform.Internal(err)
	}

	var changes []Change
	for _, m := range memberships {
		if m.UserID != member.ID {
			continue
		}
		if _, err := q.RemoveTeamMember(ctx, store.RemoveTeamMemberParams{
			TeamID: m.TeamID, UserID: member.ID,
		}); err != nil {
			return 0, platform.Internal(err)
		}
		teamID := m.TeamID
		changes = append(changes,
			Change{
				EntityType: "teamMembership", EntityID: m.ID, Op: OpDelete, TeamID: &teamID,
				Scope: authz.TeamScope(m.TeamID, private[m.TeamID]),
			},
			Change{
				EntityType: "team", EntityID: m.TeamID, Op: OpRevoke, TeamID: &teamID,
				Scope: authz.UserScope(member.ID),
			},
		)
	}

	row, err := q.EraseUser(ctx, member.ID)
	if err != nil {
		return 0, platform.Internal(err)
	}
	changes = append(changes, Change{
		EntityType: "user", EntityID: member.ID, Op: OpUpsert,
		Scope: authz.WorkspaceScope(), Payload: toUser(row),
	})

	// member.left, not a new action. The workspace's record of this is that the person
	// left. The account deletion is the absence of the login, which this row cannot see.
	userID := member.ID
	if err := s.recordAudit(ctx, q, AuditEntry{
		WorkspaceID: member.WorkspaceID,
		Actor:       authz.UserActor(member.ID),
		ActorLabel:  member.DisplayName,
		Action:      AuditMemberLeft,
		TargetType:  "user",
		TargetID:    &userID,
		TargetLabel: member.DisplayName,
		Before:      map[string]any{"role": member.Role, "status": member.Status},
	}); err != nil {
		return 0, err
	}

	return s.em.Emit(ctx, q, member.WorkspaceID, authz.UserActor(member.ID), changes...)
}
