package domain

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

var teamKeyPattern = regexp.MustCompile(`^[A-Z][A-Z0-9]{0,7}$`)

type CreateTeamInput struct {
	Key          string
	Name         string
	Description  *string
	Icon         *string
	Color        *string
	Timezone     string
	Private      bool
	ParentTeamID *uuid.UUID
}

// CreateTeam creates a team, seeds its default workflow, and makes the creator its owner.
//
// All three happen in one transaction because a team without statuses cannot hold an
// issue and a private team without a member is unreachable by anybody, including the
// person who just made it.
func (s *Service) CreateTeam(ctx context.Context, p *authz.Principal, in CreateTeamInput) (model.Team, int64, error) {
	if !authz.Can(p, authz.ActionTeamCreate) {
		return model.Team{}, 0, platform.Forbidden("only admins can create teams")
	}
	if err := validateTeamKey(in.Key); err != nil {
		return model.Team{}, 0, err
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return model.Team{}, 0, platform.Validation("name", "team name is required")
	}
	if in.Timezone == "" {
		in.Timezone = "UTC"
	}
	if in.Private {
		ent, err := entitlementSetFor(ctx, s.db.Queries(), p.WorkspaceID)
		if err != nil {
			return model.Team{}, 0, err
		}
		if err := ent.Allow(entitlement.FeaturePrivateTeams); err != nil {
			return model.Team{}, 0, err
		}
	}
	if in.ParentTeamID != nil {
		ent, err := entitlementSetFor(ctx, s.db.Queries(), p.WorkspaceID)
		if err != nil {
			return model.Team{}, 0, err
		}
		if err := ent.Allow(entitlement.FeatureSubTeams); err != nil {
			return model.Team{}, 0, err
		}
	}

	var out model.Team
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		// The plan's team limit, checked here and nowhere else.
		//
		// Inside the transaction rather than before it, so the count cannot be stale by the
		// time the row is written — two admins creating the workspace's third team at once
		// would otherwise both read two and both be admitted. `entitlement.Set.CanAddTeam`
		// owns the boundary; this only supplies the number and lets the refusal through,
		// because an *entitlement.Error already unwraps to CodeEntitlement and carries the
		// structure a paywall needs. Wrapping it in a sentence here would give the client
		// something to string-match instead.
		//
		// Self-hosted is unlimited, so on the open-source product this reads the workspace
		// row and always says yes. That is the cost of having the check exist at all, and it
		// is one indexed count on a rare write.
		ent, err := entitlementSetFor(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}
		teams, err := q.CountTeamsInWorkspace(ctx, p.WorkspaceID)
		if err != nil {
			return platform.Internal(err)
		}
		if err := ent.CanAddTeam(int(teams)); err != nil {
			return err
		}

		private := in.Private
		var parentRow *store.Team
		if in.ParentTeamID != nil {
			parent, err := q.GetTeam(ctx, *in.ParentTeamID)
			if err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("parent team")
				}
				return platform.Internal(err)
			}
			if parent.WorkspaceID != p.WorkspaceID {
				return platform.NotFound("parent team")
			}
			if parent.RetiredAt != nil {
				return platform.Conflict("retired teams cannot be parents")
			}
			parentRow = &parent
			if parent.Private {
				private = true
				if err := ent.Allow(entitlement.FeaturePrivateTeams); err != nil {
					return err
				}
			}
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}

		if parentRow != nil {
			if err := s.validateTeamParent(ctx, q, ent, id, parentRow); err != nil {
				return err
			}
		}

		row, err := q.CreateTeam(ctx, store.CreateTeamParams{
			ID:           id,
			WorkspaceID:  p.WorkspaceID,
			Key:          in.Key,
			Name:         in.Name,
			Description:  in.Description,
			Icon:         in.Icon,
			Color:        in.Color,
			Timezone:     in.Timezone,
			ParentTeamID: in.ParentTeamID,
			Private:      private,
			Settings:     json.RawMessage(`{}`),
		})
		if err != nil {
			if store.IsUniqueViolation(err, "team_workspace_key_key") {
				return platform.Validation("key", fmt.Sprintf("the key %s is already used by another team", in.Key))
			}
			return platform.Internal(err)
		}
		out = toTeam(row)

		states, err := seedWorkflowStates(ctx, q, p.WorkspaceID, id)
		if err != nil {
			return err
		}

		membership, err := s.addMember(ctx, q, p.WorkspaceID, id, p.UserID, "owner")
		if err != nil {
			return err
		}

		// One emit for the whole creation, so a client applies the team, its statuses and
		// the membership as a single consistent step rather than briefly rendering a team
		// with no statuses.
		changes := []Change{{
			EntityType: "team", EntityID: id, Op: OpUpsert, TeamID: &id,
			Scope: authz.TeamScope(id, private), Payload: out,
		}}
		for _, st := range states {
			changes = append(changes, Change{
				EntityType: "workflowState", EntityID: st.ID, Op: OpUpsert, TeamID: &id,
				Scope: authz.TeamScope(id, private), Payload: st,
			})
		}
		changes = append(changes, Change{
			EntityType: "teamMembership", EntityID: membership.ID, Op: OpUpsert, TeamID: &id,
			Scope: authz.TeamScope(id, private), Payload: membership,
		})
		if parentRow != nil {
			ownerChanges, err := s.ensureParentOwnersOnSubTeam(ctx, q, p.WorkspaceID, parentRow.ID, id, private)
			if err != nil {
				return err
			}
			changes = append(changes, ownerChanges...)
			if parentRow.CyclesEnabled {
				inherited, extra, err := applyInheritedCycleSchedule(ctx, q, *parentRow, row, time.Now())
				if err != nil {
					return err
				}
				out = toTeam(inherited)
				changes[0].Payload = out
				// extra[0] is the same team upsert; keep cycle/issue rows only.
				if len(extra) > 1 {
					changes = append(changes, extra[1:]...)
				}
			}
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...)
		return err
	})
	if err != nil {
		return model.Team{}, 0, err
	}

	// The creator is now a member; reflect it on the live principal so the very next call
	// in this request does not fail its own membership check.
	p.Teams[out.ID] = struct{}{}
	return out, version, nil
}

