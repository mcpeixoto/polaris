package domain

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// MaxSubTeamLevels is the deepest nesting Enterprise allows (root counts as level 1).
const MaxSubTeamLevels = 5

func (s *Service) MoveTeam(
	ctx context.Context, p *authz.Principal, teamID uuid.UUID, parentID *uuid.UUID,
) (model.Team, int64, error) {
	if parentID != nil && *parentID == teamID {
		return model.Team{}, 0, platform.Validation("parentTeamId", "a team cannot be its own parent")
	}

	var out model.Team
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := s.requireTeamAccess(ctx, q, p, teamID, authz.ActionTeamUpdate); err != nil {
			return err
		}
		child, err := q.GetTeam(ctx, teamID)
		if err != nil {
			return platform.Internal(err)
		}

		resolvedPrivate, changes, err := s.applyTeamParent(ctx, q, p, child, parentID)
		if err != nil {
			return err
		}
		out = toTeam(resolvedPrivate)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...)
		return err
	})
	return out, version, err
}

func (s *Service) applyTeamParent(
	ctx context.Context, q *store.Queries, p *authz.Principal,
	child store.Team, parentID *uuid.UUID,
) (store.Team, []Change, error) {

	var parentRow *store.Team
	if parentID != nil {
		parent, err := q.GetTeam(ctx, *parentID)
		if err != nil {
			if store.IsNotFound(err) {
				return store.Team{}, nil, platform.NotFound("parent team")
			}
			return store.Team{}, nil, platform.Internal(err)
		}
		if parent.WorkspaceID != p.WorkspaceID {
			return store.Team{}, nil, platform.NotFound("parent team")
		}
		if parent.RetiredAt != nil {
			return store.Team{}, nil, platform.Conflict("retired teams cannot be parents")
		}
		parentRow = &parent
	}

	ent, err := entitlementSetFor(ctx, q, p.WorkspaceID)
	if err != nil {
		return store.Team{}, nil, err
	}
	if parentID != nil {
		if err := ent.Allow(entitlement.FeatureSubTeams); err != nil {
			return store.Team{}, nil, err
		}
	}

	if err := s.validateTeamParent(ctx, q, ent, child.ID, parentRow); err != nil {
		return store.Team{}, nil, err
	}

	private := child.Private
	if parentRow != nil && parentRow.Private {
		private = true
	}
	if private && !child.Private {
		if err := ent.Allow(entitlement.FeaturePrivateTeams); err != nil {
			return store.Team{}, nil, err
		}
	}

	var privatePatch *bool
	if private != child.Private {
		privatePatch = &private
	}

	row, err := q.UpdateTeamParent(ctx, store.UpdateTeamParentParams{
		ID: child.ID, ParentTeamID: parentID, Private: privatePatch,
	})
	if err != nil {
		return store.Team{}, nil, platform.Internal(err)
	}

	changes := []Change{{
		EntityType: "team", EntityID: row.ID, Op: OpUpsert, TeamID: &row.ID,
		Scope: authz.TeamScope(row.ID, row.Private), Payload: toTeam(row),
	}}

	if parentRow != nil {
		ownerChanges, err := s.ensureParentOwnersOnSubTeam(ctx, q, p.WorkspaceID, parentRow.ID, child.ID, row.Private)
		if err != nil {
			return store.Team{}, nil, err
		}
		changes = append(changes, ownerChanges...)
		if parentRow.CyclesEnabled {
			inherited, extra, err := applyInheritedCycleSchedule(ctx, q, *parentRow, row, time.Now())
			if err != nil {
				return store.Team{}, nil, err
			}
			row = inherited
			if len(extra) > 1 {
				changes = append(changes, extra[1:]...)
			}
			changes[0].Payload = toTeam(row)
		}
	}

	if !child.Private && row.Private {
		// Everything privatising a team does through Settings has to happen here too. A
		// team can be made private in two ways — the visibility toggle, and being moved
		// under a private parent — and only one of them used to clean up after itself.
		revokes, err := s.revokeTeamContentsForNonMembers(ctx, q, p.WorkspaceID, row.ID)
		if err != nil {
			return store.Team{}, nil, err
		}
		changes = append(changes, revokes...)

		cleanup, err := s.privatizeTeamCleanup(ctx, q, row.ID, row.Key)
		if err != nil {
			return store.Team{}, nil, err
		}
		changes = append(changes, cleanup...)

		// The moved team may bring a sub-tree with it. Those teams are now under a private
		// ancestor, and a public team under a private parent is a state UpdateTeam refuses
		// to create on purpose: it is a hole straight through the privacy boundary.
		descChanges, err := s.cascadePrivateToSubTeams(ctx, q, p, row.ID)
		if err != nil {
			return store.Team{}, nil, err
		}
		changes = append(changes, descChanges...)
	}

	return row, changes, nil
}

func (s *Service) validateTeamParent(
	ctx context.Context, q *store.Queries, ent entitlement.Set,
	teamID uuid.UUID, parent *store.Team,
) error {
	if parent == nil {
		return nil
	}

	if parent.ID == teamID {
		return platform.Validation("parentTeamId", "a team cannot be its own parent")
	}

	ancestors, err := s.teamAncestorChain(ctx, q, parent.ID)
	if err != nil {
		return err
	}
	for _, id := range ancestors {
		if id == teamID {
			return platform.Conflict("a team cannot be nested under its own descendant")
		}
	}

	parentDepth := len(ancestors) // root => 0
	subtreeDepth, err := s.teamSubtreeDepth(ctx, q, teamID)
	if err != nil {
		return err
	}
	newMaxDepth := parentDepth + 1 + subtreeDepth
	if newMaxDepth >= MaxSubTeamLevels {
		return platform.Conflict("nesting cannot exceed five team levels")
	}

	if !ent.Has(entitlement.FeatureMultiLevelSubTeams) && parentDepth > 0 {
		return platform.Conflict("multi-level sub-teams require an Enterprise plan")
	}

	return nil
}

