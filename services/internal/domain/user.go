package domain

import (
	"context"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// ListUsers returns the workspace's people. Email addresses are attached only for admins
// and for the viewer's own row — a member opening the assignee picker has no business
// receiving everyone's address, and defaulting to "included" is how a directory scrape
// becomes possible.
func (s *Service) ListUsers(ctx context.Context, p *authz.Principal) ([]model.User, error) {
	q := s.db.Queries()
	rows, err := q.ListUsersInWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}

	out := make([]model.User, 0, len(rows))
	for _, r := range rows {
		u := toUser(r)
		if (p.Role.IsAdmin() || r.ID == p.UserID) && r.AccountID != nil {
			acct, err := q.GetAccount(ctx, *r.AccountID)
			if err == nil {
				email := acct.Email
				u.Email = &email
			}
		}
		out = append(out, u)
	}
	return out, nil
}

// ListDirectory answers "who is in this workspace" — `Query.users` and `Workspace.users`.
//
// Separate from ListUsers, which is also the hydration source behind every assignee,
// creator and project member on the graph. Those have to keep resolving for a guest: the
// rows carrying them are rows the guest is already allowed to read, and blanking the name
// off an issue in their own team would break the screen without withholding anything.
//
// The directory itself is another matter. It is workspace-scoped, and a guest does not
// receive it: `sync.go` withholds `user` from a guest's bootstrap for exactly this reason,
// so a guest's replica holds no directory at all. The API said otherwise — a guest could
// ask `{ users { id name username role } }` and receive every person in the workspace,
// which on a real install is the staff list. Two answers to one question is how the
// deliberate one stops being the one that matters.
//
// So a guest is handed their own row and nothing else, which is what their replica holds.
func (s *Service) ListDirectory(ctx context.Context, p *authz.Principal) ([]model.User, error) {
	users, err := s.ListUsers(ctx, p)
	if err != nil {
		return nil, err
	}
	if authz.Visible(p, authz.WorkspaceScope()) {
		return users, nil
	}
	for _, u := range users {
		if u.ID == p.UserID {
			return []model.User{u}, nil
		}
	}
	return []model.User{}, nil
}