type UpdateTeamInput struct {
	ID          uuid.UUID
	Key         *string
	Name        *string
	Description *string
	Icon        *string
	Color       *string
	Timezone    *string
	Private     *bool
}

func (s *Service) UpdateTeam(ctx context.Context, p *authz.Principal, in UpdateTeamInput) (model.Team, int64, error) {
	if in.Key != nil {
		if err := validateTeamKey(*in.Key); err != nil {
			return model.Team{}, 0, err
		}
	}
	if in.Name != nil {
		trimmed := strings.TrimSpace(*in.Name)
		if trimmed == "" {
			return model.Team{}, 0, platform.Validation("name", "team name is required")
		}
		in.Name = &trimmed
	}

	if in.Private != nil && *in.Private {
		ent, err := entitlementSetFor(ctx, s.db.Queries(), p.WorkspaceID)
		if err != nil {
			return model.Team{}, 0, err
		}
		if err := ent.Allow(entitlement.FeaturePrivateTeams); err != nil {
			return model.Team{}, 0, err
		}
	}

	var out model.Team
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := s.requireTeamAccess(ctx, q, p, in.ID, authz.ActionTeamUpdate)
		if err != nil {
			return err
		}

		if in.Private != nil && !*in.Private && before.ParentTeamID != nil {
			parent, err := q.GetTeam(ctx, *before.ParentTeamID)
			if err != nil {
				return platform.Internal(err)
			}
			if parent.Private {
				return platform.Conflict("sub-teams under a private parent must stay private")
			}
		}

		row, err := q.UpdateTeam(ctx, store.UpdateTeamParams{
			ID:          in.ID,
			Key:         in.Key,
			Name:        in.Name,
			Description: in.Description,
			Icon:        in.Icon,
			Color:       in.Color,
			Timezone:    in.Timezone,
			Private:     in.Private,
		})
		if err != nil {
			if store.IsUniqueViolation(err, "team_workspace_key_key") {
				return platform.Validation("key", "that key is already used by another team")
			}
			return platform.Internal(err)
		}
		out = toTeam(row)

		changes := []Change{{
			EntityType: "team", EntityID: out.ID, Op: OpUpsert, TeamID: &out.ID,
			Scope: authz.TeamScope(out.ID, out.Private), Payload: out,
		}}

		// Making a team private is an access change, not just a data change: everyone who
		// is not a member has to be told to forget it, or they keep a readable local copy
		// of a team they can no longer reach.
		if !before.Private && out.Private {
			revokes, err := s.revokeTeamContentsForNonMembers(ctx, q, p.WorkspaceID, out.ID)
			if err != nil {
				return err
			}
			changes = append(changes, revokes...)

			cleanup, err := s.privatizeTeamCleanup(ctx, q, out.ID, out.Key)
			if err != nil {
				return err
			}
			changes = append(changes, cleanup...)

			descChanges, err := s.cascadePrivateToSubTeams(ctx, q, p, out.ID)
			if err != nil {
				return err
			}
			changes = append(changes, descChanges...)
		}

		// Audited on the transition only, in both directions, and not on every team edit.
		//
		// Privacy is the one field on a team that changes who can READ things, which is why
		// it is here while a rename is not: an audit log that records every edit to every
		// team is one nobody scans. Opening a private team up is as much an access change as
		// closing one, and it is the direction with no cleanup code to make it visible
		// elsewhere, so it would otherwise leave no trace at all.
		if before.Private != out.Private {
			entry := s.auditBy(ctx, q, p, AuditTeamPrivacyChanged)
			entry.TargetType = "team"
			entry.TargetID = &out.ID
			entry.TargetLabel = out.Name
			entry.Before = map[string]any{"private": before.Private}
			entry.After = map[string]any{"private": out.Private}
			if err := s.recordAudit(ctx, q, entry); err != nil {
				return err
			}
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...)
		return err
	})
	return out, version, err
}

