package graph

import (
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

func toCycleCalendarFeed(c model.CycleCalendarFeed) generated.CycleCalendarFeed {
	return generated.CycleCalendarFeed{
		ID:          c.ID,
		WorkspaceID: c.WorkspaceID,
		TeamID:      c.TeamID,
		UserID:      c.UserID,
		CreatedAt:   c.CreatedAt,
		UpdatedAt:   c.UpdatedAt,
	}
}
