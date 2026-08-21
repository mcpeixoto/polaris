package domain

import (
	"context"
	"net/url"
	"regexp"
	"strings"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/fractional"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

const maxCustomerRequestBody = 1 << 16 // 64 KiB

var domainName = regexp.MustCompile(`(?i)^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$`)

func validCustomerStatus(s string) bool {
	switch s {
	case model.CustomerStatusActive, model.CustomerStatusProspect, model.CustomerStatusChurned:
		return true
	}
	return false
}

type CreateCustomerInput struct {
	Name    string
	Domains []string
	Revenue *int32
	Size    *int32
	Tier    *string
	Status  string
	OwnerID *uuid.UUID
	LogoURL string
}

type UpdateCustomerInput struct {
	ID           uuid.UUID
	Name         *string
	Domains      []string
	SetDomains   bool
	Revenue      *int32
	ClearRevenue bool
	Size         *int32
	ClearSize    bool
	Tier         *string
	ClearTier    bool
	Status       *string
	OwnerID      *uuid.UUID
	ClearOwner   bool
	LogoURL      *string
}

type CreateCustomerRequestInput struct {
	CustomerID *uuid.UUID
	IssueID    *uuid.UUID
	ProjectID  *uuid.UUID
	Body       string
	Important  bool
}

type UpdateCustomerRequestInput struct {
	ID            uuid.UUID
	Body          *string
	Important     *bool
	CustomerID    *uuid.UUID
	ClearCustomer bool
	IssueID       *uuid.UUID
	ProjectID     *uuid.UUID
}

func (s *Service) CreateCustomer(
	ctx context.Context, p *authz.Principal, in CreateCustomerInput,
) (model.Customer, int64, error) {
	if !authz.Can(p, authz.ActionProjectCreate) {
		return model.Customer{}, 0, platform.Forbidden("customer")
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return model.Customer{}, 0, platform.Validation("name", "a customer needs a name")
	}
	status := in.Status
	if status == "" {
		status = model.CustomerStatusActive
	}
	if !validCustomerStatus(status) {
		return model.Customer{}, 0, platform.Validation("status", "status is active, prospect or churned")
	}
	if err := validateRevenueSize(in.Revenue, in.Size); err != nil {
		return model.Customer{}, 0, err
	}
	domains, err := normalizeDomains(in.Domains)
	if err != nil {
		return model.Customer{}, 0, err
	}
	tier := trimOptionalString(in.Tier)
	logo := strings.TrimSpace(in.LogoURL)

	var out model.Customer
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if err := requireCustomerRequestsEnabled(ctx, q, p.WorkspaceID); err != nil {
			return err
		}
		if in.OwnerID != nil {
			if _, err := q.GetUser(ctx, *in.OwnerID); err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("user")
				}
				return platform.Internal(err)
			}
		}
		pos, err := nextCustomerSort(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		creator := p.UserID
		row, err := q.CreateCustomer(ctx, store.CreateCustomerParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			Name:        name,
			Domains:     domains,
			Revenue:     in.Revenue,
			Size:        in.Size,
			Tier:        tier,
			Status:      status,
			OwnerID:     in.OwnerID,
			LogoUrl:     logo,
			CreatorID:   &creator,
			SortOrder:   pos,
		})
		if err != nil {
			return platform.Internal(err)
		}
		if err := replaceCustomerDomains(ctx, q, p.WorkspaceID, id, domains); err != nil {
			return err
		}
		out = toCustomer(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "customer", EntityID: id, Op: OpUpsert, Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) UpdateCustomer(
	ctx context.Context, p *authz.Principal, in UpdateCustomerInput,
) (model.Customer, int64, error) {
	if in.Name == nil && !in.SetDomains && in.Revenue == nil && !in.ClearRevenue &&
		in.Size == nil && !in.ClearSize && in.Tier == nil && !in.ClearTier &&
		in.Status == nil && in.OwnerID == nil && !in.ClearOwner && in.LogoURL == nil {
		return model.Customer{}, 0, platform.Validation("input", "nothing to update")
	}
	if in.Name != nil {
		trimmed := strings.TrimSpace(*in.Name)
		if trimmed == "" {
			return model.Customer{}, 0, platform.Validation("name", "a customer needs a name")
		}
		in.Name = &trimmed
	}
	if in.Status != nil && !validCustomerStatus(*in.Status) {
		return model.Customer{}, 0, platform.Validation("status", "status is active, prospect or churned")
	}
	if err := validateRevenueSize(in.Revenue, in.Size); err != nil {
		return model.Customer{}, 0, err
	}
	var domains []string
	if in.SetDomains {
		var err error
		domains, err = normalizeDomains(in.Domains)
		if err != nil {
			return model.Customer{}, 0, err
		}
	}
	if in.LogoURL != nil {
		trimmed := strings.TrimSpace(*in.LogoURL)
		in.LogoURL = &trimmed
	}
	if in.Tier != nil {
		in.Tier = trimOptionalString(in.Tier)
	}

	var out model.Customer
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if err := requireCustomerRequestsEnabled(ctx, q, p.WorkspaceID); err != nil {
			return err
		}
		existing, err := s.requireCustomerWrite(ctx, q, p, in.ID)
		if err != nil {
			return err
		}
		if existing.DeletedAt != nil {
			return platform.NotFound("customer")
		}
		if in.OwnerID != nil {
			if _, err := q.GetUser(ctx, *in.OwnerID); err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("user")
				}
				return platform.Internal(err)
			}
		}
		params := store.UpdateCustomerParams{
			ID:           in.ID,
			Name:         in.Name,
			Status:       in.Status,
			LogoUrl:      in.LogoURL,
			Revenue:      in.Revenue,
			ClearRevenue: in.ClearRevenue,
			Size:         in.Size,
			ClearSize:    in.ClearSize,
			Tier:         in.Tier,
			ClearTier:    in.ClearTier,
			OwnerID:      in.OwnerID,
			ClearOwner:   in.ClearOwner,
			SetDomains:   in.SetDomains,
			Domains:      domains,
		}
		row, err := q.UpdateCustomer(ctx, params)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("customer")
			}
			return platform.Internal(err)
		}
		if in.SetDomains {
			if err := replaceCustomerDomains(ctx, q, p.WorkspaceID, in.ID, domains); err != nil {
				return err
			}
		}
		out = toCustomer(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "customer", EntityID: in.ID, Op: OpUpsert, Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) ArchiveCustomer(
	ctx context.Context, p *authz.Principal, id uuid.UUID, archived bool,
) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := s.requireCustomerWrite(ctx, q, p, id)
		if err != nil {
			return err
		}
		if existing.DeletedAt != nil {
			return platform.NotFound("customer")
		}
		op := OpUpsert
		var payload model.Customer
		if archived {
			op = OpDelete
			if err := q.ArchiveCustomer(ctx, id); err != nil {
				return platform.Internal(err)
			}
			payload = toCustomer(existing)
		} else {
			row, err := q.UnarchiveCustomer(ctx, id)
			if err != nil {
				if store.IsNotFound(err) {
					return platform.NotFound("customer")
				}
				return platform.Internal(err)
			}
			payload = toCustomer(row)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "customer", EntityID: id, Op: op, Scope: authz.WorkspaceScope(), Payload: payload,
		})
		return err
	})
	return version, err
}

