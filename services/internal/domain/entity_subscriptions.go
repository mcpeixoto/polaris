package domain

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/notify"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Project, initiative and customer subscriptions — personal bells on those pages.
//
// Slack-channel subscriptions stay out. They need a Slack install, and shipping them as a
// column on this row would mean a personal inbox setting that silently posts to a channel
// nobody authorised.

type SetProjectSubscriptionInput struct {
	ProjectID       uuid.UUID
	IssuesAdded     bool
	IssuesCompleted bool
	Updates         bool
}

type SetInitiativeSubscriptionInput struct {
	InitiativeID    uuid.UUID
	IssuesAdded     bool
	IssuesCompleted bool
	Updates         bool
}

type SetCustomerSubscriptionInput struct {
	CustomerID       uuid.UUID
	RequestAdded     bool
	RequestImportant bool
	RequestCompleted bool
}

func (s *Service) SetProjectSubscription(
	ctx context.Context, p *authz.Principal, in SetProjectSubscriptionInput,
) (model.ProjectSubscription, int64, error) {
	if p.IsGuest() {
		return model.ProjectSubscription{}, 0, platform.Forbidden("project subscription")
	}

	var out model.ProjectSubscription
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		project, err := s.requireProjectVisible(ctx, q, p, in.ProjectID)
		if err != nil {
			return err
		}
		if project.ArchivedAt != nil {
			return platform.NotFound("project")
		}

		existing, err := q.GetProjectSubscriptionForUser(ctx, store.GetProjectSubscriptionForUserParams{
			ProjectID: in.ProjectID,
			UserID:    p.UserID,
		})
		found := err == nil
		if err != nil && !store.IsNotFound(err) {
			return platform.Internal(err)
		}

		if !in.IssuesAdded && !in.IssuesCompleted && !in.Updates {
			if !found {
				return platform.NotFound("projectSubscription")
			}
			if err := q.DeleteProjectSubscription(ctx, existing.ID); err != nil {
				return platform.Internal(err)
			}
			out = toProjectSubscription(existing)
			version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "projectSubscription", EntityID: existing.ID, Op: OpDelete,
				Scope: authz.UserScope(p.UserID),
			})
			return err
		}

		if found {
			row, err := q.UpdateProjectSubscription(ctx, store.UpdateProjectSubscriptionParams{
				ID:                    existing.ID,
				NotifyIssuesAdded:     in.IssuesAdded,
				NotifyIssuesCompleted: in.IssuesCompleted,
				NotifyUpdates:         in.Updates,
			})
			if err != nil {
				return platform.Internal(err)
			}
			out = toProjectSubscription(row)
		} else {
			id, err := uuid.NewV7()
			if err != nil {
				return platform.Internal(err)
			}
			row, err := q.CreateProjectSubscription(ctx, store.CreateProjectSubscriptionParams{
				ID:                    id,
				WorkspaceID:           p.WorkspaceID,
				ProjectID:             in.ProjectID,
				UserID:                p.UserID,
				NotifyIssuesAdded:     in.IssuesAdded,
				NotifyIssuesCompleted: in.IssuesCompleted,
				NotifyUpdates:         in.Updates,
			})
			if err != nil {
				return platform.Internal(err)
			}
			out = toProjectSubscription(row)
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "projectSubscription", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteProjectSubscription(
	ctx context.Context, p *authz.Principal, projectID uuid.UUID,
) (uuid.UUID, int64, error) {
	row, version, err := s.SetProjectSubscription(ctx, p, SetProjectSubscriptionInput{ProjectID: projectID})
	if err != nil {
		return uuid.Nil, 0, err
	}
	return row.ID, version, nil
}

func (s *Service) SetInitiativeSubscription(
	ctx context.Context, p *authz.Principal, in SetInitiativeSubscriptionInput,
) (model.InitiativeSubscription, int64, error) {
	if p.IsGuest() {
		return model.InitiativeSubscription{}, 0, platform.Forbidden("initiative subscription")
	}

	var out model.InitiativeSubscription
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if err := s.visibleInitiativeForSub(ctx, q, p, in.InitiativeID); err != nil {
			return err
		}

		existing, err := q.GetInitiativeSubscriptionForUser(ctx, store.GetInitiativeSubscriptionForUserParams{
			InitiativeID: in.InitiativeID,
			UserID:       p.UserID,
		})
		found := err == nil
		if err != nil && !store.IsNotFound(err) {
			return platform.Internal(err)
		}

		if !in.IssuesAdded && !in.IssuesCompleted && !in.Updates {
			if !found {
				return platform.NotFound("initiativeSubscription")
			}
			if err := q.DeleteInitiativeSubscription(ctx, existing.ID); err != nil {
				return platform.Internal(err)
			}
			out = toInitiativeSubscription(existing)
			version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "initiativeSubscription", EntityID: existing.ID, Op: OpDelete,
				Scope: authz.UserScope(p.UserID),
			})
			return err
		}

		if found {
			row, err := q.UpdateInitiativeSubscription(ctx, store.UpdateInitiativeSubscriptionParams{
				ID:                    existing.ID,
				NotifyIssuesAdded:     in.IssuesAdded,
				NotifyIssuesCompleted: in.IssuesCompleted,
				NotifyUpdates:         in.Updates,
			})
			if err != nil {
				return platform.Internal(err)
			}
			out = toInitiativeSubscription(row)
		} else {
			id, err := uuid.NewV7()
			if err != nil {
				return platform.Internal(err)
			}
			row, err := q.CreateInitiativeSubscription(ctx, store.CreateInitiativeSubscriptionParams{
				ID:                    id,
				WorkspaceID:           p.WorkspaceID,
				InitiativeID:          in.InitiativeID,
				UserID:                p.UserID,
				NotifyIssuesAdded:     in.IssuesAdded,
				NotifyIssuesCompleted: in.IssuesCompleted,
				NotifyUpdates:         in.Updates,
			})
			if err != nil {
				return platform.Internal(err)
			}
			out = toInitiativeSubscription(row)
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "initiativeSubscription", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteInitiativeSubscription(
	ctx context.Context, p *authz.Principal, initiativeID uuid.UUID,
) (uuid.UUID, int64, error) {
	row, version, err := s.SetInitiativeSubscription(ctx, p, SetInitiativeSubscriptionInput{InitiativeID: initiativeID})
	if err != nil {
		return uuid.Nil, 0, err
	}
	return row.ID, version, nil
}

func (s *Service) SetCustomerSubscription(
	ctx context.Context, p *authz.Principal, in SetCustomerSubscriptionInput,
) (model.CustomerSubscription, int64, error) {
	if p.IsGuest() {
		return model.CustomerSubscription{}, 0, platform.Forbidden("customer subscription")
	}

	var out model.CustomerSubscription
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		customer, err := s.requireCustomerVisible(ctx, q, p, in.CustomerID)
		if err != nil {
			return err
		}
		if customer.ArchivedAt != nil {
			return platform.NotFound("customer")
		}

		existing, err := q.GetCustomerSubscriptionForUser(ctx, store.GetCustomerSubscriptionForUserParams{
			CustomerID: in.CustomerID,
			UserID:     p.UserID,
		})
		found := err == nil
		if err != nil && !store.IsNotFound(err) {
			return platform.Internal(err)
		}

		if !in.RequestAdded && !in.RequestImportant && !in.RequestCompleted {
			if !found {
				return platform.NotFound("customerSubscription")
			}
			if err := q.DeleteCustomerSubscription(ctx, existing.ID); err != nil {
				return platform.Internal(err)
			}
			out = toCustomerSubscription(existing)
			version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "customerSubscription", EntityID: existing.ID, Op: OpDelete,
				Scope: authz.UserScope(p.UserID),
			})
			return err
		}

		if found {
			row, err := q.UpdateCustomerSubscription(ctx, store.UpdateCustomerSubscriptionParams{
				ID:                     existing.ID,
				NotifyRequestAdded:     in.RequestAdded,
				NotifyRequestImportant: in.RequestImportant,
				NotifyRequestCompleted: in.RequestCompleted,
			})
			if err != nil {
				return platform.Internal(err)
			}
			out = toCustomerSubscription(row)
		} else {
			id, err := uuid.NewV7()
			if err != nil {
				return platform.Internal(err)
			}
			row, err := q.CreateCustomerSubscription(ctx, store.CreateCustomerSubscriptionParams{
				ID:                     id,
				WorkspaceID:            p.WorkspaceID,
				CustomerID:             in.CustomerID,
				UserID:                 p.UserID,
				NotifyRequestAdded:     in.RequestAdded,
				NotifyRequestImportant: in.RequestImportant,
				NotifyRequestCompleted: in.RequestCompleted,
			})
			if err != nil {
				return platform.Internal(err)
			}
			out = toCustomerSubscription(row)
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "customerSubscription", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	return out, version, err
}

