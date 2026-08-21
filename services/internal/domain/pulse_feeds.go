package domain

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const (
	maxPulseFeedNameLength   = 64
	maxPulseFeedsPerUser     = 20
	maxPulseFeedProjectCount = 40
)

type CreatePulseFeedInput struct {
	Name       string
	ProjectIDs []uuid.UUID
}

type UpdatePulseFeedInput struct {
	ID         uuid.UUID
	Name       *string
	ProjectIDs []uuid.UUID
}

func (s *Service) CreatePulseFeed(
	ctx context.Context, p *authz.Principal, in CreatePulseFeedInput,
) (model.PulseFeed, int64, error) {
	if p.IsGuest() {
		return model.PulseFeed{}, 0, platform.Forbidden("pulseFeed")
	}
	name, err := pulseFeedName(in.Name)
	if err != nil {
		return model.PulseFeed{}, 0, err
	}

	var out model.PulseFeed
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		ids, err := s.pulseFeedProjects(ctx, q, p, in.ProjectIDs)
		if err != nil {
			return err
		}
		n, err := q.CountPulseFeedsForUser(ctx, store.CountPulseFeedsForUserParams{
			WorkspaceID: p.WorkspaceID,
			UserID:      p.UserID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		if n >= maxPulseFeedsPerUser {
			return platform.Validation("pulseFeed", "a person can keep at most 20 Pulse feeds")
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreatePulseFeed(ctx, store.CreatePulseFeedParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			UserID:      p.UserID,
			Name:        name,
			ProjectIds:  ids,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toPulseFeed(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "pulseFeed", EntityID: id, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) UpdatePulseFeed(
	ctx context.Context, p *authz.Principal, in UpdatePulseFeedInput,
) (model.PulseFeed, int64, error) {
	if p.IsGuest() {
		return model.PulseFeed{}, 0, platform.Forbidden("pulseFeed")
	}

	var out model.PulseFeed
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := s.requirePulseFeedOwner(ctx, q, p, in.ID)
		if err != nil {
			return err
		}
		name := existing.Name
		if in.Name != nil {
			name, err = pulseFeedName(*in.Name)
			if err != nil {
				return err
			}
		}
		ids := existing.ProjectIds
		if in.ProjectIDs != nil {
			ids, err = s.pulseFeedProjects(ctx, q, p, in.ProjectIDs)
			if err != nil {
				return err
			}
		}
		row, err := q.UpdatePulseFeed(ctx, store.UpdatePulseFeedParams{
			ID:         existing.ID,
			Name:       name,
			ProjectIds: ids,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("pulseFeed")
			}
			return platform.Internal(err)
		}
		out = toPulseFeed(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "pulseFeed", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeletePulseFeed(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (int64, error) {
	if p.IsGuest() {
		return 0, platform.Forbidden("pulseFeed")
	}
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := s.requirePulseFeedOwner(ctx, q, p, id)
		if err != nil {
			return err
		}
		if err := q.DeletePulseFeed(ctx, existing.ID); err != nil {
			return platform.Internal(err)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "pulseFeed", EntityID: id, Op: OpDelete,
			Scope: authz.UserScope(p.UserID),
		})
		return err
	})
	return version, err
}

func (s *Service) requirePulseFeedOwner(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.PulseFeed, error) {
	row, err := q.GetPulseFeedForUpdate(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.PulseFeed{}, platform.NotFound("pulseFeed")
		}
		return store.PulseFeed{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.UserID != p.UserID {
		return store.PulseFeed{}, platform.NotFound("pulseFeed")
	}
	return row, nil
}

func (s *Service) pulseFeedProjects(
	ctx context.Context, q *store.Queries, p *authz.Principal, ids []uuid.UUID,
) ([]uuid.UUID, error) {
	if len(ids) == 0 {
		return nil, platform.Validation("projectIds", "pick at least one project")
	}
	if len(ids) > maxPulseFeedProjectCount {
		return nil, platform.Validation("projectIds", "a feed can follow at most 40 projects")
	}
	seen := make(map[uuid.UUID]struct{}, len(ids))
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if _, dup := seen[id]; dup {
			continue
		}
		if _, err := s.requireProjectVisible(ctx, q, p, id); err != nil {
			return nil, err
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	if len(out) == 0 {
		return nil, platform.Validation("projectIds", "pick at least one project")
	}
	return out, nil
}

func pulseFeedName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", platform.Validation("name", "a feed needs a name")
	}
	if utf8.RuneCountInString(name) > maxPulseFeedNameLength {
		return "", platform.Validation("name", "a feed name is at most 64 characters")
	}
	return name, nil
}

func toPulseFeed(row store.PulseFeed) model.PulseFeed {
	ids := row.ProjectIds
	if ids == nil {
		ids = []uuid.UUID{}
	}
	return model.PulseFeed{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		UserID:      row.UserID,
		Name:        row.Name,
		ProjectIDs:  ids,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func pulseFeedFromStream(row store.PulseFeed) model.PulseFeed {
	return toPulseFeed(row)
}
