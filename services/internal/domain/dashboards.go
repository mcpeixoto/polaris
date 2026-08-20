package domain

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/fractional"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const maxDashboardNameLength = 256

type CreateDashboardInput struct {
	Name        string
	Description string
	TeamID      *uuid.UUID
	Private     bool
	Filter      json.RawMessage
}

type UpdateDashboardInput struct {
	ID          uuid.UUID
	Name        *string
	Description *string
	Filter      json.RawMessage
}

type CreateDashboardTileInput struct {
	DashboardID uuid.UUID
	Title       string
	Measure     string
	Slice       string
	Display     string
	Filter      json.RawMessage
}

type UpdateDashboardTileInput struct {
	ID      uuid.UUID
	Title   *string
	Measure *string
	Slice   *string
	Display *string
	Filter  json.RawMessage
}

func (s *Service) CreateDashboard(
	ctx context.Context, p *authz.Principal, in CreateDashboardInput,
) (model.Dashboard, int64, error) {
	if !authz.Can(p, authz.ActionProjectCreate) {
		return model.Dashboard{}, 0, platform.Forbidden("dashboard")
	}
	name, err := dashboardName(in.Name)
	if err != nil {
		return model.Dashboard{}, 0, err
	}
	if in.Private && in.TeamID != nil {
		return model.Dashboard{}, 0, platform.Validation("teamId", "a personal dashboard is not anchored to a team")
	}
	filterJSON, err := validateViewFilter(in.Filter)
	if err != nil {
		return model.Dashboard{}, 0, err
	}

	var out model.Dashboard
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		var ownerID *uuid.UUID
		var teamID *uuid.UUID
		scope := authz.WorkspaceScope()

		if in.Private {
			ownerID = &p.UserID
			scope = authz.UserScope(p.UserID)
		} else if in.TeamID != nil {
			team, err := s.requireTeamAccess(ctx, q, p, *in.TeamID, authz.ActionTeamViewManage)
			if err != nil {
				return err
			}
			teamID = &team.ID
			scope = authz.TeamScope(team.ID, team.Private)
		}

		pos, err := nextDashboardSort(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		creator := p.UserID
		row, err := q.CreateDashboard(ctx, store.CreateDashboardParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			TeamID:      teamID,
			OwnerID:     ownerID,
			Name:        name,
			Description: strings.TrimSpace(in.Description),
			Filter:      filterJSON,
			CreatorID:   &creator,
			SortOrder:   pos,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toDashboard(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "dashboard", EntityID: id, Op: OpUpsert,
			TeamID: scopeTeamID(scope, teamID), Scope: scope, Payload: out,
		})
		if err != nil {
			return err
		}

		defaults := []struct {
			title   string
			measure string
			slice   string
		}{
			{"Issues by assignee", model.DashboardMeasureCount, model.DashboardSliceAssignee},
			{"Effort by priority", model.DashboardMeasureEffort, model.DashboardSlicePriority},
		}
		tilePos := fractional.First()
		for i, def := range defaults {
			if i > 0 {
				tilePos = fractional.After(tilePos)
			}
			tileID, err := uuid.NewV7()
			if err != nil {
				return platform.Internal(err)
			}
			tile, err := q.CreateDashboardTile(ctx, store.CreateDashboardTileParams{
				ID:          tileID,
				WorkspaceID: p.WorkspaceID,
				DashboardID: id,
				Title:       def.title,
				Measure:     def.measure,
				Slice:       def.slice,
				Display:     model.DashboardDisplayChart,
				Filter:      json.RawMessage(`{}`),
				SortOrder:   tilePos,
			})
			if err != nil {
				return platform.Internal(err)
			}
			v, err := s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "dashboardTile", EntityID: tileID, Op: OpUpsert,
				TeamID: scopeTeamID(scope, teamID), Scope: scope, Payload: toDashboardTile(tile),
			})
			if err != nil {
				return err
			}
			version = v
		}
		return nil
	})
	return out, version, err
}