func (s *Service) ListTeams(ctx context.Context, p *authz.Principal) ([]model.Team, error) {
	rows, err := s.db.Queries().ListTeamsInWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Team, 0, len(rows))
	for _, r := range rows {
		// The same predicate the sync hub uses, plus admins who may list private teams they
		// have not joined for settings discovery.
		if !authz.TeamListable(p, r.ID, r.Private) {
			continue
		}
		out = append(out, toTeam(r))
	}
	return out, nil
}

// ListTeamMemberships returns who is in each of the caller's teams, from one read, keyed by
// team.
//
// The shape is the one internal/domain/issue_details.go uses for an issue's collections, and
// for the same reason: Team.members is resolved for every team a query names — a viewer
// query walking the whole workspace names all of them — and a read per team is the N+1 that
// makes a sidebar cost a query per row. One statement answers for the lot, and a caller
// resolving one team pays exactly the same as a caller resolving twenty.
//
// The listing covers the principal's visible team set and nothing beyond it — their own
// memberships plus, for anybody who is not a guest, the workspace's public teams. That set is
// not chosen here: it is exactly what StreamBootstrap ships memberships for, and exactly what
// the sync hub lets through, so the API and the replica hold the same rows. A listing that
// reached further would answer "who is in that team" for a private team somebody has
// deliberately not been added to, which is the leak the visibility predicate exists to
// prevent.
//
// A team outside that set is simply absent from the map rather than present and empty;
// minting the empty list is the GraphQL layer's job, because it is the layer that knows the
// field is non-null.
func (s *Service) ListTeamMemberships(
	ctx context.Context, p *authz.Principal,
) (map[uuid.UUID][]model.TeamMembership, error) {
	teamIDs := p.Teams.IDs()
	out := make(map[uuid.UUID][]model.TeamMembership, len(teamIDs))
	if len(teamIDs) == 0 {
		return out, nil
	}

	rows, err := s.db.Queries().ListTeamMembershipsForTeams(ctx, store.ListTeamMembershipsForTeamsParams{
		WorkspaceID: p.WorkspaceID,
		TeamIds:     teamIDs,
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, r := range rows {
		out[r.TeamID] = append(out[r.TeamID], toMembership(r))
	}
	return out, nil
}

// AddTeamMember adds a user to a team and hands them the team's contents on the sync
// stream by way of a resync hint — the client re-bootstraps rather than the server
// replaying every issue as an upsert, which would be unbounded work for a large team.
func (s *Service) AddTeamMember(ctx context.Context, p *authz.Principal, teamID, userID uuid.UUID, role string) (model.TeamMembership, int64, error) {
	if role == "" {
		role = "member"
	}
	if role != "member" && role != "owner" {
		return model.TeamMembership{}, 0, platform.Validation("role", "role must be member or owner")
	}

	var out model.TeamMembership
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		team, err := q.GetTeam(ctx, teamID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("team")
			}
			return platform.Internal(err)
		}
		// Adding somebody else requires admin; adding yourself is joining, which is
		// allowed for a public team you can already see.
		if userID != p.UserID {
			if !authz.Can(p, authz.ActionMemberInvite) {
				return platform.Forbidden("only admins can add people to teams")
			}
		} else {
			if team.Private {
				return platform.Forbidden("private teams are joined by invitation only")
			}
			if !authz.Can(p, authz.ActionTeamJoin) {
				return platform.Forbidden("")
			}
		}

		if err := s.requireSubTeamParentMembership(ctx, q, team, userID, p.IsGuest()); err != nil {
			return err
		}

		m, err := s.addMember(ctx, q, p.WorkspaceID, teamID, userID, role)
		if err != nil {
			return err
		}
		out = m

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "teamMembership", EntityID: out.ID, Op: OpUpsert, TeamID: &teamID,
			Scope: authz.TeamScope(teamID, team.Private), Payload: out,
		})
		return err
	})
	return out, version, err
}

