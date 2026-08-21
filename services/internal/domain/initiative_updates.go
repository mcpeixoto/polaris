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

type CreateInitiativeUpdateInput struct {
	InitiativeID uuid.UUID
	Health       string
	Body         string
}

type UpdateInitiativeUpdateInput struct {
	ID     uuid.UUID
	Health *string
	Body   *string
}

// CreateInitiativeUpdate posts a new status on an initiative. Each post is its own row —
// history is the list, and health on the initiative is derived from the newest one.
func (s *Service) CreateInitiativeUpdate(
	ctx context.Context, p *authz.Principal, in CreateInitiativeUpdateInput,
) (model.InitiativeUpdate, int64, error) {
	health, err := parseProjectUpdateHealth(in.Health)
	if err != nil {
		return model.InitiativeUpdate{}, 0, err
	}
	body := strings.TrimSpace(in.Body)
	if len(body) > maxDescriptionLength {
		return model.InitiativeUpdate{}, 0, platform.Validation("body", "that body is too long")
	}

	var out model.InitiativeUpdate
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		initiative, scope, err := s.requireInitiativeWrite(ctx, q, p, in.InitiativeID)
		if err != nil {
			return err
		}
		if initiative.DeletedAt != nil || initiative.ArchivedAt != nil {
			return platform.NotFound("initiative")
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateInitiativeUpdate(ctx, store.CreateInitiativeUpdateParams{
			ID:           id,
			WorkspaceID:  p.WorkspaceID,
			InitiativeID: in.InitiativeID,
			Health:       health,
			Body:         body,
			AuthorID:     p.UserID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toInitiativeUpdate(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiativeUpdate", EntityID: id, Op: OpUpsert,
			Scope: scope, Payload: out,
		})
		return err
	})
	if err != nil {
		return model.InitiativeUpdate{}, 0, err
	}
	return out, version, nil
}

// UpdateInitiativeUpdate edits health and/or body. Author-only, like comments.
func (s *Service) UpdateInitiativeUpdate(
	ctx context.Context, p *authz.Principal, in UpdateInitiativeUpdateInput,
) (model.InitiativeUpdate, int64, error) {
	if in.Health == nil && in.Body == nil {
		return model.InitiativeUpdate{}, 0, platform.Validation("input", "nothing to update")
	}

	var out model.InitiativeUpdate
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetInitiativeUpdateForUpdate(ctx, in.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("initiative update")
			}
			return platform.Internal(err)
		}
		if existing.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("initiative update")
		}
		_, scope, err := s.requireInitiativeWrite(ctx, q, p, existing.InitiativeID)
		if err != nil {
			return err
		}
		if existing.AuthorID != p.UserID {
			return platform.Forbidden("you can only edit your own initiative updates")
		}

		params := store.UpdateInitiativeUpdateParams{ID: in.ID}
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

		row, err := q.UpdateInitiativeUpdate(ctx, params)
		if err != nil {
			return platform.Internal(err)
		}
		out = toInitiativeUpdate(row)

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiativeUpdate", EntityID: in.ID, Op: OpUpsert,
			Scope: scope, Payload: out, ChangedFields: []string{"health", "body"},
		})
		return err
	})
	if err != nil {
		return model.InitiativeUpdate{}, 0, err
	}
	return out, version, nil
}

func (s *Service) DeleteInitiativeUpdate(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetInitiativeUpdateForUpdate(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("initiative update")
			}
			return platform.Internal(err)
		}
		if existing.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("initiative update")
		}
		_, scope, err := s.requireInitiativeWrite(ctx, q, p, existing.InitiativeID)
		if err != nil {
			return err
		}
		if existing.AuthorID != p.UserID {
			return platform.Forbidden("you can only delete your own initiative updates")
		}

		if _, err := q.SoftDeleteInitiativeUpdate(ctx, id); err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiativeUpdate", EntityID: id, Op: OpDelete, Scope: scope,
		})
		return err
	})
	return version, err
}

func (s *Service) ListInitiativeUpdates(
	ctx context.Context, p *authz.Principal, initiativeID uuid.UUID,
) ([]model.InitiativeUpdate, error) {
	q := s.db.Queries()
	row, err := q.GetInitiative(ctx, initiativeID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, platform.NotFound("initiative")
		}
		return nil, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID {
		return nil, platform.NotFound("initiative")
	}
	scope, err := s.initiativeScope(ctx, q, row)
	if err != nil {
		return nil, err
	}
	if !p.Role.IsAdmin() && !authz.Visible(p, scope) {
		return nil, platform.NotFound("initiative")
	}

	rows, err := q.ListInitiativeUpdatesForInitiative(ctx, initiativeID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.InitiativeUpdate, 0, len(rows))
	for _, item := range rows {
		out = append(out, toInitiativeUpdate(item))
	}
	return out, nil
}

func (s *Service) GetInitiativeUpdate(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (model.InitiativeUpdate, error) {
	q := s.db.Queries()
	row, err := q.GetInitiativeUpdate(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return model.InitiativeUpdate{}, platform.NotFound("initiative update")
		}
		return model.InitiativeUpdate{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID {
		return model.InitiativeUpdate{}, platform.NotFound("initiative update")
	}
	initiative, err := q.GetInitiative(ctx, row.InitiativeID)
	if err != nil {
		if store.IsNotFound(err) {
			return model.InitiativeUpdate{}, platform.NotFound("initiative update")
		}
		return model.InitiativeUpdate{}, platform.Internal(err)
	}
	scope, err := s.initiativeScope(ctx, q, initiative)
	if err != nil {
		return model.InitiativeUpdate{}, err
	}
	if !p.Role.IsAdmin() && !authz.Visible(p, scope) {
		return model.InitiativeUpdate{}, platform.NotFound("initiative update")
	}
	return toInitiativeUpdate(row), nil
}

func toInitiativeUpdate(row store.InitiativeUpdate) model.InitiativeUpdate {
	return model.InitiativeUpdate{
		ID:           row.ID,
		WorkspaceID:  row.WorkspaceID,
		InitiativeID: row.InitiativeID,
		Health:       row.Health,
		Body:         row.Body,
		AuthorID:     row.AuthorID,
		EditedAt:     row.EditedAt,
		DeletedAt:    row.DeletedAt,
		CreatedAt:    row.CreatedAt,
		UpdatedAt:    row.UpdatedAt,
	}
}