func (s *Service) UpdateDashboard(
	ctx context.Context, p *authz.Principal, in UpdateDashboardInput,
) (model.Dashboard, int64, error) {
	if in.Name == nil && in.Description == nil && in.Filter == nil {
		return model.Dashboard{}, 0, platform.Validation("input", "nothing to update")
	}
	if in.Name != nil {
		trimmed, err := dashboardName(*in.Name)
		if err != nil {
			return model.Dashboard{}, 0, err
		}
		in.Name = &trimmed
	}
	var filterJSON json.RawMessage
	if in.Filter != nil {
		var err error
		filterJSON, err = validateViewFilter(in.Filter)
		if err != nil {
			return model.Dashboard{}, 0, err
		}
	}
	if in.Description != nil {
		trimmed := strings.TrimSpace(*in.Description)
		in.Description = &trimmed
	}

	var out model.Dashboard
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := s.requireDashboardWrite(ctx, q, p, in.ID)
		if err != nil {
			return err
		}
		row, err := q.UpdateDashboard(ctx, store.UpdateDashboardParams{
			ID:          in.ID,
			Name:        in.Name,
			Description: in.Description,
			Filter:      filterJSON,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("dashboard")
			}
			return platform.Internal(err)
		}
		out = toDashboard(row)
		scope, err := scopeForDashboard(ctx, q, existing.TeamID, existing.OwnerID)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "dashboard", EntityID: in.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, existing.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) ArchiveDashboard(
	ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool,
) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := s.requireDashboardWrite(ctx, q, p, id)
		if err != nil {
			return err
		}
		if existing.DeletedAt != nil {
			return platform.NotFound("dashboard")
		}
		scope, err := scopeForDashboard(ctx, q, existing.TeamID, existing.OwnerID)
		if err != nil {
			return err
		}
		var payload any
		var op Op
		if archived {
			if err := q.ArchiveDashboard(ctx, id); err != nil {
				return platform.Internal(err)
			}
			row, err := q.GetDashboard(ctx, id)
			if err != nil {
				return platform.Internal(err)
			}
			payload = toDashboard(row)
			op = OpUpsert
		} else {
			row, err := q.UnarchiveDashboard(ctx, id)
			if err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("dashboard")
				}
				return platform.Internal(err)
			}
			payload = toDashboard(row)
			op = OpUpsert
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "dashboard", EntityID: id, Op: op,
			TeamID: scopeTeamID(scope, existing.TeamID), Scope: scope, Payload: payload,
		})
		return err
	})
	return version, err
}

func (s *Service) DeleteDashboard(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := s.requireDashboardWrite(ctx, q, p, id)
		if err != nil {
			return err
		}
		scope, err := scopeForDashboard(ctx, q, existing.TeamID, existing.OwnerID)
		if err != nil {
			return err
		}
		tiles, err := q.ListDashboardTiles(ctx, id)
		if err != nil {
			return platform.Internal(err)
		}
		if _, err := q.SoftDeleteDashboard(ctx, store.SoftDeleteDashboardParams{
			ID:        id,
			DeletedBy: &p.UserID,
		}); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("dashboard")
			}
			return platform.Internal(err)
		}
		for _, tile := range tiles {
			v, err := s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "dashboardTile", EntityID: tile.ID, Op: OpDelete,
				TeamID: scopeTeamID(scope, existing.TeamID), Scope: scope,
			})
			if err != nil {
				return err
			}
			version = v
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "dashboard", EntityID: id, Op: OpDelete,
			TeamID: scopeTeamID(scope, existing.TeamID), Scope: scope,
		})
		return err
	})
	return version, err
}

