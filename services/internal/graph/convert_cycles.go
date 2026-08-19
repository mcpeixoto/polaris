package graph

import (
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

func toCycle(c model.Cycle) generated.Cycle {
	return generated.Cycle{
		ID:          c.ID,
		WorkspaceID: c.WorkspaceID,
		TeamID:      c.TeamID,
		Number:      c.Number,
		Name:        c.Name,
		Description: c.Description,
		StartsAt:    c.StartsAt,
		EndsAt:      c.EndsAt,
		CompletedAt: c.CompletedAt,
		ArchivedAt:  c.ArchivedAt,
		CreatedAt:   c.CreatedAt,
		UpdatedAt:   c.UpdatedAt,
	}
}

func toCycles(rows []model.Cycle) []generated.Cycle {
	out := make([]generated.Cycle, 0, len(rows))
	for _, c := range rows {
		out = append(out, toCycle(c))
	}
	return out
}