func (s *Service) GetUser(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.User, error) {
	row, err := s.db.Queries().GetUser(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return model.User{}, platform.NotFound("user")
		}
		return model.User{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID {
		return model.User{}, platform.NotFound("user")
	}
	return toUser(row), nil
}

type UpdateProfileInput struct {
	Name        *string
	DisplayName *string
	AvatarURL   *string
	Timezone    *string
}

// UpdateProfile edits the viewer's own profile. There is deliberately no "edit somebody
// else's name" path: an admin changing a colleague's display name is not a capability
// this product needs, and not having it removes a whole class of impersonation confusion
// from the activity feed.
func (s *Service) UpdateProfile(ctx context.Context, p *authz.Principal, in UpdateProfileInput) (model.User, int64, error) {
	if in.Name != nil {
		trimmed := strings.TrimSpace(*in.Name)
		if trimmed == "" {
			return model.User{}, 0, platform.Validation("name", "name is required")
		}
		in.Name = &trimmed
	}
	if in.DisplayName != nil {
		trimmed := strings.TrimSpace(*in.DisplayName)
		if trimmed == "" {
			return model.User{}, 0, platform.Validation("displayName", "display name is required")
		}
		in.DisplayName = &trimmed
	}

	var out model.User
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.UpdateUserProfile(ctx, store.UpdateUserProfileParams{
			ID:          p.UserID,
			Name:        in.Name,
			DisplayName: in.DisplayName,
			AvatarUrl:   in.AvatarURL,
			Timezone:    in.Timezone,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toUser(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "user", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return out, version, err
}

// SetUserRole promotes or demotes a member.
func (s *Service) SetUserRole(ctx context.Context, p *authz.Principal, userID uuid.UUID, role string) (model.User, int64, error) {
	switch authz.Role(role) {
	case authz.RoleAdmin, authz.RoleMember, authz.RoleGuest:
	case authz.RoleOwner:
		return model.User{}, 0, platform.Validation("role", "the owner role is not available on this plan")
	default:
		return model.User{}, 0, platform.Validation("role", "unknown role")
	}
	if !authz.Can(p, authz.ActionMemberSetRole) {
		return model.User{}, 0, platform.Forbidden("only admins can change roles")
	}

	var out model.User
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetUser(ctx, userID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("user")
			}
			return platform.Internal(err)
		}
		if existing.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("user")
		}

		// Demoting the last admin locks everybody out of billing, security and member
		// management with no way back in. Checked inside the transaction because two
		// concurrent demotions would each see one remaining admin and both proceed.
		//
		// Only an administrator the count includes is one this rule is about; see
		// isCountedAdmin. Demoting a suspended admin cannot take the workspace's last
		// administrator away, because a suspended one was never holding it up.
		if isCountedAdmin(existing) && !authz.Role(role).IsAdmin() {
			admins, err := q.CountActiveAdminsInWorkspace(ctx, p.WorkspaceID)
			if err != nil {
				return platform.Internal(err)
			}
			if admins <= 1 {
				return platform.Conflict("promote somebody else to admin first — a workspace cannot have none")
			}
		}

		row, err := q.SetUserRole(ctx, store.SetUserRoleParams{ID: userID, Role: role})
		if err != nil {
			return platform.Internal(err)
		}
		out = toUser(row)

		// Demoting somebody to guest takes their API keys with them.
		//
		// A guest may not create a personal key — CreateApiKey refuses one outright, because a
		// key acts as its owner and outlives the session, which is the opposite of what a
		// guest's access is meant to be. Leaving the keys they minted as a member alive would
		// make demotion the one way to end up a guest holding exactly the credential the
		// product says a guest may not have, and it would keep every unattended script they
		// had wired up running with no review. Suspension and removal already sever the
		// credential; this is the third door to the same room.
		//
		// Only on the way down. A member promoted to admin keeps their keys, because nothing
		// about their access has been taken away — and the keys would not widen anyway: a key
		// carries no role of its own and resolves its owner's permissions on every request.
		if authz.Role(role) == authz.RoleGuest && authz.Role(existing.Role) != authz.RoleGuest {
			if _, err := q.RevokeAPIKeysForUser(ctx, userID); err != nil {
				return platform.Internal(err)
			}
		}

		// A role change is the archetypal audit event: it is how somebody acquires access
		// they did not have, and the before/after is the whole story. Recorded beside Emit
		// rather than inside it — Emit is the sync stream, which is pruned at thirty days
		// and is not what an access review reads a year later.
		entry := s.auditBy(ctx, q, p, AuditMemberRoleChanged)
		entry.TargetType = "user"
		entry.TargetID = &out.ID
		entry.TargetLabel = out.DisplayName
		entry.Before = map[string]any{"role": existing.Role}
		entry.After = map[string]any{"role": out.Role}
		if err := s.recordAudit(ctx, q, entry); err != nil {
			return err
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "user", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return out, version, err
}

// SuspendUser blocks sign-in and removes the user from assignee pickers, without deleting
// their work or rewriting the history that names them.
func (s *Service) SuspendUser(ctx context.Context, p *authz.Principal, userID uuid.UUID, suspended bool) (model.User, int64, error) {
	if !authz.Can(p, authz.ActionMemberSuspend) {
		return model.User{}, 0, platform.Forbidden("only admins can suspend people")
	}
	if userID == p.UserID && suspended {
		return model.User{}, 0, platform.Validation("userId", "you cannot suspend yourself")
	}

	status := "active"
	if suspended {
		status = "suspended"
	}

	var out model.User
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetUser(ctx, userID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("user")
			}
			return platform.Internal(err)
		}
		if existing.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("user")
		}
		// Un-suspending takes a seat back, so it is subject to the same limit as an
		// acceptance. Suspension is how an admin frees a seat — CountWorkspaceSeats counts
		// only active people — which makes un-suspension the way one is reclaimed, and a
		// workspace that dropped to a smaller plan while somebody was suspended must not be
		// able to exceed its new limit by reactivating them.
		//
		// Only on the way back in. Suspending is always allowed: a workspace over its limit
		// has to be able to get under it.
		if !suspended && existing.Status != "active" {
			ent, err := entitlementSetFor(ctx, q, p.WorkspaceID)
			if err != nil {
				return err
			}
			if err := ent.CanAddSeat(); err != nil {
				return err
			}
		}

		// Same rule, same target test: re-suspending somebody who is already suspended takes
		// nothing away, so it must not be refused for taking away the last administrator.
		if suspended && isCountedAdmin(existing) {
			admins, err := q.CountActiveAdminsInWorkspace(ctx, p.WorkspaceID)
			if err != nil {
				return platform.Internal(err)
			}
			if admins <= 1 {
				return platform.Conflict("promote somebody else to admin first — a workspace cannot have none")
			}
		}

		row, err := q.SetUserStatus(ctx, store.SetUserStatusParams{ID: userID, Status: status})
		if err != nil {
			return platform.Internal(err)
		}
		out = toUser(row)

		// Two actions rather than one with a boolean, because an auditor filters on the
		// action name. "member.suspended" and "member.restored" are different events with
		// different urgency, and folding them into one name would mean the filter that
		// finds suspensions also finds every reinstatement.
		action := AuditMemberRestored
		if suspended {
			action = AuditMemberSuspended
		}
		entry := s.auditBy(ctx, q, p, action)
		entry.TargetType = "user"
		entry.TargetID = &out.ID
		entry.TargetLabel = out.DisplayName
		entry.Before = map[string]any{"status": existing.Status}
		entry.After = map[string]any{"status": out.Status}
		if err := s.recordAudit(ctx, q, entry); err != nil {
			return err
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "user", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return out, version, err
}

// ResolvePrincipal builds the authorisation context for a request or a socket connect:
// the user's role plus the set of teams they can reach.
//
// It is called once per request and once per connection, never per resolver — an
// authorisation check that re-queries the database is both slow and, worse, capable of
// changing its answer half way through serving one response.
func (s *Service) ResolvePrincipal(ctx context.Context, accountID, workspaceID uuid.UUID) (*authz.Principal, error) {
	q := s.db.Queries()

	user, err := q.GetUserByAccountAndWorkspace(ctx, store.GetUserByAccountAndWorkspaceParams{
		AccountID: &accountID, WorkspaceID: workspaceID,
	})
	if err != nil {
		if store.IsNotFound(err) {
			return nil, platform.Forbidden("you are not a member of this workspace")
		}
		return nil, platform.Internal(err)
	}
	if user.Status != "active" {
		return nil, platform.Forbidden("this account is suspended")
	}

	memberships, err := q.ListTeamIDsForUser(ctx, user.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	teams := authz.NewTeamSet(memberships...)

	// Public teams are visible to every non-guest whether or not they have joined, which
	// is what makes a workspace browsable. Guests see only what they were added to.
	if authz.Role(user.Role) != authz.RoleGuest {
		all, err := q.ListTeamsInWorkspace(ctx, workspaceID)
		if err != nil {
			return nil, platform.Internal(err)
		}
		for _, t := range all {
			if !t.Private {
				teams[t.ID] = struct{}{}
			}
		}
	}

	return &authz.Principal{
		AccountID:      accountID,
		UserID:         user.ID,
		WorkspaceID:    workspaceID,
		Role:           authz.Role(user.Role),
		Teams:          teams,
		SharedEntities: map[uuid.UUID]struct{}{},
	}, nil
}

// ListWorkspacesForAccount powers the workspace switcher.
func (s *Service) ListWorkspacesForAccount(ctx context.Context, accountID uuid.UUID) ([]model.Workspace, error) {
	rows, err := s.db.Queries().ListWorkspacesForAccount(ctx, &accountID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Workspace, 0, len(rows))
	for _, r := range rows {
		out = append(out, model.Workspace{
			ID:         r.ID,
			Name:       r.Name,
			URLKey:     r.UrlKey,
			LogoURL:    r.LogoUrl,
			Plan:       r.Plan,
			CreatedAt:  r.CreatedAt,
			UpdatedAt:  r.UpdatedAt,
			ArchivedAt: r.ArchivedAt,
		})
	}
	return out, nil
}