// RemoveTeamMember removes a user from a team and revokes everything that team owns from
// that user's replica.
//
// The revoke is the point. Without it, somebody removed from a team keeps a complete,
// readable, permanently stale copy of its issues in their browser — and the failure is
// invisible, because nothing errors.
func (s *Service) RemoveTeamMember(ctx context.Context, p *authz.Principal, teamID, userID uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		team, err := q.GetTeam(ctx, teamID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("team")
			}
			return platform.Internal(err)
		}
		if userID != p.UserID && !authz.Can(p, authz.ActionMemberRemove) {
			return platform.Forbidden("only admins can remove people from teams")
		}

		n, err := q.RemoveTeamMember(ctx, store.RemoveTeamMemberParams{TeamID: teamID, UserID: userID})
		if err != nil {
			return platform.Internal(err)
		}
		if n == 0 {
			return platform.NotFound("team membership")
		}

		changes, err := s.revokeTeamContentsFor(ctx, q, teamID, team.Private, userID)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...)
		return err
	})
	return version, err
}

func (s *Service) addMember(
	ctx context.Context, q *store.Queries, workspaceID, teamID, userID uuid.UUID, role string,
) (model.TeamMembership, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return model.TeamMembership{}, platform.Internal(err)
	}
	row, err := q.AddTeamMember(ctx, store.AddTeamMemberParams{
		ID: id, WorkspaceID: workspaceID, TeamID: teamID, UserID: userID, Role: role,
	})
	if err != nil {
		if store.IsForeignKeyViolation(err) {
			return model.TeamMembership{}, platform.Validation("userId", "no such user in this workspace")
		}
		return model.TeamMembership{}, platform.Internal(err)
	}
	return toMembership(row), nil
}

// revokeTeamContentsFor builds the revoke changes for one user losing a team.
//
// The membership row is revoked and the team itself is revoked. Individual issues are NOT
// enumerated: a team can hold sixty thousand of them, and emitting sixty thousand change
// rows to remove one person would stall every other writer in the workspace behind the
// version lock. The client deletes a team's contents when it loses the team, which is
// both correct and O(1) on the server.
func (s *Service) revokeTeamContentsFor(
	ctx context.Context, q *store.Queries, teamID uuid.UUID, private bool, userID uuid.UUID,
) ([]Change, error) {
	// Scoped to the single user so nobody else's replica is touched.
	scope := authz.UserScope(userID)
	return []Change{
		{EntityType: "team", EntityID: teamID, Op: OpRevoke, TeamID: &teamID, Scope: scope},
	}, nil
}

