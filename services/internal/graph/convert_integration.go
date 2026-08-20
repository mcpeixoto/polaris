package graph

import (
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

func toIntegrationSubmission(s model.IntegrationSubmission) generated.IntegrationSubmission {
	return generated.IntegrationSubmission{
		ID:          s.ID,
		WorkspaceID: s.WorkspaceID,
		SubmittedBy: s.SubmittedBy,
		Name:        s.Name,
		Website:     s.Website,
		Summary:     s.Summary,
		CreatedAt:   s.CreatedAt,
		UpdatedAt:   s.UpdatedAt,
	}
}

func toIntegrationSubmissions(rows []model.IntegrationSubmission) []generated.IntegrationSubmission {
	out := make([]generated.IntegrationSubmission, 0, len(rows))
	for _, row := range rows {
		out = append(out, toIntegrationSubmission(row))
	}
	return out
}