func (s *Service) DeleteCustomerSubscription(
	ctx context.Context, p *authz.Principal, customerID uuid.UUID,
) (uuid.UUID, int64, error) {
	row, version, err := s.SetCustomerSubscription(ctx, p, SetCustomerSubscriptionInput{CustomerID: customerID})
	if err != nil {
		return uuid.Nil, 0, err
	}
	return row.ID, version, nil
}

func (s *Service) visibleInitiativeForSub(
	ctx context.Context, q *store.Queries, p *authz.Principal, id uuid.UUID,
) error {
	row, err := q.GetInitiative(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return platform.NotFound("initiative")
		}
		return platform.Internal(err)
	}
	if row.WorkspaceID != p.WorkspaceID || row.DeletedAt != nil || row.ArchivedAt != nil {
		return platform.NotFound("initiative")
	}
	scope, err := s.initiativeScope(ctx, q, row)
	if err != nil {
		return err
	}
	if !authz.Visible(p, scope) {
		return platform.NotFound("initiative")
	}
	return nil
}

func toProjectSubscription(row store.ProjectSubscription) model.ProjectSubscription {
	return model.ProjectSubscription{
		ID:              row.ID,
		WorkspaceID:     row.WorkspaceID,
		ProjectID:       row.ProjectID,
		UserID:          row.UserID,
		IssuesAdded:     row.NotifyIssuesAdded,
		IssuesCompleted: row.NotifyIssuesCompleted,
		Updates:         row.NotifyUpdates,
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}
}