func (s *Service) CreateDashboardTile(
	ctx context.Context, p *authz.Principal, in CreateDashboardTileInput,
) (model.DashboardTile, int64, error) {
	measure, err := dashboardMeasure(in.Measure)
	if err != nil {
		return model.DashboardTile{}, 0, err
	}
	slice, err := dashboardSlice(in.Slice)
	if err != nil {
		return model.DashboardTile{}, 0, err
	}
	display, err := dashboardDisplay(in.Display)
	if err != nil {
		return model.DashboardTile{}, 0, err
	}
	filterJSON, err := validateViewFilter(in.Filter)
	if err != nil {
		return model.DashboardTile{}, 0, err
	}

	var out model.DashboardTile
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		dash, err := s.requireDashboardWrite(ctx, q, p, in.DashboardID)
		if err != nil {
			return err
		}
		if dash.ArchivedAt != nil {
			return platform.Validation("dashboardId", "cannot add a tile to an archived dashboard")
		}
		pos, err := nextDashboardTileSort(ctx, q, in.DashboardID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateDashboardTile(ctx, store.CreateDashboardTileParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			DashboardID: in.DashboardID,
			Title:       strings.TrimSpace(in.Title),
			Measure:     measure,
			Slice:       slice,
			Display:     display,
			Filter:      filterJSON,
			SortOrder:   pos,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toDashboardTile(row)
		scope, err := scopeForDashboard(ctx, q, dash.TeamID, dash.OwnerID)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "dashboardTile", EntityID: id, Op: OpUpsert,
			TeamID: scopeTeamID(scope, dash.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) UpdateDashboardTile(
	ctx context.Context, p *authz.Principal, in UpdateDashboardTileInput,
) (model.DashboardTile, int64, error) {
	if in.Title == nil && in.Measure == nil && in.Slice == nil && in.Display == nil && in.Filter == nil {
		return model.DashboardTile{}, 0, platform.Validation("input", "nothing to update")
	}
	var measure *string
	if in.Measure != nil {
		v, err := dashboardMeasure(*in.Measure)
		if err != nil {
			return model.DashboardTile{}, 0, err
		}
		measure = &v
	}
	var slice *string
	if in.Slice != nil {
		v, err := dashboardSlice(*in.Slice)
		if err != nil {
			return model.DashboardTile{}, 0, err
		}
		slice = &v
	}
	var display *string
	if in.Display != nil {
		v, err := dashboardDisplay(*in.Display)
		if err != nil {
			return model.DashboardTile{}, 0, err
		}
		display = &v
	}
	var filterJSON json.RawMessage
	if in.Filter != nil {
		var err error
		filterJSON, err = validateViewFilter(in.Filter)
		if err != nil {
			return model.DashboardTile{}, 0, err
		}
	}
	if in.Title != nil {
		trimmed := strings.TrimSpace(*in.Title)
		in.Title = &trimmed
	}

	var out model.DashboardTile
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetDashboardTileForUpdate(ctx, in.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("dashboardTile")
			}
			return platform.Internal(err)
		}
		dash, err := s.requireDashboardWrite(ctx, q, p, existing.DashboardID)
		if err != nil {
			return err
		}
		row, err := q.UpdateDashboardTile(ctx, store.UpdateDashboardTileParams{
			ID:      in.ID,
			Title:   in.Title,
			Measure: measure,
			Slice:   slice,
			Display: display,
			Filter:  filterJSON,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toDashboardTile(row)
		scope, err := scopeForDashboard(ctx, q, dash.TeamID, dash.OwnerID)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "dashboardTile", EntityID: in.ID, Op: OpUpsert,
			TeamID: scopeTeamID(scope, dash.TeamID), Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteDashboardTile(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetDashboardTileForUpdate(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("dashboardTile")
			}
			return platform.Internal(err)
		}
		dash, err := s.requireDashboardWrite(ctx, q, p, existing.DashboardID)
		if err != nil {
			return err
		}
		if _, err := q.DeleteDashboardTile(ctx, id); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("dashboardTile")
			}
			return platform.Internal(err)
		}
		scope, err := scopeForDashboard(ctx, q, dash.TeamID, dash.OwnerID)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "dashboardTile", EntityID: id, Op: OpDelete,
			TeamID: scopeTeamID(scope, dash.TeamID), Scope: scope,
		})
		return err
	})
	return version, err
}

