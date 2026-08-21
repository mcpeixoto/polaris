package domain

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/fractional"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

func validInitiativeStatus(s string) bool {
	switch s {
	case model.InitiativeStatusProposed, model.InitiativeStatusPlanned, model.InitiativeStatusActive,
		model.InitiativeStatusCompleted, model.InitiativeStatusCanceled:
		return true
	}
	return false
}

type CreateInitiativeInput struct {
	Name                  string
	Description           string
	Status                string
	Priority              int
	OwnerID               *uuid.UUID
	LeadTeamID            *uuid.UUID
	TargetDate            *model.Date
	TargetDateGranularity *string
	ParentInitiativeID    *uuid.UUID
}

type UpdateInitiativeInput struct {
	ID                    uuid.UUID
	Name                  *string
	Description           *string
	Status                *string
	Priority              *int
	OwnerID               *uuid.UUID
	ClearOwner            bool
	LeadTeamID            *uuid.UUID
	ClearLeadTeam         bool
	TargetDate            *model.Date
	TargetDateGranularity *string
	ClearTarget           bool
}

// CreateInitiative opens a workspace objective that can later collect projects.
func (s *Service) CreateInitiative(
	ctx context.Context, p *authz.Principal, in CreateInitiativeInput,
) (model.Initiative, int64, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return model.Initiative{}, 0, platform.Validation("name", "an initiative needs a name")
	}
	if !authz.Can(p, authz.ActionProjectCreate) {
		return model.Initiative{}, 0, platform.Forbidden("initiative")
	}
	status := in.Status
	if status == "" {
		status = model.InitiativeStatusPlanned
	}
	if !validInitiativeStatus(status) {
		return model.Initiative{}, 0, platform.Validation("status",
			"status is proposed, planned, active, completed or canceled")
	}
	if in.Priority < 0 || in.Priority > 4 {
		return model.Initiative{}, 0, platform.Validation("priority", "priority must be 0 (none) to 4 (low)")
	}
	target, targetG, err := resolveTimeframe(in.TargetDate, in.TargetDateGranularity)
	if err != nil {
		return model.Initiative{}, 0, err
	}

	var out model.Initiative
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if in.LeadTeamID != nil {
			if _, err := s.requireTeamAccess(ctx, q, p, *in.LeadTeamID, authz.ActionIssueCreate); err != nil {
				if !p.Role.IsAdmin() {
					return err
				}
				if _, err := q.GetTeam(ctx, *in.LeadTeamID); err != nil {
					if store.IsNotFound(err) {
						return platform.NotFound("team")
					}
					return platform.Internal(err)
				}
			}
		}
		if in.OwnerID != nil {
			if _, err := q.GetUser(ctx, *in.OwnerID); err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("user")
				}
				return platform.Internal(err)
			}
		}

		pos, err := nextInitiativeSort(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		creator := p.UserID
		row, err := q.CreateInitiative(ctx, store.CreateInitiativeParams{
			ID:                    id,
			WorkspaceID:           p.WorkspaceID,
			Name:                  name,
			Description:           in.Description,
			Status:                status,
			Priority:              int16(in.Priority),
			OwnerID:               in.OwnerID,
			LeadTeamID:            in.LeadTeamID,
			CreatorID:             &creator,
			SortOrder:             pos,
			TargetDate:            target,
			TargetDateGranularity: targetG,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toInitiative(row)
		scope, err := s.initiativeScope(ctx, q, row)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiative", EntityID: id, Op: OpUpsert, Scope: scope, Payload: out,
		})
		if err != nil {
			return err
		}
		if in.ParentInitiativeID != nil {
			rel, err := s.insertInitiativeRelation(ctx, q, p, *in.ParentInitiativeID, id)
			if err != nil {
				return err
			}
			version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "initiativeRelation", EntityID: rel.ID, Op: OpUpsert,
				Scope: authz.WorkspaceScope(), Payload: rel,
			})
			if err != nil {
				return err
			}
		}
		return nil
	})
	return out, version, err
}