func toInitiativeSubscription(row store.InitiativeSubscription) model.InitiativeSubscription {
	return model.InitiativeSubscription{
		ID:              row.ID,
		WorkspaceID:     row.WorkspaceID,
		InitiativeID:    row.InitiativeID,
		UserID:          row.UserID,
		IssuesAdded:     row.NotifyIssuesAdded,
		IssuesCompleted: row.NotifyIssuesCompleted,
		Updates:         row.NotifyUpdates,
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}
}

func toCustomerSubscription(row store.CustomerSubscription) model.CustomerSubscription {
	return model.CustomerSubscription{
		ID:               row.ID,
		WorkspaceID:      row.WorkspaceID,
		CustomerID:       row.CustomerID,
		UserID:           row.UserID,
		RequestAdded:     row.NotifyRequestAdded,
		RequestImportant: row.NotifyRequestImportant,
		RequestCompleted: row.NotifyRequestCompleted,
		CreatedAt:        row.CreatedAt,
		UpdatedAt:        row.UpdatedAt,
	}
}

func emitProjectSubscriptionDeletes(
	ctx context.Context, em Emitter, q *store.Queries, workspaceID, projectID uuid.UUID,
) error {
	rows, err := q.ListProjectSubscriptionsForProject(ctx, projectID)
	if err != nil {
		return platform.Internal(err)
	}
	if len(rows) == 0 {
		return nil
	}
	changes := make([]Change, 0, len(rows))
	for _, row := range rows {
		if err := q.DeleteProjectSubscription(ctx, row.ID); err != nil {
			return platform.Internal(err)
		}
		changes = append(changes, Change{
			EntityType: "projectSubscription", EntityID: row.ID, Op: OpDelete,
			Scope: authz.UserScope(row.UserID),
		})
	}
	_, err = em.Emit(ctx, q, workspaceID, authz.SystemActor(), changes...)
	return err
}

func emitInitiativeSubscriptionDeletes(
	ctx context.Context, em Emitter, q *store.Queries, workspaceID, initiativeID uuid.UUID,
) error {
	rows, err := q.ListInitiativeSubscriptionsForInitiative(ctx, initiativeID)
	if err != nil {
		return platform.Internal(err)
	}
	if len(rows) == 0 {
		return nil
	}
	changes := make([]Change, 0, len(rows))
	for _, row := range rows {
		if err := q.DeleteInitiativeSubscription(ctx, row.ID); err != nil {
			return platform.Internal(err)
		}
		changes = append(changes, Change{
			EntityType: "initiativeSubscription", EntityID: row.ID, Op: OpDelete,
			Scope: authz.UserScope(row.UserID),
		})
	}
	_, err = em.Emit(ctx, q, workspaceID, authz.SystemActor(), changes...)
	return err
}