// revokeTeamContentsForNonMembers is the same idea for a team that has just become
// private: everybody who is not in it must forget it.
//
// One revoke per non-member, addressed to that person, rather than a single team-scoped
// row. A team-scoped revoke is judged by the reader's team set, and a team set is resolved
// once — when a socket connects, or when a request arrives. So a team-scoped revoke of a
// team that has just gone private is delivered to precisely the readers who do not need it
// (sessions open across the flip, which also still hold the team) and withheld from the
// ones who do: anybody offline at the moment of the flip comes back, resumes from their
// cursor with a freshly resolved principal that no longer contains the team, and the revoke
// is filtered out as belonging to a team they cannot see. Their replica keeps the team and
// every issue in it, readable, for good. It also reached team members, whose replicas then
// deleted the private team's issues on the strength of a row meant for other people.
//
// authz.UserScope depends on no team set at all, so it survives both: it is delivered on
// resume however long the reader was away, and it never lands on a member.
//
// The cost is one change row per non-member of the team, on an action an admin takes rarely.
// That is bounded by the workspace's seat count, unlike enumerating the team's issues, which
// is what this deliberately does not do.
func (s *Service) revokeTeamContentsForNonMembers(
	ctx context.Context, q *store.Queries, workspaceID, teamID uuid.UUID,
) ([]Change, error) {
	users, err := q.ListUsersInWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	members, err := q.ListTeamMembers(ctx, teamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	inTeam := make(map[uuid.UUID]struct{}, len(members))
	for _, m := range members {
		inTeam[m.UserID] = struct{}{}
	}

	changes := make([]Change, 0, len(users))
	for _, u := range users {
		if _, ok := inTeam[u.ID]; ok {
			continue
		}
		changes = append(changes, Change{
			EntityType: "team", EntityID: teamID, Op: OpRevoke, TeamID: &teamID,
			Scope: authz.UserScope(u.ID),
		})
	}
	return changes, nil
}

// privatizeTeamCleanup strips non-member assignees and unsubscribes non-member watchers
// when a team becomes private.
func (s *Service) privatizeTeamCleanup(
	ctx context.Context, q *store.Queries, teamID uuid.UUID, teamKey string,
) ([]Change, error) {
	scope := authz.TeamScope(teamID, true)
	changes := make([]Change, 0)

	issues, err := q.ClearExternalAssigneesInTeam(ctx, teamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, row := range issues {
		issue := toIssue(store.AsIssueRow(row), teamKey)
		changes = append(changes, Change{
			EntityType: "issue", EntityID: row.ID, Op: OpUpsert, TeamID: &teamID,
			Scope: scope, Payload: issue,
		})
	}

	subs, err := q.UnsubscribeNonMembersFromTeamIssues(ctx, teamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, sub := range subs {
		changes = append(changes, Change{
			EntityType: "issueSubscription", EntityID: sub.ID, Op: OpUpsert,
			TeamID: &teamID, Scope: scope, Payload: toIssueSubscription(sub),
		})
	}

	return changes, nil
}

// requireTeamAccess loads a team and checks the principal may perform action on it,
// resolving team ownership from the membership row.
func (s *Service) requireTeamAccess(
	ctx context.Context, q *store.Queries, p *authz.Principal, teamID uuid.UUID, action authz.Action,
) (store.Team, error) {
	team, err := q.GetTeam(ctx, teamID)
	if err != nil {
		if store.IsNotFound(err) {
			return store.Team{}, platform.NotFound("team")
		}
		return store.Team{}, platform.Internal(err)
	}
	if team.WorkspaceID != p.WorkspaceID {
		// Deliberately not-found rather than forbidden: confirming that an id exists in
		// another workspace is itself a leak.
		return store.Team{}, platform.NotFound("team")
	}

	teamOwner := false
	if !p.Role.IsAdmin() {
		members, err := q.ListTeamMembers(ctx, teamID)
		if err != nil {
			return store.Team{}, platform.Internal(err)
		}
		for _, m := range members {
			if m.UserID == p.UserID && m.Role == "owner" {
				teamOwner = true
				break
			}
		}
	}

	if !authz.CanInTeam(p, action, teamID, teamOwner) {
		return store.Team{}, platform.Forbidden("")
	}
	if team.RetiredAt != nil {
		return store.Team{}, platform.Conflict("this team is retired and is read-only")
	}
	return team, nil
}

func validateTeamKey(key string) error {
	if key == "" {
		return platform.Validation("key", "team key is required")
	}
	if !teamKeyPattern.MatchString(key) {
		return platform.Validation("key",
			"team key must be 1-8 characters, start with a letter, and use only uppercase letters and digits")
	}
	return nil
}
