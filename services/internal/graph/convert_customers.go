package graph

import (
	"fmt"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/graph/generated"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

func toCustomer(c model.Customer) (generated.Customer, error) {
	status, err := toCustomerStatus(c.Status)
	if err != nil {
		return generated.Customer{}, err
	}
	domains := c.Domains
	if domains == nil {
		domains = []string{}
	}
	return generated.Customer{
		ID:          c.ID,
		WorkspaceID: c.WorkspaceID,
		Name:        c.Name,
		Domains:     domains,
		Revenue:     intFromInt32(c.Revenue),
		Size:        intFromInt32(c.Size),
		Tier:        c.Tier,
		Status:      status,
		OwnerID:     c.OwnerID,
		LogoURL:     c.LogoURL,
		CreatorID:   c.CreatorID,
		SortOrder:   c.SortOrder,
		ArchivedAt:  c.ArchivedAt,
		DeletedAt:   c.DeletedAt,
		DeletedBy:   c.DeletedBy,
		CreatedAt:   c.CreatedAt,
		UpdatedAt:   c.UpdatedAt,
	}, nil
}

func toCustomerRequest(row model.CustomerRequest) generated.CustomerRequest {
	return generated.CustomerRequest{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		CustomerID:  row.CustomerID,
		IssueID:     row.IssueID,
		ProjectID:   row.ProjectID,
		Body:        row.Body,
		Important:   row.Important,
		CreatorID:   row.CreatorID,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func toCustomerStatus(v string) (generated.CustomerStatus, error) {
	switch v {
	case model.CustomerStatusActive:
		return generated.CustomerStatusActive, nil
	case model.CustomerStatusProspect:
		return generated.CustomerStatusProspect, nil
	case model.CustomerStatusChurned:
		return generated.CustomerStatusChurned, nil
	}
	return "", platform.Internal(fmt.Errorf("unknown customer status %q", v))
}

func fromCustomerStatus(s *generated.CustomerStatus) (string, error) {
	if s == nil {
		return "", nil
	}
	switch *s {
	case generated.CustomerStatusActive:
		return model.CustomerStatusActive, nil
	case generated.CustomerStatusProspect:
		return model.CustomerStatusProspect, nil
	case generated.CustomerStatusChurned:
		return model.CustomerStatusChurned, nil
	}
	return "", platform.Validation("status", "status is active, prospect or churned")
}

func fromCreateCustomerInput(in generated.CreateCustomerInput) (domain.CreateCustomerInput, error) {
	status, err := fromCustomerStatus(in.Status)
	if err != nil {
		return domain.CreateCustomerInput{}, err
	}
	logo := ""
	if in.LogoURL != nil {
		logo = *in.LogoURL
	}
	return domain.CreateCustomerInput{
		Name:    in.Name,
		Domains: in.Domains,
		Revenue: int32FromInt(in.Revenue),
		Size:    int32FromInt(in.Size),
		Tier:    in.Tier,
		Status:  status,
		OwnerID: in.OwnerID,
		LogoURL: logo,
	}, nil
}

func fromUpdateCustomerInput(in generated.UpdateCustomerInput) (domain.UpdateCustomerInput, error) {
	status, err := fromCustomerStatus(in.Status)
	if err != nil {
		return domain.UpdateCustomerInput{}, err
	}
	var statusPtr *string
	if in.Status != nil {
		statusPtr = &status
	}
	return domain.UpdateCustomerInput{
		ID:           in.ID,
		Name:         in.Name,
		Domains:      in.Domains,
		SetDomains:   in.Domains != nil,
		Revenue:      int32FromInt(in.Revenue),
		ClearRevenue: deref(in.ClearRevenue),
		Size:         int32FromInt(in.Size),
		ClearSize:    deref(in.ClearSize),
		Tier:         in.Tier,
		ClearTier:    deref(in.ClearTier),
		Status:       statusPtr,
		OwnerID:      in.OwnerID,
		ClearOwner:   deref(in.ClearOwner),
		LogoURL:      in.LogoURL,
	}, nil
}

func fromCreateCustomerRequestInput(in generated.CreateCustomerRequestInput) domain.CreateCustomerRequestInput {
	body := ""
	if in.Body != nil {
		body = *in.Body
	}
	return domain.CreateCustomerRequestInput{
		CustomerID: in.CustomerID,
		IssueID:    in.IssueID,
		ProjectID:  in.ProjectID,
		Body:       body,
		Important:  deref(in.Important),
	}
}

func fromUpdateCustomerRequestInput(in generated.UpdateCustomerRequestInput) domain.UpdateCustomerRequestInput {
	return domain.UpdateCustomerRequestInput{
		ID:            in.ID,
		Body:          in.Body,
		Important:     in.Important,
		CustomerID:    in.CustomerID,
		ClearCustomer: deref(in.ClearCustomer),
		IssueID:       in.IssueID,
		ProjectID:     in.ProjectID,
	}
}

func int32FromInt(v *int) *int32 {
	if v == nil {
		return nil
	}
	n := int32(*v)
	return &n
}

func intFromInt32(v *int32) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}