func emitCustomerSubscriptionDeletes(
	ctx context.Context, em Emitter, q *store.Queries, workspaceID, customerID uuid.UUID,
) error {
	rows, err := q.ListCustomerSubscriptionsForCustomer(ctx, customerID)
	if err != nil {
		return platform.Internal(err)
	}
	if len(rows) == 0 {
		return nil
	}
	changes := make([]Change, 0, len(rows))
	for _, row := range rows {
		if err := q.DeleteCustomerSubscription(ctx, row.ID); err != nil {
			return platform.Internal(err)
		}
		changes = append(changes, Change{
			EntityType: "customerSubscription", EntityID: row.ID, Op: OpDelete,
			Scope: authz.UserScope(row.UserID),
		})
	}
	_, err = em.Emit(ctx, q, workspaceID, authz.SystemActor(), changes...)
	return err
}

func entitySubscriptionDeliveries(
	ctx context.Context, c *fanOutCache, r store.ChangeLog,
) ([]notify.Delivery, error) {
	if r.Op != notify.OpUpsert {
		return nil, nil
	}
	switch r.EntityType {
	case notify.EntityIssue:
		var issue model.Issue
		if err := json.Unmarshal(r.Payload, &issue); err != nil {
			return nil, nil
		}
		category, err := c.categoryOf(ctx, issue.StateID)
		if err != nil {
			return nil, err
		}
		out, err := projectIssueDeliveries(ctx, c, r, issue, category)
		if err != nil {
			return nil, err
		}
		extra, err := initiativeIssueDeliveries(ctx, c, r, issue, category)
		if err != nil {
			return nil, err
		}
		out = append(out, extra...)
		completed, err := customerRequestCompletedDeliveries(ctx, c, r, issue, category)
		if err != nil {
			return nil, err
		}
		return append(out, completed...), nil
	case "projectUpdate":
		return projectUpdateDeliveries(ctx, c, r)
	case "initiativeUpdate":
		return initiativeUpdateDeliveries(ctx, c, r)
	case "customerRequest":
		return customerRequestDeliveries(ctx, c, r)
	default:
		return nil, nil
	}
}

func projectIssueDeliveries(
	ctx context.Context, c *fanOutCache, r store.ChangeLog, issue model.Issue, category string,
) ([]notify.Delivery, error) {
	if issue.ProjectID == nil {
		return nil, nil
	}
	isCreate := len(r.ChangedFields) == 0
	stateMoved := false
	for _, field := range r.ChangedFields {
		if field == notify.FieldState {
			stateMoved = true
			break
		}
	}
	isTerminal := category == CategoryCompleted || category == CategoryCanceled
	if !isCreate && !(stateMoved && isTerminal) {
		return nil, nil
	}

	subs, err := c.projectSubscriptions(ctx)
	if err != nil {
		return nil, err
	}
	var out []notify.Delivery
	issueID := issue.ID
	for _, sub := range subs {
		if sub.ProjectID != *issue.ProjectID {
			continue
		}
		wantAdded := isCreate && sub.NotifyIssuesAdded
		wantCompleted := stateMoved && isTerminal && sub.NotifyIssuesCompleted
		if !wantAdded && !wantCompleted {
			continue
		}
		if r.ActorID != nil && *r.ActorID == sub.UserID {
			continue
		}
		kept, err := c.keep(ctx, []uuid.UUID{sub.UserID})
		if err != nil {
			return nil, err
		}
		if len(kept) == 0 {
			continue
		}
		muted := c.muted[sub.UserID]
		if wantAdded && (muted == nil || !muted[model.NotifyProjectIssueAdded]) {
			out = append(out, notify.Delivery{
				UserID:   sub.UserID,
				Type:     model.NotifyProjectIssueAdded,
				GroupKey: entitySubGroupKey(r, model.NotifyProjectIssueAdded, sub.ProjectID),
				IssueID:  &issueID,
			})
		}
		if wantCompleted && (muted == nil || !muted[model.NotifyProjectIssueCompleted]) {
			out = append(out, notify.Delivery{
				UserID:   sub.UserID,
				Type:     model.NotifyProjectIssueCompleted,
				GroupKey: entitySubGroupKey(r, model.NotifyProjectIssueCompleted, sub.ProjectID),
				IssueID:  &issueID,
			})
		}
	}
	return out, nil
}