// UpdateInitiative edits properties on a live initiative.
func (s *Service) UpdateInitiative(
	ctx context.Context, p *authz.Principal, in UpdateInitiativeInput,
) (model.Initiative, int64, error) {
	if in.Name == nil && in.Description == nil && in.Status == nil && in.Priority == nil &&
		in.OwnerID == nil && !in.ClearOwner && in.LeadTeamID == nil && !in.ClearLeadTeam &&
		in.TargetDate == nil && in.TargetDateGranularity == nil && !in.ClearTarget {
		return model.Initiative{}, 0, platform.Validation("input", "nothing to update")
	}
	if in.Name != nil {
		trimmed := strings.TrimSpace(*in.Name)
		if trimmed == "" {
			return model.Initiative{}, 0, platform.Validation("name", "an initiative needs a name")
		}
		in.Name = &trimmed
	}
	if in.Status != nil && !validInitiativeStatus(*in.Status) {
		return model.Initiative{}, 0, platform.Validation("status",
			"status is proposed, planned, active, completed or canceled")
	}
	if in.Priority != nil && (*in.Priority < 0 || *in.Priority > 4) {
		return model.Initiative{}, 0, platform.Validation("priority", "priority must be 0 (none) to 4 (low)")
	}
	if in.TargetDate != nil && in.ClearTarget {
		return model.Initiative{}, 0, platform.Validation("targetDate", "cannot set and clear the date in one call")
	}
	var target pgtype.Date
	var targetG *string
	if in.TargetDate != nil || in.TargetDateGranularity != nil || in.ClearTarget {
		td, tg, err := resolveTimeframe(in.TargetDate, in.TargetDateGranularity)
		if err != nil {
			return model.Initiative{}, 0, err
		}
		target = td
		targetG = tg
	}

	var out model.Initiative
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, scope, err := s.requireInitiativeWrite(ctx, q, p, in.ID)
		if err != nil {
			return err
		}
		if existing.DeletedAt != nil {
			return platform.NotFound("initiative")
		}
		if in.LeadTeamID != nil {
			if _, err := s.requireTeamAccess(ctx, q, p, *in.LeadTeamID, authz.ActionIssueCreate); err != nil {
				if !p.Role.IsAdmin() {
					return err
				}
				if _, err := q.GetTeam(ctx, *in.LeadTeamID); err != nil {
					if store.IsNotFound(err) {
						return platform.NotFound("team")
					}
					return platform.Internal(err)
				}
			}
		}
		if in.OwnerID != nil {
			if _, err := q.GetUser(ctx, *in.OwnerID); err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("user")
				}
				return platform.Internal(err)
			}
		}

		row, err := q.UpdateInitiative(ctx, store.UpdateInitiativeParams{
			ID:                    in.ID,
			Name:                  in.Name,
			Description:           in.Description,
			Status:                in.Status,
			Priority:              priorityParam(in.Priority),
			ClearTarget:           in.ClearTarget,
			TargetDate:            target,
			TargetDateGranularity: targetG,
			ClearOwner:            in.ClearOwner,
			OwnerID:               in.OwnerID,
			ClearLeadTeam:         in.ClearLeadTeam,
			LeadTeamID:            in.LeadTeamID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("initiative")
			}
			return platform.Internal(err)
		}
		out = toInitiative(row)
		scope, err = s.initiativeScope(ctx, q, row)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiative", EntityID: in.ID, Op: OpUpsert, Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

// ArchiveInitiative moves an initiative off the live list, or brings it back.
func (s *Service) ArchiveInitiative(
	ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool,
) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, scope, err := s.requireInitiativeWrite(ctx, q, p, id)
		if err != nil {
			return err
		}
		if existing.DeletedAt != nil {
			return platform.NotFound("initiative")
		}

		op := OpUpsert
		var payload model.Initiative
		if archived {
			op = OpDelete
			if err := q.ArchiveInitiative(ctx, id); err != nil {
				return platform.Internal(err)
			}
			if err := emitInitiativeSubscriptionDeletes(ctx, s.em, q, p.WorkspaceID, id); err != nil {
				return err
			}
			payload = toInitiative(existing)
		} else {
			row, err := q.UnarchiveInitiative(ctx, id)
			if err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("initiative")
				}
				return platform.Internal(err)
			}
			payload = toInitiative(row)
			scope, err = s.initiativeScope(ctx, q, row)
			if err != nil {
				return err
			}
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiative", EntityID: id, Op: op, Scope: scope, Payload: payload,
		})
		return err
	})
	return version, err
}