// MergeCustomers folds source into survivor. Domains and requests move; empty survivor
// attributes fill from the source; the source is archived.
func (s *Service) MergeCustomers(
	ctx context.Context, p *authz.Principal, sourceID, intoID uuid.UUID,
) (model.Customer, int64, error) {
	if sourceID == intoID {
		return model.Customer{}, 0, platform.Validation("intoId", "a customer cannot merge into itself")
	}

	var out model.Customer
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if err := requireCustomerRequestsEnabled(ctx, q, p.WorkspaceID); err != nil {
			return err
		}
		first, second := sourceID, intoID
		if first.String() > second.String() {
			first, second = second, first
		}
		if _, err := q.GetCustomerForUpdate(ctx, first); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("customer")
			}
			return platform.Internal(err)
		}
		if _, err := q.GetCustomerForUpdate(ctx, second); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("customer")
			}
			return platform.Internal(err)
		}

		source, err := s.requireCustomerWrite(ctx, q, p, sourceID)
		if err != nil {
			return err
		}
		into, err := s.requireCustomerWrite(ctx, q, p, intoID)
		if err != nil {
			return err
		}
		if source.DeletedAt != nil || source.ArchivedAt != nil {
			return platform.NotFound("customer")
		}
		if into.DeletedAt != nil || into.ArchivedAt != nil {
			return platform.NotFound("customer")
		}

		domains := unionDomains(into.Domains, source.Domains)
		if err := q.DeleteCustomerDomains(ctx, sourceID); err != nil {
			return platform.Internal(err)
		}
		if err := replaceCustomerDomains(ctx, q, p.WorkspaceID, intoID, domains); err != nil {
			return err
		}

		moved, err := q.RetargetCustomerRequests(ctx, store.RetargetCustomerRequestsParams{
			IntoID:   &intoID,
			SourceID: &sourceID,
		})
		if err != nil {
			return platform.Internal(err)
		}

		revenue, clearRevenue := coalesceInt32(into.Revenue, source.Revenue)
		size, clearSize := coalesceInt32(into.Size, source.Size)
		tier, clearTier := coalesceString(into.Tier, source.Tier)
		ownerID, clearOwner := coalesceUUID(into.OwnerID, source.OwnerID)
		logoURL := into.LogoUrl
		if strings.TrimSpace(logoURL) == "" {
			logoURL = source.LogoUrl
		}

		row, err := q.UpdateCustomer(ctx, store.UpdateCustomerParams{
			ID:           intoID,
			SetDomains:   true,
			Domains:      domains,
			Revenue:      revenue,
			ClearRevenue: clearRevenue,
			Size:         size,
			ClearSize:    clearSize,
			Tier:         tier,
			ClearTier:    clearTier,
			OwnerID:      ownerID,
			ClearOwner:   clearOwner,
			LogoUrl:      &logoURL,
		})
		if err != nil {
			return platform.Internal(err)
		}

		for _, request := range moved {
			payload := toCustomerRequest(request)
			scope, err := s.customerRequestScope(ctx, q, request)
			if err != nil {
				return err
			}
			if _, err := s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "customerRequest", EntityID: request.ID, Op: OpUpsert,
				Scope: scope, Payload: payload,
			}); err != nil {
				return err
			}
		}

		if err := q.ArchiveCustomer(ctx, sourceID); err != nil {
			return platform.Internal(err)
		}
		if _, err := s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "customer", EntityID: sourceID, Op: OpDelete,
			Scope: authz.WorkspaceScope(), Payload: toCustomer(source),
		}); err != nil {
			return err
		}

		out = toCustomer(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "customer", EntityID: intoID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteCustomer(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := s.requireCustomerWrite(ctx, q, p, id)
		if err != nil {
			return err
		}
		if existing.DeletedAt != nil {
			return platform.NotFound("customer")
		}
		requestIDs, err := q.ListCustomerRequestIDsForCustomer(ctx, &id)
		if err != nil {
			return platform.Internal(err)
		}
		for _, requestID := range requestIDs {
			row, err := q.DeleteCustomerRequest(ctx, requestID)
			if err != nil {
				return platform.Internal(err)
			}
			payload := toCustomerRequest(row)
			scope, err := s.customerRequestScope(ctx, q, row)
			if err != nil {
				return err
			}
			if _, err := s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "customerRequest", EntityID: requestID, Op: OpDelete, Scope: scope, Payload: payload,
			}); err != nil {
				return err
			}
		}
		row, err := q.SoftDeleteCustomer(ctx, store.SoftDeleteCustomerParams{
			ID: id, DeletedBy: &p.UserID,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("customer")
			}
			return platform.Internal(err)
		}
		payload := toCustomer(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "customer", EntityID: id, Op: OpDelete, Scope: authz.WorkspaceScope(), Payload: payload,
		})
		return err
	})
	return version, err
}