func initiativeIssueDeliveries(
	ctx context.Context, c *fanOutCache, r store.ChangeLog, issue model.Issue, category string,
) ([]notify.Delivery, error) {
	if issue.ProjectID == nil {
		return nil, nil
	}
	isCreate := len(r.ChangedFields) == 0
	stateMoved := false
	for _, field := range r.ChangedFields {
		if field == notify.FieldState {
			stateMoved = true
			break
		}
	}
	isTerminal := category == CategoryCompleted || category == CategoryCanceled
	if !isCreate && !(stateMoved && isTerminal) {
		return nil, nil
	}

	grouped, err := c.initiativeSubscriptions(ctx)
	if err != nil {
		return nil, err
	}
	var out []notify.Delivery
	issueID := issue.ID
	for _, sub := range grouped {
		linked := false
		for _, projectID := range sub.ProjectIDs {
			if projectID == *issue.ProjectID {
				linked = true
				break
			}
		}
		if !linked {
			continue
		}
		wantAdded := isCreate && sub.NotifyIssuesAdded
		wantCompleted := stateMoved && isTerminal && sub.NotifyIssuesCompleted
		if !wantAdded && !wantCompleted {
			continue
		}
		if r.ActorID != nil && *r.ActorID == sub.UserID {
			continue
		}
		kept, err := c.keep(ctx, []uuid.UUID{sub.UserID})
		if err != nil {
			return nil, err
		}
		if len(kept) == 0 {
			continue
		}
		muted := c.muted[sub.UserID]
		if wantAdded && (muted == nil || !muted[model.NotifyInitiativeIssueAdded]) {
			out = append(out, notify.Delivery{
				UserID:   sub.UserID,
				Type:     model.NotifyInitiativeIssueAdded,
				GroupKey: entitySubGroupKey(r, model.NotifyInitiativeIssueAdded, sub.InitiativeID),
				IssueID:  &issueID,
			})
		}
		if wantCompleted && (muted == nil || !muted[model.NotifyInitiativeIssueCompleted]) {
			out = append(out, notify.Delivery{
				UserID:   sub.UserID,
				Type:     model.NotifyInitiativeIssueCompleted,
				GroupKey: entitySubGroupKey(r, model.NotifyInitiativeIssueCompleted, sub.InitiativeID),
				IssueID:  &issueID,
			})
		}
	}
	return out, nil
}

func projectUpdateDeliveries(
	ctx context.Context, c *fanOutCache, r store.ChangeLog,
) ([]notify.Delivery, error) {
	if len(r.ChangedFields) != 0 {
		return nil, nil
	}
	var update model.ProjectUpdate
	if err := json.Unmarshal(r.Payload, &update); err != nil {
		return nil, nil
	}
	subs, err := c.projectSubscriptions(ctx)
	if err != nil {
		return nil, err
	}
	payload, _ := json.Marshal(map[string]string{"projectId": update.ProjectID.String()})
	var out []notify.Delivery
	for _, sub := range subs {
		if sub.ProjectID != update.ProjectID || !sub.NotifyUpdates {
			continue
		}
		if r.ActorID != nil && *r.ActorID == sub.UserID {
			continue
		}
		kept, err := c.keep(ctx, []uuid.UUID{sub.UserID})
		if err != nil {
			return nil, err
		}
		if len(kept) == 0 {
			continue
		}
		muted := c.muted[sub.UserID]
		if muted != nil && muted[model.NotifyProjectUpdate] {
			continue
		}
		out = append(out, notify.Delivery{
			UserID:   sub.UserID,
			Type:     model.NotifyProjectUpdate,
			GroupKey: entitySubGroupKey(r, model.NotifyProjectUpdate, sub.ProjectID),
			Payload:  payload,
		})
	}
	return out, nil
}

