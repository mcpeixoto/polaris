package graph

import (
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

func toImportJob(j model.ImportJob) generated.ImportJob {
	progress := make([]generated.ImportProgress, 0, len(j.Progress))
	for _, p := range j.Progress {
		progress = append(progress, generated.ImportProgress{Entity: p.Entity, Done: p.Done, Total: p.Total})
	}
	return generated.ImportJob{
		ID:         j.ID,
		Source:     j.Source,
		Status:     j.Status,
		Progress:   progress,
		Error:      j.Error,
		CreatedAt:  j.CreatedAt,
		StartedAt:  j.StartedAt,
		FinishedAt: j.FinishedAt,
	}
}
