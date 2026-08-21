package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/fractional"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// MaxInitiativeNesting is the longest parent→child chain Linear allows (five initiatives).
const MaxInitiativeNesting = 5

func (s *Service) AddInitiativeRelation(
	ctx context.Context, p *authz.Principal, parentID, childID uuid.UUID,
) (model.InitiativeRelation, int64, error) {
	var out model.InitiativeRelation
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		rel, err := s.insertInitiativeRelation(ctx, q, p, parentID, childID)
		if err != nil {
			return err
		}
		out = rel
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiativeRelation", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) RemoveInitiativeRelation(
	ctx context.Context, p *authz.Principal, parentID, childID uuid.UUID,
) (uuid.UUID, int64, error) {
	var removed uuid.UUID
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, _, err := s.requireInitiativeWrite(ctx, q, p, parentID); err != nil {
			return err
		}
		if _, _, err := s.requireInitiativeWrite(ctx, q, p, childID); err != nil {
			return err
		}
		row, err := q.GetInitiativeRelationByPair(ctx, store.GetInitiativeRelationByPairParams{
			ParentInitiativeID: parentID,
			ChildInitiativeID:  childID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.Validation("childInitiativeId", "that initiative is not nested under this parent")
			}
			return platform.Internal(err)
		}
		if _, err := q.DeleteInitiativeRelation(ctx, row.ID); err != nil {
			return platform.Internal(err)
		}
		removed = row.ID
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiativeRelation", EntityID: row.ID, Op: OpDelete,
			Scope: authz.WorkspaceScope(),
		})
		return err
	})
	return removed, version, err
}

func (s *Service) insertInitiativeRelation(
	ctx context.Context, q *store.Queries, p *authz.Principal, parentID, childID uuid.UUID,
) (model.InitiativeRelation, error) {
	if parentID == childID {
		return model.InitiativeRelation{}, platform.Validation("childInitiativeId", "an initiative cannot nest under itself")
	}
	parent, _, err := s.requireInitiativeWrite(ctx, q, p, parentID)
	if err != nil {
		return model.InitiativeRelation{}, err
	}
	child, _, err := s.requireInitiativeWrite(ctx, q, p, childID)
	if err != nil {
		return model.InitiativeRelation{}, err
	}
	if parent.DeletedAt != nil || child.DeletedAt != nil {
		return model.InitiativeRelation{}, platform.NotFound("initiative")
	}

	rels, err := q.ListInitiativeRelationsInWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return model.InitiativeRelation{}, platform.Internal(err)
	}
	if err := checkInitiativeNesting(rels, parentID, childID); err != nil {
		return model.InitiativeRelation{}, err
	}

	sort, err := nextInitiativeRelationSort(ctx, q, parentID)
	if err != nil {
		return model.InitiativeRelation{}, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return model.InitiativeRelation{}, platform.Internal(err)
	}
	createdBy := p.UserID
	row, err := q.CreateInitiativeRelation(ctx, store.CreateInitiativeRelationParams{
		ID:                 id,
		WorkspaceID:        p.WorkspaceID,
		ParentInitiativeID: parentID,
		ChildInitiativeID:  childID,
		SortOrder:          sort,
		CreatedBy:          &createdBy,
	})
	if err != nil {
		if store.IsUniqueViolation(err, "initiative_relation_unique") {
			return model.InitiativeRelation{}, platform.Validation("childInitiativeId", "that nest already exists")
		}
		return model.InitiativeRelation{}, platform.Internal(err)
	}
	return toInitiativeRelation(row), nil
}

func nextInitiativeRelationSort(ctx context.Context, q *store.Queries, parentID uuid.UUID) (string, error) {
	last, err := q.LastInitiativeRelationSort(ctx, parentID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

func checkInitiativeNesting(rels []store.InitiativeRelation, parent, child uuid.UUID) error {
	childrenOf := map[uuid.UUID][]uuid.UUID{}
	parentsOf := map[uuid.UUID][]uuid.UUID{}
	for _, rel := range rels {
		childrenOf[rel.ParentInitiativeID] = append(childrenOf[rel.ParentInitiativeID], rel.ChildInitiativeID)
		parentsOf[rel.ChildInitiativeID] = append(parentsOf[rel.ChildInitiativeID], rel.ParentInitiativeID)
	}
	if reaches(childrenOf, child, parent) {
		return platform.Validation("childInitiativeId", "that nest would create a cycle")
	}
	depthParent := longestPath(parentsOf, parent)
	heightChild := longestPath(childrenOf, child)
	if depthParent+heightChild+2 > MaxInitiativeNesting {
		return platform.Validation("childInitiativeId", "initiatives nest at most five levels deep")
	}
	return nil
}

func reaches(edges map[uuid.UUID][]uuid.UUID, from, target uuid.UUID) bool {
	seen := map[uuid.UUID]bool{}
	var walk func(uuid.UUID) bool
	walk = func(id uuid.UUID) bool {
		if id == target {
			return true
		}
		if seen[id] {
			return false
		}
		seen[id] = true
		for _, next := range edges[id] {
			if walk(next) {
				return true
			}
		}
		return false
	}
	return walk(from)
}

func longestPath(edges map[uuid.UUID][]uuid.UUID, start uuid.UUID) int {
	seen := map[uuid.UUID]bool{}
	var walk func(uuid.UUID) int
	walk = func(id uuid.UUID) int {
		if seen[id] {
			return 0
		}
		seen[id] = true
		best := 0
		for _, next := range edges[id] {
			if n := 1 + walk(next); n > best {
				best = n
			}
		}
		seen[id] = false
		return best
	}
	return walk(start)
}

func toInitiativeRelation(row store.InitiativeRelation) model.InitiativeRelation {
	return model.InitiativeRelation{
		ID:                 row.ID,
		WorkspaceID:        row.WorkspaceID,
		ParentInitiativeID: row.ParentInitiativeID,
		ChildInitiativeID:  row.ChildInitiativeID,
		SortOrder:          row.SortOrder,
		CreatedBy:          row.CreatedBy,
		CreatedAt:          row.CreatedAt,
	}
}