func initiativeUpdateDeliveries(
	ctx context.Context, c *fanOutCache, r store.ChangeLog,
) ([]notify.Delivery, error) {
	if len(r.ChangedFields) != 0 {
		return nil, nil
	}
	var update model.InitiativeUpdate
	if err := json.Unmarshal(r.Payload, &update); err != nil {
		return nil, nil
	}
	grouped, err := c.initiativeSubscriptions(ctx)
	if err != nil {
		return nil, err
	}
	payload, _ := json.Marshal(map[string]string{"initiativeId": update.InitiativeID.String()})
	var out []notify.Delivery
	for _, sub := range grouped {
		if sub.InitiativeID != update.InitiativeID || !sub.NotifyUpdates {
			continue
		}
		if r.ActorID != nil && *r.ActorID == sub.UserID {
			continue
		}
		kept, err := c.keep(ctx, []uuid.UUID{sub.UserID})
		if err != nil {
			return nil, err
		}
		if len(kept) == 0 {
			continue
		}
		muted := c.muted[sub.UserID]
		if muted != nil && muted[model.NotifyInitiativeUpdate] {
			continue
		}
		out = append(out, notify.Delivery{
			UserID:   sub.UserID,
			Type:     model.NotifyInitiativeUpdate,
			GroupKey: entitySubGroupKey(r, model.NotifyInitiativeUpdate, sub.InitiativeID),
			Payload:  payload,
		})
	}
	return out, nil
}

func customerRequestDeliveries(
	ctx context.Context, c *fanOutCache, r store.ChangeLog,
) ([]notify.Delivery, error) {
	var request model.CustomerRequest
	if err := json.Unmarshal(r.Payload, &request); err != nil {
		return nil, nil
	}
	if request.CustomerID == nil {
		return nil, nil
	}
	isCreate := len(r.ChangedFields) == 0
	importantMoved := false
	for _, field := range r.ChangedFields {
		if field == "important" {
			importantMoved = true
			break
		}
	}
	if !isCreate && !(importantMoved && request.Important) {
		return nil, nil
	}

	subs, err := c.customerSubscriptions(ctx)
	if err != nil {
		return nil, err
	}
	payload, _ := json.Marshal(map[string]string{"customerId": request.CustomerID.String()})
	var out []notify.Delivery
	for _, sub := range subs {
		if sub.CustomerID != *request.CustomerID {
			continue
		}
		wantAdded := isCreate && sub.NotifyRequestAdded
		wantImportant := importantMoved && request.Important && sub.NotifyRequestImportant
		if !wantAdded && !wantImportant {
			continue
		}
		if r.ActorID != nil && *r.ActorID == sub.UserID {
			continue
		}
		kept, err := c.keep(ctx, []uuid.UUID{sub.UserID})
		if err != nil {
			return nil, err
		}
		if len(kept) == 0 {
			continue
		}
		muted := c.muted[sub.UserID]
		if wantAdded && (muted == nil || !muted[model.NotifyCustomerRequestAdded]) {
			out = append(out, notify.Delivery{
				UserID:   sub.UserID,
				Type:     model.NotifyCustomerRequestAdded,
				GroupKey: entitySubGroupKey(r, model.NotifyCustomerRequestAdded, sub.CustomerID),
				IssueID:  request.IssueID,
				Payload:  payload,
			})
		}
		if wantImportant && (muted == nil || !muted[model.NotifyCustomerRequestImportant]) {
			out = append(out, notify.Delivery{
				UserID:   sub.UserID,
				Type:     model.NotifyCustomerRequestImportant,
				GroupKey: entitySubGroupKey(r, model.NotifyCustomerRequestImportant, sub.CustomerID),
				IssueID:  request.IssueID,
				Payload:  payload,
			})
		}
	}
	return out, nil
}