// DeleteInitiative soft-deletes, leaving a recovery window like projects.
func (s *Service) DeleteInitiative(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, scope, err := s.requireInitiativeWrite(ctx, q, p, id)
		if err != nil {
			return err
		}
		if existing.DeletedAt != nil {
			return platform.NotFound("initiative")
		}

		row, err := q.SoftDeleteInitiative(ctx, store.SoftDeleteInitiativeParams{
			ID: id, DeletedBy: &p.UserID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("initiative")
			}
			return platform.Internal(err)
		}
		payload := toInitiative(row)
		if err := emitInitiativeSubscriptionDeletes(ctx, s.em, q, p.WorkspaceID, id); err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiative", EntityID: id, Op: OpDelete, Scope: scope, Payload: payload,
		})
		return err
	})
	return version, err
}

// GetInitiative loads one row when the caller may see it.
func (s *Service) GetInitiative(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.Initiative, error) {
	row, err := s.db.Queries().GetInitiative(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return model.Initiative{}, platform.NotFound("initiative")
		}
		return model.Initiative{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.DeletedAt != nil {
		return model.Initiative{}, platform.NotFound("initiative")
	}
	if row.ArchivedAt != nil {
		return model.Initiative{}, platform.NotFound("initiative")
	}
	scope, err := s.initiativeScope(ctx, s.db.Queries(), row)
	if err != nil {
		return model.Initiative{}, err
	}
	if !authz.Visible(p, scope) {
		return model.Initiative{}, platform.NotFound("initiative")
	}
	return toInitiative(row), nil
}

// AddInitiativeProject attaches a project the caller can see to an initiative they can edit.
func (s *Service) AddInitiativeProject(
	ctx context.Context, p *authz.Principal, initiativeID, projectID uuid.UUID,
) (model.InitiativeProject, int64, error) {
	var out model.InitiativeProject
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, scope, err := s.requireInitiativeWrite(ctx, q, p, initiativeID)
		if err != nil {
			return err
		}
		if _, _, err := s.requireProjectWrite(ctx, q, p, projectID, authz.ActionProjectUpdate); err != nil {
			return err
		}
		if _, err := q.GetInitiativeProjectByPair(ctx, store.GetInitiativeProjectByPairParams{
			InitiativeID: initiativeID, ProjectID: projectID,
		}); err == nil {
			return platform.Validation("projectId", "that project is already in the initiative")
		} else if !store.IsNotFound(err) {
			return platform.Internal(err)
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateInitiativeProject(ctx, store.CreateInitiativeProjectParams{
			ID: id, WorkspaceID: p.WorkspaceID, InitiativeID: initiativeID, ProjectID: projectID,
		})
		if err != nil {
			if store.IsUniqueViolation(err, "initiative_project_unique") {
				return platform.Validation("projectId", "that project is already in the initiative")
			}
			return platform.Internal(err)
		}
		out = toInitiativeProject(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiativeProject", EntityID: id, Op: OpUpsert, Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

// RemoveInitiativeProject detaches one curated project link.
func (s *Service) RemoveInitiativeProject(
	ctx context.Context, p *authz.Principal, initiativeID, projectID uuid.UUID,
) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, scope, err := s.requireInitiativeWrite(ctx, q, p, initiativeID)
		if err != nil {
			return err
		}
		row, err := q.GetInitiativeProjectByPair(ctx, store.GetInitiativeProjectByPairParams{
			InitiativeID: initiativeID, ProjectID: projectID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("initiative project")
			}
			return platform.Internal(err)
		}
		if _, err := q.DeleteInitiativeProject(ctx, row.ID); err != nil {
			return platform.Internal(err)
		}
		payload := toInitiativeProject(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiativeProject", EntityID: row.ID, Op: OpDelete, Scope: scope, Payload: payload,
		})
		return err
	})
	return version, err
}