func (s *Service) GetCustomer(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.Customer, error) {
	if !authz.Visible(p, authz.WorkspaceScope()) {
		return model.Customer{}, platform.NotFound("customer")
	}
	row, err := s.db.Queries().GetCustomer(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return model.Customer{}, platform.NotFound("customer")
		}
		return model.Customer{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.DeletedAt != nil {
		return model.Customer{}, platform.NotFound("customer")
	}
	return toCustomer(row), nil
}

func (s *Service) ListCustomers(ctx context.Context, p *authz.Principal) ([]model.Customer, error) {
	if !authz.Visible(p, authz.WorkspaceScope()) {
		return nil, nil
	}
	rows, err := s.db.Queries().ListCustomersInWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Customer, 0, len(rows))
	for _, row := range rows {
		out = append(out, toCustomer(row))
	}
	return out, nil
}

func (s *Service) CreateCustomerRequest(
	ctx context.Context, p *authz.Principal, in CreateCustomerRequestInput,
) (model.CustomerRequest, int64, error) {
	if !authz.Can(p, authz.ActionProjectCreate) {
		return model.CustomerRequest{}, 0, platform.Forbidden("customerRequest")
	}
	if in.IssueID == nil && in.ProjectID == nil {
		return model.CustomerRequest{}, 0, platform.Validation("input", "a request must attach to an issue or a project")
	}
	body := strings.TrimSpace(in.Body)
	if len(body) > maxCustomerRequestBody {
		return model.CustomerRequest{}, 0, platform.Validation("body", "request is too long")
	}

	var out model.CustomerRequest
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if err := requireCustomerRequestsEnabled(ctx, q, p.WorkspaceID); err != nil {
			return err
		}
		if in.CustomerID != nil {
			if _, err := s.requireCustomerVisible(ctx, q, p, *in.CustomerID); err != nil {
				return err
			}
		}
		if in.IssueID != nil {
			if err := s.requireIssueVisible(ctx, q, p, *in.IssueID); err != nil {
				return err
			}
		}
		if in.ProjectID != nil {
			if _, err := s.requireProjectVisible(ctx, q, p, *in.ProjectID); err != nil {
				return err
			}
		}
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		creator := p.UserID
		row, err := q.CreateCustomerRequest(ctx, store.CreateCustomerRequestParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			CustomerID:  in.CustomerID,
			IssueID:     in.IssueID,
			ProjectID:   in.ProjectID,
			Body:        body,
			Important:   in.Important,
			CreatorID:   &creator,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toCustomerRequest(row)
		scope, err := s.customerRequestScope(ctx, q, row)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "customerRequest", EntityID: id, Op: OpUpsert, Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) UpdateCustomerRequest(
	ctx context.Context, p *authz.Principal, in UpdateCustomerRequestInput,
) (model.CustomerRequest, int64, error) {
	if in.Body == nil && in.Important == nil && in.CustomerID == nil && !in.ClearCustomer &&
		in.IssueID == nil && in.ProjectID == nil {
		return model.CustomerRequest{}, 0, platform.Validation("input", "nothing to update")
	}
	if in.Body != nil {
		trimmed := strings.TrimSpace(*in.Body)
		if len(trimmed) > maxCustomerRequestBody {
			return model.CustomerRequest{}, 0, platform.Validation("body", "request is too long")
		}
		in.Body = &trimmed
	}

	var out model.CustomerRequest
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if err := requireCustomerRequestsEnabled(ctx, q, p.WorkspaceID); err != nil {
			return err
		}
		existing, err := s.requireCustomerRequestWrite(ctx, q, p, in.ID)
		if err != nil {
			return err
		}
		if in.CustomerID != nil {
			if _, err := s.requireCustomerVisible(ctx, q, p, *in.CustomerID); err != nil {
				return err
			}
		}
		if in.IssueID != nil {
			if err := s.requireIssueVisible(ctx, q, p, *in.IssueID); err != nil {
				return err
			}
		}
		if in.ProjectID != nil {
			if _, err := s.requireProjectVisible(ctx, q, p, *in.ProjectID); err != nil {
				return err
			}
		}
		issueID := existing.IssueID
		if in.IssueID != nil {
			issueID = in.IssueID
		}
		projectID := existing.ProjectID
		if in.ProjectID != nil {
			projectID = in.ProjectID
		}
		if issueID == nil && projectID == nil {
			return platform.Validation("input", "a request must attach to an issue or a project")
		}
		row, err := q.UpdateCustomerRequest(ctx, store.UpdateCustomerRequestParams{
			ID:            in.ID,
			Body:          in.Body,
			Important:     in.Important,
			IssueID:       in.IssueID,
			ProjectID:     in.ProjectID,
			CustomerID:    in.CustomerID,
			ClearCustomer: in.ClearCustomer,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("customerRequest")
			}
			return platform.Internal(err)
		}
		out = toCustomerRequest(row)
		scope, err := s.customerRequestScope(ctx, q, row)
		if err != nil {
			return err
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "customerRequest", EntityID: in.ID, Op: OpUpsert, Scope: scope, Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteCustomerRequest(ctx context.Context, p *authz.Principal, id uuid.UUID) (int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := s.requireCustomerRequestWrite(ctx, q, p, id)
		if err != nil {
			return err
		}
		scope, err := s.customerRequestScope(ctx, q, existing)
		if err != nil {
			return err
		}
		row, err := q.DeleteCustomerRequest(ctx, id)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("customerRequest")
			}
			return platform.Internal(err)
		}
		payload := toCustomerRequest(row)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "customerRequest", EntityID: id, Op: OpDelete, Scope: scope, Payload: payload,
		})
		return err
	})
	return version, err
}