func customerRequestCompletedDeliveries(
	ctx context.Context, c *fanOutCache, r store.ChangeLog, issue model.Issue, category string,
) ([]notify.Delivery, error) {
	stateMoved := false
	for _, field := range r.ChangedFields {
		if field == notify.FieldState {
			stateMoved = true
			break
		}
	}
	isTerminal := category == CategoryCompleted || category == CategoryCanceled
	if !stateMoved || !isTerminal {
		return nil, nil
	}

	issueID := issue.ID
	requests, err := c.q.ListCustomerRequestsForIssue(ctx, &issueID)
	if err != nil {
		return nil, platform.Internal(fmt.Errorf("fan-out: read customer requests: %w", err))
	}
	if len(requests) == 0 {
		return nil, nil
	}
	subs, err := c.customerSubscriptions(ctx)
	if err != nil {
		return nil, err
	}
	byCustomer := map[uuid.UUID][]store.CustomerSubscription{}
	for _, sub := range subs {
		if sub.NotifyRequestCompleted {
			byCustomer[sub.CustomerID] = append(byCustomer[sub.CustomerID], sub)
		}
	}
	var out []notify.Delivery
	seen := map[uuid.UUID]bool{}
	for _, request := range requests {
		if request.CustomerID == nil {
			continue
		}
		payload, _ := json.Marshal(map[string]string{"customerId": request.CustomerID.String()})
		for _, sub := range byCustomer[*request.CustomerID] {
			if seen[sub.UserID] {
				continue
			}
			if r.ActorID != nil && *r.ActorID == sub.UserID {
				continue
			}
			kept, err := c.keep(ctx, []uuid.UUID{sub.UserID})
			if err != nil {
				return nil, err
			}
			if len(kept) == 0 {
				continue
			}
			muted := c.muted[sub.UserID]
			if muted != nil && muted[model.NotifyCustomerRequestCompleted] {
				continue
			}
			seen[sub.UserID] = true
			out = append(out, notify.Delivery{
				UserID:   sub.UserID,
				Type:     model.NotifyCustomerRequestCompleted,
				GroupKey: entitySubGroupKey(r, model.NotifyCustomerRequestCompleted, sub.CustomerID),
				IssueID:  &issueID,
				Payload:  payload,
			})
		}
	}
	return out, nil
}

func entitySubGroupKey(r store.ChangeLog, typ string, targetID uuid.UUID) string {
	if r.BatchKey != nil && *r.BatchKey != "" {
		return fmt.Sprintf("%s:%s:%s", typ, targetID, *r.BatchKey)
	}
	return fmt.Sprintf("%s:%s:%d", typ, targetID, r.Version)
}

type initiativeSubWatch struct {
	ID                    uuid.UUID
	InitiativeID          uuid.UUID
	UserID                uuid.UUID
	NotifyIssuesAdded     bool
	NotifyIssuesCompleted bool
	NotifyUpdates         bool
	ProjectIDs            []uuid.UUID
}

func (c *fanOutCache) projectSubscriptions(ctx context.Context) ([]store.ProjectSubscription, error) {
	if c.projectSubsLoaded {
		return c.projectSubs, nil
	}
	rows, err := c.q.ListProjectSubscriptionsForFanOut(ctx, c.workspaceID)
	if err != nil {
		return nil, platform.Internal(fmt.Errorf("fan-out: read project subscriptions: %w", err))
	}
	c.projectSubs = rows
	c.projectSubsLoaded = true
	return rows, nil
}

func (c *fanOutCache) initiativeSubscriptions(ctx context.Context) ([]initiativeSubWatch, error) {
	if c.initiativeSubsLoaded {
		return c.initiativeSubs, nil
	}
	rows, err := c.q.ListInitiativeSubscriptionsForFanOut(ctx, c.workspaceID)
	if err != nil {
		return nil, platform.Internal(fmt.Errorf("fan-out: read initiative subscriptions: %w", err))
	}
	rebuilt := make([]initiativeSubWatch, 0)
	seen := map[uuid.UUID]int{}
	for _, row := range rows {
		idx, ok := seen[row.ID]
		if !ok {
			rebuilt = append(rebuilt, initiativeSubWatch{
				ID:                    row.ID,
				InitiativeID:          row.InitiativeID,
				UserID:                row.UserID,
				NotifyIssuesAdded:     row.NotifyIssuesAdded,
				NotifyIssuesCompleted: row.NotifyIssuesCompleted,
				NotifyUpdates:         row.NotifyUpdates,
			})
			idx = len(rebuilt) - 1
			seen[row.ID] = idx
		}
		if row.ProjectID != nil {
			rebuilt[idx].ProjectIDs = append(rebuilt[idx].ProjectIDs, *row.ProjectID)
		}
	}
	c.initiativeSubs = rebuilt
	c.initiativeSubsLoaded = true
	return rebuilt, nil
}

func (c *fanOutCache) customerSubscriptions(ctx context.Context) ([]store.CustomerSubscription, error) {
	if c.customerSubsLoaded {
		return c.customerSubs, nil
	}
	rows, err := c.q.ListCustomerSubscriptionsForFanOut(ctx, c.workspaceID)
	if err != nil {
		return nil, platform.Internal(fmt.Errorf("fan-out: read customer subscriptions: %w", err))
	}
	c.customerSubs = rows
	c.customerSubsLoaded = true
	return rows, nil
}
