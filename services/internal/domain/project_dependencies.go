package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// AddProjectDependency records that blocking must finish before blocked may start.
func (s *Service) AddProjectDependency(
	ctx context.Context, p *authz.Principal, blockingProjectID, blockedProjectID uuid.UUID,
) (model.ProjectDependency, int64, error) {
	if blockingProjectID == blockedProjectID {
		return model.ProjectDependency{}, 0, platform.Validation("blockedProjectId",
			"a project cannot depend on itself")
	}

	var out model.ProjectDependency
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, _, err := s.requireProjectWrite(ctx, q, p, blockingProjectID, authz.ActionProjectUpdate); err != nil {
			return err
		}
		if _, _, err := s.requireProjectWrite(ctx, q, p, blockedProjectID, authz.ActionProjectUpdate); err != nil {
			return err
		}

		cycle, err := s.wouldCreateProjectDependencyCycle(ctx, q, blockingProjectID, blockedProjectID)
		if err != nil {
			return err
		}
		if cycle {
			return platform.Validation("blockedProjectId", "that dependency would create a cycle")
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateProjectDependency(ctx, store.CreateProjectDependencyParams{
			ID:                 id,
			WorkspaceID:        p.WorkspaceID,
			BlockingProjectID:  blockingProjectID,
			BlockedProjectID:   blockedProjectID,
		})
		if err != nil {
			if store.IsUniqueViolation(err, "project_dependency_unique") {
				return platform.Validation("blockedProjectId", "these projects are already linked that way")
			}
			return platform.Internal(err)
		}
		out = toProjectDependency(row)

		depScope, err := s.dependencyScope(ctx, q, blockingProjectID, blockedProjectID)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectDependency", EntityID: id, Op: OpUpsert,
			Scope: depScope, Payload: out,
		})
		return err
	})
	if err != nil {
		return model.ProjectDependency{}, 0, err
	}
	return out, version, nil
}

func (s *Service) RemoveProjectDependency(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (uuid.UUID, int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.GetProjectDependency(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("project dependency")
			}
			return platform.Internal(err)
		}
		if row.WorkspaceID != p.WorkspaceID {
			return platform.NotFound("project dependency")
		}
		if !s.canSeeDependency(ctx, q, p, row) {
			return platform.NotFound("project dependency")
		}
		if _, _, err := s.requireProjectWrite(ctx, q, p, row.BlockingProjectID, authz.ActionProjectUpdate); err != nil {
			return err
		}

		if _, err := q.DeleteProjectDependency(ctx, id); err != nil {
			return platform.Internal(err)
		}

		depScope, err := s.dependencyScope(ctx, q, row.BlockingProjectID, row.BlockedProjectID)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectDependency", EntityID: id, Op: OpDelete, Scope: depScope,
		})
		return err
	})
	return id, version, err
}

func (s *Service) ListProjectDependenciesBlocking(
	ctx context.Context, p *authz.Principal, projectID uuid.UUID,
) ([]model.ProjectDependency, error) {
	if err := s.requireProjectVisibleRead(ctx, p, projectID); err != nil {
		return nil, err
	}
	rows, err := s.db.Queries().ListProjectDependenciesBlocking(ctx, projectID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	return toProjectDependencies(rows), nil
}

func (s *Service) ListProjectDependenciesBlockedBy(
	ctx context.Context, p *authz.Principal, projectID uuid.UUID,
) ([]model.ProjectDependency, error) {
	if err := s.requireProjectVisibleRead(ctx, p, projectID); err != nil {
		return nil, err
	}
	rows, err := s.db.Queries().ListProjectDependenciesBlockedBy(ctx, projectID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	return toProjectDependencies(rows), nil
}

func (s *Service) wouldCreateProjectDependencyCycle(
	ctx context.Context, q *store.Queries, blocking, blocked uuid.UUID,
) (bool, error) {
	visited := map[uuid.UUID]bool{blocked: true}
	queue := []uuid.UUID{blocked}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		rows, err := q.ListProjectDependenciesBlocking(ctx, cur)
		if err != nil {
			return false, platform.Internal(err)
		}
		for _, row := range rows {
			next := row.BlockedProjectID
			if next == blocking {
				return true, nil
			}
			if !visited[next] {
				visited[next] = true
				queue = append(queue, next)
			}
		}
	}
	return false, nil
}

func (s *Service) dependencyScope(
	ctx context.Context, q *store.Queries, blockingID, blockedID uuid.UUID,
) (authz.Scope, error) {
	blockingTeams, err := q.ListProjectTeamIDs(ctx, blockingID)
	if err != nil {
		return authz.Scope{}, platform.Internal(err)
	}
	blockedTeams, err := q.ListProjectTeamIDs(ctx, blockedID)
	if err != nil {
		return authz.Scope{}, platform.Internal(err)
	}
	teamIDs := append([]uuid.UUID{}, blockingTeams...)
	for _, id := range blockedTeams {
		if !containsUUID(teamIDs, id) {
			teamIDs = append(teamIDs, id)
		}
	}
	return authz.ProjectScope(teamIDs), nil
}

func (s *Service) canSeeDependency(
	ctx context.Context, q *store.Queries, p *authz.Principal, row store.ProjectDependency,
) bool {
	if p.Role.IsAdmin() {
		return true
	}
	blockingScope, err := s.projectScope(ctx, q, row.BlockingProjectID)
	if err != nil {
		return false
	}
	if authz.Visible(p, blockingScope) {
		return true
	}
	blockedScope, err := s.projectScope(ctx, q, row.BlockedProjectID)
	if err != nil {
		return false
	}
	return authz.Visible(p, blockedScope)
}

func (s *Service) requireProjectVisible(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.Project, error) {
	row, err := q.GetProject(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.Project{}, platform.NotFound("project")
		}
		return store.Project{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.DeletedAt != nil {
		return store.Project{}, platform.NotFound("project")
	}
	scope, err := s.projectScope(ctx, q, id)
	if err != nil {
		return store.Project{}, err
	}
	if !p.Role.IsAdmin() && !authz.Visible(p, scope) {
		return store.Project{}, platform.NotFound("project")
	}
	return row, nil
}

func (s *Service) requireProjectVisibleRead(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) error {
	_, err := s.requireProjectVisible(ctx, s.db.Queries(), p, id)
	return err
}

func containsUUID(haystack []uuid.UUID, needle uuid.UUID) bool {
	for _, id := range haystack {
		if id == needle {
			return true
		}
	}
	return false
}

func toProjectDependency(row store.ProjectDependency) model.ProjectDependency {
	return model.ProjectDependency{
		ID:                row.ID,
		WorkspaceID:       row.WorkspaceID,
		BlockingProjectID: row.BlockingProjectID,
		BlockedProjectID:  row.BlockedProjectID,
		CreatedAt:         row.CreatedAt,
	}
}

func toProjectDependencies(rows []store.ProjectDependency) []model.ProjectDependency {
	out := make([]model.ProjectDependency, 0, len(rows))
	for _, row := range rows {
		out = append(out, toProjectDependency(row))
	}
	return out
}