func (s *Service) GetCustomerRequest(
	ctx context.Context, p *authz.Principal, id uuid.UUID,
) (model.CustomerRequest, error) {
	row, err := s.db.Queries().GetCustomerRequest(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return model.CustomerRequest{}, platform.NotFound("customerRequest")
		}
		return model.CustomerRequest{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID {
		return model.CustomerRequest{}, platform.NotFound("customerRequest")
	}
	scope, err := s.customerRequestScope(ctx, s.db.Queries(), row)
	if err != nil {
		return model.CustomerRequest{}, err
	}
	if !authz.Visible(p, scope) {
		return model.CustomerRequest{}, platform.NotFound("customerRequest")
	}
	return toCustomerRequest(row), nil
}

func requireCustomerRequestsEnabled(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) error {
	ws, err := q.GetWorkspace(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return platform.NotFound("workspace")
		}
		return platform.Internal(err)
	}
	if !ws.CustomerRequestsEnabled {
		return platform.Validation("customerRequestsEnabled", "customer requests are turned off")
	}
	return nil
}

func unionDomains(keep, extra []string) []string {
	seen := make(map[string]struct{}, len(keep)+len(extra))
	out := make([]string, 0, len(keep)+len(extra))
	for _, domain := range keep {
		if _, ok := seen[domain]; ok {
			continue
		}
		seen[domain] = struct{}{}
		out = append(out, domain)
	}
	for _, domain := range extra {
		if _, ok := seen[domain]; ok {
			continue
		}
		seen[domain] = struct{}{}
		out = append(out, domain)
	}
	return out
}