func (s *Service) requireDashboardWrite(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.Dashboard, error) {
	if !authz.Can(p, authz.ActionProjectCreate) {
		return store.Dashboard{}, platform.Forbidden("dashboard")
	}
	row, err := q.GetDashboardForUpdate(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.Dashboard{}, platform.NotFound("dashboard")
		}
		return store.Dashboard{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.DeletedAt != nil {
		return store.Dashboard{}, platform.NotFound("dashboard")
	}
	scope, err := scopeForDashboard(ctx, q, row.TeamID, row.OwnerID)
	if err != nil {
		return store.Dashboard{}, err
	}
	if !authz.Visible(p, scope) {
		return store.Dashboard{}, platform.NotFound("dashboard")
	}
	return row, nil
}

func scopeForDashboard(
	ctx context.Context, q *store.Queries, teamID, ownerID *uuid.UUID,
) (authz.Scope, error) {
	switch {
	case ownerID != nil:
		return authz.UserScope(*ownerID), nil
	case teamID != nil:
		team, err := q.GetTeam(ctx, *teamID)
		if err != nil {
			if store.IsNotFound(err) {
				return authz.Scope{}, platform.NotFound("team")
			}
			return authz.Scope{}, platform.Internal(err)
		}
		return authz.TeamScope(team.ID, team.Private), nil
	default:
		return authz.WorkspaceScope(), nil
	}
}

func dashboardName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", platform.Validation("name", "a dashboard needs a name")
	}
	if len(trimmed) > maxDashboardNameLength {
		return "", platform.Validation("name", "that name is too long")
	}
	return trimmed, nil
}

func dashboardMeasure(v string) (string, error) {
	switch v {
	case "", model.DashboardMeasureCount:
		return model.DashboardMeasureCount, nil
	case model.DashboardMeasureEffort, model.DashboardMeasureCycleTime,
		model.DashboardMeasureLeadTime, model.DashboardMeasureIssueAge, model.DashboardMeasureBurnUp:
		return v, nil
	}
	return "", platform.Validation("measure", "unknown insight measure")
}

func dashboardSlice(v string) (string, error) {
	switch v {
	case "", model.DashboardSliceAssignee:
		return model.DashboardSliceAssignee, nil
	case model.DashboardSlicePriority, model.DashboardSliceStateCategory,
		model.DashboardSliceTeam, model.DashboardSliceProject, model.DashboardSliceLabel:
		return v, nil
	}
	return "", platform.Validation("slice", "unknown insight slice")
}

func dashboardDisplay(v string) (string, error) {
	switch v {
	case "", model.DashboardDisplayChart:
		return model.DashboardDisplayChart, nil
	case model.DashboardDisplayTable, model.DashboardDisplayMetric:
		return v, nil
	}
	return "", platform.Validation("display", "display is chart, table or metric")
}

func nextDashboardSort(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) (string, error) {
	last, err := q.LastDashboardSortOrder(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

func nextDashboardTileSort(ctx context.Context, q *store.Queries, dashboardID uuid.UUID) (string, error) {
	last, err := q.LastDashboardTileSortOrder(ctx, dashboardID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

func toDashboard(row store.Dashboard) model.Dashboard {
	filter := row.Filter
	if len(filter) == 0 {
		filter = json.RawMessage(`{}`)
	}
	return model.Dashboard{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		TeamID:      row.TeamID,
		OwnerID:     row.OwnerID,
		Name:        row.Name,
		Description: row.Description,
		Filter:      filter,
		CreatorID:   row.CreatorID,
		SortOrder:   row.SortOrder,
		ArchivedAt:  row.ArchivedAt,
		DeletedAt:   row.DeletedAt,
		DeletedBy:   row.DeletedBy,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func toDashboardTile(row store.DashboardTile) model.DashboardTile {
	filter := row.Filter
	if len(filter) == 0 {
		filter = json.RawMessage(`{}`)
	}
	return model.DashboardTile{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		DashboardID: row.DashboardID,
		Title:       row.Title,
		Measure:     row.Measure,
		Slice:       row.Slice,
		Display:     row.Display,
		Filter:      filter,
		SortOrder:   row.SortOrder,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}
