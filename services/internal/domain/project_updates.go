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

type CreateProjectUpdateInput struct {
	ProjectID uuid.UUID
	Health    string
	Body      string
}

type UpdateProjectUpdateInput struct {
	ID     uuid.UUID
	Health *string
	Body   *string
}

func parseProjectUpdateHealth(raw string) (string, error) {
	switch raw {
	case model.ProjectUpdateHealthOnTrack, model.ProjectUpdateHealthAtRisk, model.ProjectUpdateHealthOffTrack:
		return raw, nil
	default:
		return "", platform.Validation("health", "health must be on_track, at_risk or off_track")
	}
}

// CreateProjectUpdate posts a new status on a project. Each post is its own row — history
// is the list, and health on the project is derived from the newest one.
func (s *Service) CreateProjectUpdate(
	ctx context.Context, p *authz.Principal, in CreateProjectUpdateInput,
) (model.ProjectUpdate, int64, error) {
	health, err := parseProjectUpdateHealth(in.Health)
	if err != nil {
		return model.ProjectUpdate{}, 0, err
	}
	body := strings.TrimSpace(in.Body)
	if len(body) > maxDescriptionLength {
		return model.ProjectUpdate{}, 0, platform.Validation("body", "that body is too long")
	}

	var out model.ProjectUpdate
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		project, scope, err := s.requireProjectWrite(ctx, q, p, in.ProjectID, authz.ActionProjectUpdate)
		if err != nil {
			return err
		}
		if project.DeletedAt != nil || project.ArchivedAt != nil {
			return platform.NotFound("project")
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateProjectUpdate(ctx, store.CreateProjectUpdateParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			ProjectID:   in.ProjectID,
			Health:      health,
			Body:        body,
			AuthorID:    p.UserID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toProjectUpdate(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectUpdate", EntityID: id, Op: OpUpsert,
			Scope: scope, Payload: out,
		})
		return err
	})
	if err != nil {
		return model.ProjectUpdate{}, 0, err
	}
	return out, version, nil
}

// UpdateProjectUpdate edits health and/or body. Author-only, like comments.
func (s *Service) UpdateProjectUpdate(
	ctx context.Context, p *authz.Principal, in UpdateProjectUpdateInput,
) (model.ProjectUpdate, int64, error) {
	if in.Health == nil && in.Body == nil {
		return model.ProjectUpdate{}, 0, platform.Validation("input", "nothing to update")
	}

	var out model.ProjectUpdate
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetProjectUpdateForUpdate(ctx, in.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project update")
			}
			return platform.Internal(err)
		}
		if existing.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("project update")
		}
		_, scope, err := s.requireProjectWrite(ctx, q, p, existing.ProjectID, authz.ActionProjectUpdate)
		if err != nil {
			return err
		}
		if existing.AuthorID != p.UserID {
			return platform.Forbidden("you can only edit your own project updates")
		}

		params := store.UpdateProjectUpdateParams{ID: in.ID}
		if in.Health != nil {
			health, err := parseProjectUpdateHealth(*in.Health)
			if err != nil {
				return err
			}
			params.Health = &health
		}
		if in.Body != nil {
			body := strings.TrimSpace(*in.Body)
			if len(body) > maxDescriptionLength {
				return platform.Validation("body", "that body is too long")
			}
			params.Body = &body
		}

		row, err := q.UpdateProjectUpdate(ctx, params)
		if err != nil {
			return platform.Internal(err)
		}
		out = toProjectUpdate(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectUpdate", EntityID: in.ID, Op: OpUpsert,
			Scope: scope, Payload: out, ChangedFields: []string{"health", "body"},
		})
		return err
	})
	if err != nil {
		return model.ProjectUpdate{}, 0, err
	}
	return out, version, nil
}

func (s *Service) DeleteProjectUpdate(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetProjectUpdateForUpdate(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project update")
			}
			return platform.Internal(err)
		}
		if existing.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("project update")
		}
		_, scope, err := s.requireProjectWrite(ctx, q, p, existing.ProjectID, authz.ActionProjectUpdate)
		if err != nil {
			return err
		}
		if existing.AuthorID != p.UserID {
			return platform.Forbidden("you can only delete your own project updates")
		}

		if _, err := q.SoftDeleteProjectUpdate(ctx, id); err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectUpdate", EntityID: id, Op: OpDelete, Scope: scope,
		})
		return err
	})
	return version, err
}

func (s *Service) ListProjectUpdates(
	ctx context.Context, p *authz.Principal, projectID uuid.UUID,
) ([]model.ProjectUpdate, error) {
	q := s.db.Queries()
	project, err := q.GetProject(ctx, projectID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, platform.NotFound("project")
		}
		return nil, platform.Internal(err)
	}
	if project.WorkspaceID != p.WorkspaceID {
		return nil, platform.NotFound("project")
	}
	scope, err := s.projectScope(ctx, q, projectID)
	if err != nil {
		return nil, err
	}
	if !p.Role.IsAdmin() && !authz.Visible(p, scope) {
		return nil, platform.NotFound("project")
	}

	rows, err := q.ListProjectUpdatesForProject(ctx, projectID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.ProjectUpdate, 0, len(rows))
	for _, row := range rows {
		out = append(out, toProjectUpdate(row))
	}
	return out, nil
}

func (s *Service) GetProjectUpdate(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (model.ProjectUpdate, error) {
	q := s.db.Queries()
	row, err := q.GetProjectUpdate(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return model.ProjectUpdate{}, platform.NotFound("project update")
		}
		return model.ProjectUpdate{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID {
		return model.ProjectUpdate{}, platform.NotFound("project update")
	}
	scope, err := s.projectScope(ctx, q, row.ProjectID)
	if err != nil {
		return model.ProjectUpdate{}, err
	}
	if !p.Role.IsAdmin() && !authz.Visible(p, scope) {
		return model.ProjectUpdate{}, platform.NotFound("project update")
	}
	return toProjectUpdate(row), nil
}

func toProjectUpdate(row store.ProjectUpdate) model.ProjectUpdate {
	return model.ProjectUpdate{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		ProjectID:   row.ProjectID,
		Health:      row.Health,
		Body:        row.Body,
		AuthorID:    row.AuthorID,
		EditedAt:    row.EditedAt,
		DeletedAt:   row.DeletedAt,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}