func coalesceInt32(keep, fallback *int32) (value *int32, clear bool) {
	if keep != nil {
		return keep, false
	}
	return fallback, false
}

func coalesceString(keep, fallback *string) (value *string, clear bool) {
	if keep != nil && strings.TrimSpace(*keep) != "" {
		return keep, false
	}
	return fallback, false
}

func coalesceUUID(keep, fallback *uuid.UUID) (value *uuid.UUID, clear bool) {
	if keep != nil {
		return keep, false
	}
	return fallback, false
}

func (s *Service) requireCustomerWrite(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.Customer, error) {
	if !authz.Can(p, authz.ActionProjectUpdate) {
		return store.Customer{}, platform.Forbidden("customer")
	}
	row, err := q.GetCustomerForUpdate(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.Customer{}, platform.NotFound("customer")
		}
		return store.Customer{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID {
		return store.Customer{}, platform.NotFound("customer")
	}
	return row, nil
}

func (s *Service) requireCustomerVisible(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.Customer, error) {
	if !authz.Visible(p, authz.WorkspaceScope()) {
		return store.Customer{}, platform.NotFound("customer")
	}
	row, err := q.GetCustomer(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.Customer{}, platform.NotFound("customer")
		}
		return store.Customer{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.DeletedAt != nil {
		return store.Customer{}, platform.NotFound("customer")
	}
	return row, nil
}

func (s *Service) requireCustomerRequestWrite(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) (store.CustomerRequest, error) {
	if !authz.Can(p, authz.ActionProjectUpdate) {
		return store.CustomerRequest{}, platform.Forbidden("customerRequest")
	}
	row, err := q.GetCustomerRequestForUpdate(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return store.CustomerRequest{}, platform.NotFound("customerRequest")
		}
		return store.CustomerRequest{}, platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID {
		return store.CustomerRequest{}, platform.NotFound("customerRequest")
	}
	scope, err := s.customerRequestScope(ctx, q, row)
	if err != nil {
		return store.CustomerRequest{}, err
	}
	if !authz.Visible(p, scope) {
		return store.CustomerRequest{}, platform.NotFound("customerRequest")
	}
	return row, nil
}

func (s *Service) customerRequestScope(
	ctx context.Context, q *store.Queries, row store.CustomerRequest,
) (authz.Scope, error) {
	if row.IssueID != nil {
		issue, err := q.GetIssue(ctx, *row.IssueID)
		if err != nil {
			if store.IsNotFound(err) {
				return authz.Scope{}, platform.NotFound("issue")
			}
			return authz.Scope{}, platform.Internal(err)
		}
		team, err := q.GetTeam(ctx, issue.TeamID)
		if err != nil {
			return authz.Scope{}, platform.Internal(err)
		}
		return authz.TeamScope(issue.TeamID, team.Private).WithoutGuests(), nil
	}
	if row.ProjectID != nil {
		scope, err := s.projectScope(ctx, q, *row.ProjectID)
		if err != nil {
			return authz.Scope{}, err
		}
		return scope.WithoutGuests(), nil
	}
	return authz.WorkspaceScope(), nil
}

func nextCustomerSort(ctx context.Context, q *store.Queries, workspaceID uuid.UUID) (string, error) {
	last, err := q.LastCustomerSortOrder(ctx, workspaceID)
	if err != nil {
		if store.IsNotFound(err) {
			return fractional.First(), nil
		}
		return "", platform.Internal(err)
	}
	return fractional.After(last), nil
}

func replaceCustomerDomains(
	ctx context.Context, q *store.Queries, workspaceID, customerID uuid.UUID, domains []string,
) error {
	if err := q.DeleteCustomerDomains(ctx, customerID); err != nil {
		return platform.Internal(err)
	}
	for _, domain := range domains {
		if err := q.InsertCustomerDomain(ctx, store.InsertCustomerDomainParams{
			WorkspaceID: workspaceID,
			Domain:      domain,
			CustomerID:  customerID,
		}); err != nil {
			if store.IsUniqueViolation(err, "customer_domain_pkey") {
				return platform.Conflict("that domain already belongs to another customer")
			}
			return platform.Internal(err)
		}
	}
	return nil
}

func normalizeDomains(raw []string) ([]string, error) {
	if len(raw) == 0 {
		return []string{}, nil
	}
	seen := make(map[string]struct{}, len(raw))
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		domain, err := normalizeDomain(item)
		if err != nil {
			return nil, err
		}
		if domain == "" {
			continue
		}
		if _, ok := seen[domain]; ok {
			continue
		}
		seen[domain] = struct{}{}
		out = append(out, domain)
	}
	return out, nil
}

func normalizeDomain(raw string) (string, error) {
	value := strings.TrimSpace(strings.ToLower(raw))
	if value == "" {
		return "", nil
	}
	value = strings.TrimPrefix(value, "@")
	if strings.Contains(value, "://") {
		parsed, err := url.Parse(value)
		if err != nil || parsed.Host == "" {
			return "", platform.Validation("domains", "not a domain")
		}
		value = parsed.Host
	}
	if slash := strings.IndexByte(value, '/'); slash >= 0 {
		value = value[:slash]
	}
	if colon := strings.IndexByte(value, ':'); colon >= 0 {
		value = value[:colon]
	}
	if !domainName.MatchString(value) {
		return "", platform.Validation("domains", "not a domain")
	}
	return value, nil
}

func validateRevenueSize(revenue, size *int32) error {
	if revenue != nil && *revenue < 0 {
		return platform.Validation("revenue", "revenue cannot be negative")
	}
	if size != nil && *size < 0 {
		return platform.Validation("size", "size cannot be negative")
	}
	return nil
}

func trimOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func toCustomer(row store.Customer) model.Customer {
	domains := row.Domains
	if domains == nil {
		domains = []string{}
	}
	return model.Customer{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		Name:        row.Name,
		Domains:     domains,
		Revenue:     row.Revenue,
		Size:        row.Size,
		Tier:        row.Tier,
		Status:      row.Status,
		OwnerID:     row.OwnerID,
		LogoURL:     row.LogoUrl,
		CreatorID:   row.CreatorID,
		SortOrder:   row.SortOrder,
		ArchivedAt:  row.ArchivedAt,
		DeletedAt:   row.DeletedAt,
		DeletedBy:   row.DeletedBy,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func toCustomerRequest(row store.CustomerRequest) model.CustomerRequest {
	return model.CustomerRequest{
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