// ListInitiatives returns live initiatives the caller may see.
func (s *Service) ListInitiatives(ctx context.Context, p *authz.Principal) ([]model.Initiative, error) {
	rows, err := s.db.Queries().ListInitiativesInWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Initiative, 0, len(rows))
	for _, row := range rows {
		scope, err := s.initiativeScope(ctx, s.db.Queries(), row)
		if err != nil {
			return nil, err
		}
		if !authz.Visible(p, scope) {
			continue
		}
		out = append(out, toInitiative(row))
	}
	return out, nil
}

// ListInitiativeProjects lists curated project links for one initiative.
func (s *Service) ListInitiativeProjects(
	ctx context.Context, p *authz.Principal, initiativeID uuid.UUID,
) ([]model.InitiativeProject, error) {
	if _, err := s.GetInitiative(ctx, p, initiativeID); err != nil {
		return nil, err
	}
	rows, err := s.db.Queries().ListInitiativeProjects(ctx, initiativeID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.InitiativeProject, 0, len(rows))
	for _, row := range rows {
		scope, err := s.projectScope(ctx, s.db.Queries(), row.ProjectID)
		if err != nil {
			return nil, err
		}
		if !p.Role.IsAdmin() && !authz.Visible(p, scope) {
			continue
		}
		out = append(out, toInitiativeProject(row))
	}
	return out, nil
}

func (s *Service) initiativeScope(ctx context.Context, q *store.Queries, row store.Initiative) (authz.Scope, error) {
	if row.LeadTeamID == nil {
		return authz.WorkspaceScope(), nil
	}
	team, err := q.GetTeam(ctx, *row.LeadTeamID)
	if err != nil {
		if store.IsNotFound(err) {
			return authz.Scope{}, platform.NotFound("team")
		}
		return authz.Scope{}, platform.Internal(err)
	}
	if team.Private {
		return authz.TeamScope(*row.LeadTeamID, true), nil
	}
	return authz.WorkspaceScope(), nil
}

func (s *Service) requireInitiativeWrite(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.Initiative, authz.Scope, error) {
	if !authz.Can(p, authz.ActionProjectUpdate) {
		return store.Initiative{}, authz.Scope{}, platform.Forbidden("initiative")
	}
	row, err := q.GetInitiativeForUpdate(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.Initiative{}, authz.Scope{}, platform.NotFound("initiative")
		}
		return store.Initiative{}, authz.Scope{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID {
		return store.Initiative{}, authz.Scope{}, platform.NotFound("initiative")
	}
	scope, err := s.initiativeScope(ctx, q, row)
	if err != nil {
		return store.Initiative{}, authz.Scope{}, err
	}
	if !authz.Visible(p, scope) {
		return store.Initiative{}, authz.Scope{}, platform.NotFound("initiative")
	}
	return row, scope, nil
}

func nextInitiativeSort(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) (string, error) {
	last, err := q.LastInitiativeSortOrder(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

func toInitiative(i store.Initiative) model.Initiative {
	return model.Initiative{
		ID:                    i.ID,
		WorkspaceID:           i.WorkspaceID,
		Name:                  i.Name,
		Description:           i.Description,
		Status:                i.Status,
		Priority:              i.Priority,
		OwnerID:               i.OwnerID,
		LeadTeamID:            i.LeadTeamID,
		CreatorID:             i.CreatorID,
		SortOrder:             i.SortOrder,
		TargetDate:            dateOf(i.TargetDate),
		TargetDateGranularity: i.TargetDateGranularity,
		ArchivedAt:            i.ArchivedAt,
		DeletedAt:             i.DeletedAt,
		DeletedBy:             i.DeletedBy,
		CreatedAt:             i.CreatedAt,
		UpdatedAt:             i.UpdatedAt,
	}
}

func toInitiativeProject(ip store.InitiativeProject) model.InitiativeProject {
	return model.InitiativeProject{
		ID:           ip.ID,
		WorkspaceID:  ip.WorkspaceID,
		InitiativeID: ip.InitiativeID,
		ProjectID:    ip.ProjectID,
		CreatedAt:    ip.CreatedAt,
	}
}

func priorityParam(p *int) *int16 {
	if p == nil {
		return nil
	}
	v := int16(*p)
	return &v
}
