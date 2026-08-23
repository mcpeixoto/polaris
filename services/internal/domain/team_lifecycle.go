package domain

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/notify"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// TeamRestoreWindow matches the issue trash window: one number, one promise.
const TeamRestoreWindow = IssueRestoreWindow

func (s *Service) RetireTeam(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.Team, int64, error) {
	var out model.Team
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := s.requireTeamLifecycle(ctx, q, p, id); err != nil {
			return err
		}
		children, err := q.CountChildTeams(ctx, &id)
		if err != nil {
			return platform.Internal(err)
		}
		if children > 0 {
			return platform.Conflict("retire or remove sub-teams before retiring this team")
		}
		row, err := q.RetireTeam(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("team")
			}
			return platform.Internal(err)
		}
		out = toTeam(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "team", EntityID: out.ID, Op: OpUpsert, TeamID: &out.ID,
			Scope: authz.TeamScope(out.ID, out.Private), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) UnretireTeam(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.Team, int64, error) {
	var out model.Team
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := s.requireTeamLifecycle(ctx, q, p, id); err != nil {
			return err
		}
		row, err := q.UnretireTeam(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("team")
			}
			return platform.Internal(err)
		}
		out = toTeam(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "team", EntityID: out.ID, Op: OpUpsert, TeamID: &out.ID,
			Scope: authz.TeamScope(out.ID, out.Private), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteTeam(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		team, err := s.requireTeamLifecycle(ctx, q, p, id)
		if err != nil {
			return err
		}
		children, err := q.CountChildTeams(ctx, &id)
		if err != nil {
			return platform.Internal(err)
		}
		if children > 0 {
			return platform.Conflict("retire or remove sub-teams before deleting this team")
		}
		if _, err := q.SoftDeleteIssuesInTeam(ctx, store.SoftDeleteIssuesInTeamParams{
			TeamID: id, DeletedBy: &p.UserID,
		}); err != nil {
			return platform.Internal(err)
		}
		if _, err := q.SoftDeleteTeam(ctx, id); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("team")
			}
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "team", EntityID: id, Op: OpDelete, TeamID: &id,
			Scope: authz.TeamScope(id, team.Private),
		})
		return err
	})
	return version, err
}

func (s *Service) RestoreTeam(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.Team, int64, error) {
	var out model.Team
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		cutoff := time.Now().Add(-TeamRestoreWindow)
		row, err := q.RestoreTeam(ctx, store.RestoreTeamParams{
			ID: id, DeletedAfter: &cutoff,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("team")
			}
			// The key uniqueness index is partial — `WHERE deleted_at IS NULL` — so deleting a
			// team frees its key for the next one, and restoring it thirty days later can find
			// somebody standing in its place. That is a thing a workspace does to itself, not a
			// fault: without this it surfaced on the Recently deleted teams screen as the word
			// "internal error", which tells the person who has to fix it nothing about what to
			// fix.
			if store.IsUniqueViolation(err, "team_workspace_key_key") {
				return platform.Conflict(
					"another team has taken this team's key — rename that team before restoring this one")
			}
			return platform.Internal(err)
		}
		if row.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("team")
		}
		if _, err := s.requireTeamLifecycle(ctx, q, p, id); err != nil {
			return err
		}
		if _, err := q.RestoreIssuesInTeam(ctx, store.RestoreIssuesInTeamParams{
			TeamID: id, DeletedAfter: &cutoff,
		}); err != nil {
			return platform.Internal(err)
		}
		out = toTeam(row)

		changes := []Change{{
			EntityType: "team", EntityID: id, Op: OpUpsert, TeamID: &id,
			Scope: authz.TeamScope(id, out.Private), Payload: out,
		}}

		issues, err := q.ListIssuesForTeam(ctx, id)
		if err != nil {
			return platform.Internal(err)
		}
		scope := authz.TeamScope(id, out.Private)
		for _, issueRow := range issues {
			issue := toIssue(store.AsIssueRow(issueRow), out.Key)
			changes = append(changes, Change{
				EntityType: "issue", EntityID: issueRow.ID, Op: OpUpsert, TeamID: &id,
				Scope: scope, Payload: issue,
				ChangedFields: []string{notify.FieldDeleted},
			})
			contents, err := restoredIssueContents(ctx, q, p.WorkspaceID, store.AsIssueRow(issueRow), out.Private)
			if err != nil {
				return err
			}
			changes = append(changes, contents...)
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...)
		return err
	})
	return out, version, err
}

// ListDeletedTeams is the recently-deleted teams screen for admins and team owners.
func (s *Service) ListDeletedTeams(ctx context.Context, p *authz.Principal) ([]model.Team, error) {
	cutoff := time.Now().Add(-TeamRestoreWindow)
	rows, err := s.db.Queries().ListDeletedTeams(ctx, store.ListDeletedTeamsParams{
		WorkspaceID: p.WorkspaceID, DeletedAfter: &cutoff,
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Team, 0, len(rows))
	for _, row := range rows {
		if !p.Role.IsAdmin() && !s.canManageDeletedTeam(ctx, s.db.Queries(), p, row.ID) {
			continue
		}
		out = append(out, toTeam(row))
	}
	return out, nil
}

func (s *Service) canManageDeletedTeam(
	ctx context.Context, q *store.Queries, p *authz.Principal, teamID uuid.UUID,
) bool {
	members, err := q.ListTeamMembers(ctx, teamID)
	if err != nil {
		return false
	}
	teamOwner := false
	for _, m := range members {
		if m.UserID == p.UserID && m.Role == "owner" {
			teamOwner = true
			break
		}
	}
	return authz.CanInTeam(p, authz.ActionTeamDelete, teamID, teamOwner)
}

func (s *Service) requireTeamLifecycle(
	ctx context.Context, q *store.Queries, p *authz.Principal, teamID uuid.UUID,
) (store.Team, error) {
	team, err := q.GetTeam(ctx, teamID)
	if err != nil {
		if store.IsNotFound(err) {
			return store.Team{}, platform.NotFound("team")
		}
		return store.Team{}, platform.Internal(err)
	}
	if team.WorkspaceID != p.WorkspaceID {
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
	if !authz.CanInTeam(p, authz.ActionTeamDelete, teamID, teamOwner) {
		return store.Team{}, platform.Forbidden("")
	}
	return team, nil
}