func (s *Service) teamAncestorChain(ctx context.Context, q *store.Queries, teamID uuid.UUID) ([]uuid.UUID, error) {
	var chain []uuid.UUID
	current := teamID
	for i := 0; i < MaxSubTeamLevels; i++ {
		row, err := q.GetTeam(ctx, current)
		if err != nil {
			if store.IsNotFound(err) {
				return nil, platform.NotFound("team")
			}
			return nil, platform.Internal(err)
		}
		if row.ParentTeamID == nil {
			return chain, nil
		}
		chain = append(chain, *row.ParentTeamID)
		current = *row.ParentTeamID
	}
	return nil, platform.Conflict("team hierarchy is too deep")
}

func (s *Service) teamSubtreeDepth(ctx context.Context, q *store.Queries, teamID uuid.UUID) (int, error) {
	children, err := q.ListChildTeams(ctx, &teamID)
	if err != nil {
		return 0, platform.Internal(err)
	}
	max := 0
	for _, child := range children {
		d, err := s.teamSubtreeDepth(ctx, q, child.ID)
		if err != nil {
			return 0, err
		}
		if d+1 > max {
			max = d + 1
		}
	}
	return max, nil
}

func (s *Service) ensureParentOwnersOnSubTeam(
	ctx context.Context, q *store.Queries, workspaceID, parentID, childID uuid.UUID, childPrivate bool,
) ([]Change, error) {
	members, err := q.ListTeamMembers(ctx, parentID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	var changes []Change
	for _, m := range members {
		if m.Role != "owner" {
			continue
		}
		exists, err := q.IsTeamMember(ctx, store.IsTeamMemberParams{TeamID: childID, UserID: m.UserID})
		if err != nil {
			return nil, platform.Internal(err)
		}
		if exists {
			continue
		}
		membership, err := s.addMember(ctx, q, workspaceID, childID, m.UserID, "owner")
		if err != nil {
			return nil, err
		}
		changes = append(changes, Change{
			EntityType: "teamMembership", EntityID: membership.ID, Op: OpUpsert, TeamID: &childID,
			Scope: authz.TeamScope(childID, childPrivate), Payload: membership,
		})
	}
	return changes, nil
}

func (s *Service) requireSubTeamParentMembership(
	ctx context.Context, q *store.Queries, team store.Team, userID uuid.UUID, isGuest bool,
) error {
	if team.ParentTeamID == nil || isGuest {
		return nil
	}
	ok, err := q.IsTeamMember(ctx, store.IsTeamMemberParams{TeamID: *team.ParentTeamID, UserID: userID})
	if err != nil {
		return platform.Internal(err)
	}
	if !ok {
		return platform.Forbidden("sub-team members must belong to the parent team")
	}
	return nil
}

func (s *Service) cascadePrivateToSubTeams(
	ctx context.Context, q *store.Queries, p *authz.Principal, parentID uuid.UUID,
) ([]Change, error) {
	ids, err := s.collectDescendantTeamIDs(ctx, q, parentID)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, nil
	}
	if _, err := q.SetTeamsPrivate(ctx, ids); err != nil {
		return nil, platform.Internal(err)
	}

	var changes []Change
	for _, id := range ids {
		row, err := q.GetTeam(ctx, id)
		if err != nil {
			return nil, platform.Internal(err)
		}
		changes = append(changes, Change{
			EntityType: "team", EntityID: id, Op: OpUpsert, TeamID: &id,
			Scope: authz.TeamScope(id, true), Payload: toTeam(row),
		})
		// A descendant dragged private by its parent has to be taken off non-members'
		// replicas as surely as the parent itself. The upsert above is private-scoped, so
		// a non-member never sees it: without this they simply keep the sub-team they had.
		revokes, err := s.revokeTeamContentsForNonMembers(ctx, q, p.WorkspaceID, id)
		if err != nil {
			return nil, err
		}
		changes = append(changes, revokes...)
		cleanup, err := s.privatizeTeamCleanup(ctx, q, id, row.Key)
		if err != nil {
			return nil, err
		}
		changes = append(changes, cleanup...)
	}
	return changes, nil
}

func (s *Service) collectDescendantTeamIDs(ctx context.Context, q *store.Queries, parentID uuid.UUID) ([]uuid.UUID, error) {
	children, err := q.ListChildTeams(ctx, &parentID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	var out []uuid.UUID
	for _, child := range children {
		out = append(out, child.ID)
		desc, err := s.collectDescendantTeamIDs(ctx, q, child.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, desc...)
	}
	return out, nil
}

func (s *Service) ListSubTeams(ctx context.Context, p *authz.Principal, parentID uuid.UUID) ([]model.Team, error) {
	parent, err := s.db.Queries().GetTeam(ctx, parentID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, platform.NotFound("team")
		}
		return nil, platform.Internal(err)
	}
	if parent.WorkspaceID != p.WorkspaceID {
		return nil, platform.NotFound("team")
	}
	if !authz.TeamListable(p, parent.ID, parent.Private) {
		return nil, platform.NotFound("team")
	}

	rows, err := s.db.Queries().ListChildTeams(ctx, &parentID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Team, 0, len(rows))
	for _, row := range rows {
		if !authz.TeamListable(p, row.ID, row.Private) {
			continue
		}
		out = append(out, toTeam(row))
	}
	return out, nil
}
