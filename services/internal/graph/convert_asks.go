package graph

import (
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
)

func toAskForm(row model.AskForm) generated.AskForm {
	return generated.AskForm{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		TeamID:      row.TeamID,
		Name:        row.Name,
		Description: row.Description,
		Token:       row.Token,
		CreatorID:   row.CreatorID,
		ArchivedAt:  row.ArchivedAt,
		DeletedAt:   row.DeletedAt,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func fromCreateAskFormInput(in generated.CreateAskFormInput) domain.CreateAskFormInput {
	desc := ""
	if in.Description != nil {
		desc = *in.Description
	}
	return domain.CreateAskFormInput{
		TeamID:      in.TeamID,
		Name:        in.Name,
		Description: desc,
	}
}

func fromUpdateAskFormInput(in generated.UpdateAskFormInput) domain.UpdateAskFormInput {
	return domain.UpdateAskFormInput{
		ID:          in.ID,
		Name:        in.Name,
		Description: in.Description,
	}
}
