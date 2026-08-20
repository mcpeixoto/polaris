package graph

import (
	"fmt"
	"strings"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

func toDashboard(row model.Dashboard) generated.Dashboard {
	return generated.Dashboard{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		TeamID:      row.TeamID,
		OwnerID:     row.OwnerID,
		Name:        row.Name,
		Description: row.Description,
		Filter:      jsonOrEmptyObject(row.Filter),
		CreatorID:   row.CreatorID,
		SortOrder:   row.SortOrder,
		ArchivedAt:  row.ArchivedAt,
		DeletedAt:   row.DeletedAt,
		DeletedBy:   row.DeletedBy,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func toDashboardTile(row model.DashboardTile) (generated.DashboardTile, error) {
	measure, err := toDashboardMeasure(row.Measure)
	if err != nil {
		return generated.DashboardTile{}, err
	}
	slice, err := toDashboardSlice(row.Slice)
	if err != nil {
		return generated.DashboardTile{}, err
	}
	display, err := toDashboardDisplay(row.Display)
	if err != nil {
		return generated.DashboardTile{}, err
	}
	return generated.DashboardTile{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		DashboardID: row.DashboardID,
		Title:       row.Title,
		Measure:     measure,
		Slice:       slice,
		Display:     display,
		Filter:      jsonOrEmptyObject(row.Filter),
		SortOrder:   row.SortOrder,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}, nil
}

func toDashboardMeasure(v string) (generated.DashboardMeasure, error) {
	out := generated.DashboardMeasure(strings.ToUpper(v))
	if !out.IsValid() {
		return "", platform.Internal(fmt.Errorf("unknown dashboard measure %q", v))
	}
	return out, nil
}

func toDashboardSlice(v string) (generated.DashboardSlice, error) {
	out := generated.DashboardSlice(strings.ToUpper(v))
	if !out.IsValid() {
		return "", platform.Internal(fmt.Errorf("unknown dashboard slice %q", v))
	}
	return out, nil
}

func toDashboardDisplay(v string) (generated.DashboardTileDisplay, error) {
	out := generated.DashboardTileDisplay(strings.ToUpper(v))
	if !out.IsValid() {
		return "", platform.Internal(fmt.Errorf("unknown dashboard display %q", v))
	}
	return out, nil
}

func fromCreateDashboardInput(in generated.CreateDashboardInput) domain.CreateDashboardInput {
	desc := ""
	if in.Description != nil {
		desc = *in.Description
	}
	return domain.CreateDashboardInput{
		Name:        in.Name,
		Description: desc,
		TeamID:      in.TeamID,
		Private:     deref(in.Private),
		Filter:      in.Filter,
	}
}

func fromUpdateDashboardInput(in generated.UpdateDashboardInput) domain.UpdateDashboardInput {
	return domain.UpdateDashboardInput{
		ID:          in.ID,
		Name:        in.Name,
		Description: in.Description,
		Filter:      in.Filter,
	}
}

func fromCreateDashboardTileInput(in generated.CreateDashboardTileInput) domain.CreateDashboardTileInput {
	title := ""
	if in.Title != nil {
		title = *in.Title
	}
	return domain.CreateDashboardTileInput{
		DashboardID: in.DashboardID,
		Title:       title,
		Measure:     lowerEnum(in.Measure),
		Slice:       lowerEnum(in.Slice),
		Display:     lowerEnum(in.Display),
		Filter:      in.Filter,
	}
}

func fromUpdateDashboardTileInput(in generated.UpdateDashboardTileInput) domain.UpdateDashboardTileInput {
	var measure *string
	if in.Measure != nil {
		v := strings.ToLower(string(*in.Measure))
		measure = &v
	}
	var slice *string
	if in.Slice != nil {
		v := strings.ToLower(string(*in.Slice))
		slice = &v
	}
	var display *string
	if in.Display != nil {
		v := strings.ToLower(string(*in.Display))
		display = &v
	}
	return domain.UpdateDashboardTileInput{
		ID:      in.ID,
		Title:   in.Title,
		Measure: measure,
		Slice:   slice,
		Display: display,
		Filter:  in.Filter,
	}
}

func lowerEnum[T ~string](v *T) string {
	if v == nil {
		return ""
	}
	return strings.ToLower(string(*v))
}
