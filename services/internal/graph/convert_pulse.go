package graph

import (
	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

func toPulseFeed(row model.PulseFeed) generated.PulseFeed {
	ids := row.ProjectIDs
	if ids == nil {
		ids = []uuid.UUID{}
	}
	return generated.PulseFeed{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		UserID:      row.UserID,
		Name:        row.Name,
		ProjectIds:  ids,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func fromCreatePulseFeedInput(in generated.CreatePulseFeedInput) domain.CreatePulseFeedInput {
	return domain.CreatePulseFeedInput{
		Name:       in.Name,
		ProjectIDs: in.ProjectIds,
	}
}

func fromUpdatePulseFeedInput(in generated.UpdatePulseFeedInput) domain.UpdatePulseFeedInput {
	return domain.UpdatePulseFeedInput{
		ID:         in.ID,
		Name:       in.Name,
		ProjectIDs: in.ProjectIds,
	}
}
