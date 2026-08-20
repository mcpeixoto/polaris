package domain

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/filter"
	"github.com/peixotolabs/polaris/services/internal/notify"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// View subscriptions, the general-purpose alerting primitive.
//
// A saved view is a filter. Subscribing to it means "tell me when an issue is added to
// that filter, or completed/canceled inside it". The inbox already knows how to deliver
// a row to one person; this file is the write path for the subscription itself and the
// extra deliveries the fan-out asks for when an issue change matches one.
//
// Slack-channel subscriptions stay out. They need a Slack install, and shipping them as
// a column on this row would mean a personal inbox setting that silently posts to a
// channel nobody authorised.

type SetViewSubscriptionInput struct {
	ViewID    uuid.UUID
	Added     bool
	Completed bool
}

// SetViewSubscription upserts the caller's watch on a view, or removes it when both
// flags are false.
//
// Both-false is an unsubscribe rather than a validation error because the Subscribe
// menu's "off" state is that pair, and refusing it would mean a second mutation for the
// same control. The unique index on (view_id, user_id) is what makes the upsert honest:
// two tabs cannot leave two rows for one person.
func (s *Service) SetViewSubscription(
	ctx context.Context, p *authz.Principal, in SetViewSubscriptionInput,
) (model.ViewSubscription, int64, error) {
	if p.IsGuest() {
		return model.ViewSubscription{}, 0, platform.Forbidden("view subscription")
	}

	var out model.ViewSubscription
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := s.visibleView(ctx, q, p, in.ViewID); err != nil {
			return err
		}

		existing, err := q.GetViewSubscriptionForUser(ctx, store.GetViewSubscriptionForUserParams{
			ViewID: in.ViewID,
			UserID: p.UserID,
		})
		found := err == nil
		if err != nil && !store.IsNotFound(err) {
			return platform.Internal(err)
		}

		if !in.Added && !in.Completed {
			if !found {
				return platform.NotFound("viewSubscription")
			}
			if err := q.DeleteViewSubscription(ctx, existing.ID); err != nil {
				return platform.Internal(err)
			}
			out = toViewSubscription(existing)
			version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
				EntityType: "viewSubscription", EntityID: existing.ID, Op: OpDelete,
				Scope: authz.UserScope(p.UserID),
			})
			return err
		}

		if found {
			row, err := q.UpdateViewSubscription(ctx, store.UpdateViewSubscriptionParams{
				ID:              existing.ID,
				NotifyAdded:     in.Added,
				NotifyCompleted: in.Completed,
			})
			if err != nil {
				return platform.Internal(err)
			}
			out = toViewSubscription(row)
		} else {
			id, err := uuid.NewV7()
			if err != nil {
				return platform.Internal(err)
			}
			row, err := q.CreateViewSubscription(ctx, store.CreateViewSubscriptionParams{
				ID:              id,
				WorkspaceID:     p.WorkspaceID,
				ViewID:          in.ViewID,
				UserID:          p.UserID,
				NotifyAdded:     in.Added,
				NotifyCompleted: in.Completed,
			})
			if err != nil {
				return platform.Internal(err)
			}
			out = toViewSubscription(row)
		}

		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), Change{
			EntityType: "viewSubscription", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.UserScope(p.UserID), Payload: out,
		})
		return err
	})
	return out, version, err
}

// DeleteViewSubscription removes the caller's watch on a view.
func (s *Service) DeleteViewSubscription(
	ctx context.Context, p *authz.Principal, viewID uuid.UUID,
) (uuid.UUID, int64, error) {
	row, version, err := s.SetViewSubscription(ctx, p, SetViewSubscriptionInput{ViewID: viewID})
	if err != nil {
		return uuid.Nil, 0, err
	}
	return row.ID, version, nil
}

func toViewSubscription(row store.ViewSubscription) model.ViewSubscription {
	return model.ViewSubscription{
		ID:          row.ID,
		WorkspaceID: row.WorkspaceID,
		ViewID:      row.ViewID,
		UserID:      row.UserID,
		Added:       row.NotifyAdded,
		Completed:   row.NotifyCompleted,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

// emitViewSubscriptionDeletes drops every watch on an archived view and tells each
// owner's replica to forget the row. Archive rather than cascade-delete is why this
// exists: the view row survives, so ON DELETE CASCADE never fires, and a subscription
// pointing at a view nobody can open would otherwise sit in the replica forever.
func emitViewSubscriptionDeletes(
	ctx context.Context, em Emitter, q *store.Queries, workspaceID uuid.UUID, viewID uuid.UUID,
) error {
	rows, err := q.ListViewSubscriptionsForView(ctx, viewID)
	if err != nil {
		return platform.Internal(err)
	}
	if len(rows) == 0 {
		return nil
	}
	changes := make([]Change, 0, len(rows))
	for _, row := range rows {
		if err := q.DeleteViewSubscription(ctx, row.ID); err != nil {
			return platform.Internal(err)
		}
		changes = append(changes, Change{
			EntityType: "viewSubscription", EntityID: row.ID, Op: OpDelete,
			Scope: authz.UserScope(row.UserID),
		})
	}
	_, err = em.Emit(ctx, q, workspaceID, authz.SystemActor(), changes...)
	return err
}

// viewSubscriptionDeliveries is the extra inbox rows one issue change owes to people
// watching a saved view that the issue currently matches.
//
// It lives next to the fan-out rather than in internal/notify because matching a view is
// a SQL question — the same compiler search and SLAs use — and notify is the package that
// is not allowed to open a database. The judgements that do not need SQL stay here in
// prose: never the actor, never a muted type, added only on create, completed only when
// the status actually moved into completed or canceled.
//
// Property changes that move an existing issue into a filter are deferred. Detecting
// "newly matches" requires the previous payload evaluated against the same grammar, and
// the Go side of the grammar compiles to SQL over the live table. Create-plus-completed
// is the useful subset and it does not need that.
func viewSubscriptionDeliveries(
	ctx context.Context, c *fanOutCache, r store.ChangeLog, issue model.Issue, category string,
) ([]notify.Delivery, error) {
	if r.Op != notify.OpUpsert {
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

	subs, err := c.viewSubscriptions(ctx)
	if err != nil {
		return nil, err
	}
	if len(subs) == 0 {
		return nil, nil
	}

	matched := map[uuid.UUID]bool{}
	var out []notify.Delivery

	for _, sub := range subs {
		wantAdded := isCreate && sub.NotifyAdded
		wantCompleted := stateMoved && isTerminal && sub.NotifyCompleted
		if !wantAdded && !wantCompleted {
			continue
		}
		if r.ActorID != nil && *r.ActorID == sub.UserID {
			continue
		}

		ok, seen := matched[sub.ViewID]
		if !seen {
			ok, err = c.issueMatchesView(ctx, issue.ID, sub.ViewFilter)
			if err != nil {
				return nil, err
			}
			matched[sub.ViewID] = ok
		}
		if !ok {
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

		issueID := issue.ID
		if wantAdded && (muted == nil || !muted[model.NotifyViewIssueAdded]) {
			out = append(out, notify.Delivery{
				UserID:   sub.UserID,
				Type:     model.NotifyViewIssueAdded,
				GroupKey: viewSubGroupKey(r, model.NotifyViewIssueAdded, sub.ViewID),
				IssueID:  &issueID,
			})
		}
		if wantCompleted && (muted == nil || !muted[model.NotifyViewIssueCompleted]) {
			out = append(out, notify.Delivery{
				UserID:   sub.UserID,
				Type:     model.NotifyViewIssueCompleted,
				GroupKey: viewSubGroupKey(r, model.NotifyViewIssueCompleted, sub.ViewID),
				IssueID:  &issueID,
			})
		}
	}
	return out, nil
}

func viewSubGroupKey(r store.ChangeLog, typ string, viewID uuid.UUID) string {
	if r.BatchKey != nil && *r.BatchKey != "" {
		return fmt.Sprintf("%s:%s:%s", typ, viewID, *r.BatchKey)
	}
	return fmt.Sprintf("%s:%s:%d", typ, viewID, r.Version)
}

func (c *fanOutCache) viewSubscriptions(ctx context.Context) ([]store.ListViewSubscriptionsForFanOutRow, error) {
	if c.viewSubsLoaded {
		return c.viewSubs, nil
	}
	rows, err := c.q.ListViewSubscriptionsForFanOut(ctx, c.workspaceID)
	if err != nil {
		return nil, platform.Internal(fmt.Errorf("fan-out: read view subscriptions: %w", err))
	}
	c.viewSubs = rows
	c.viewSubsLoaded = true
	return rows, nil
}

func (c *fanOutCache) issueMatchesView(ctx context.Context, issueID uuid.UUID, raw json.RawMessage) (bool, error) {
	node, err := filter.Parse(raw)
	if err != nil {
		// A view whose filter the compiler no longer accepts must not stall the workspace
		// inbox. It also must not match everything: that would spam every subscriber of a
		// broken view. Treat it as matching nothing and move on.
		platform.Log(ctx).Error("fan-out: view filter does not compile; skipping",
			"workspace", c.workspaceID, "error", err)
		return false, nil
	}
	compiled, err := filter.Compile(node, filter.Options{
		Alias:     "issue",
		Now:       time.Now(),
		ArgOffset: 1,
	})
	if err != nil {
		platform.Log(ctx).Error("fan-out: view filter does not compile; skipping",
			"workspace", c.workspaceID, "error", err)
		return false, nil
	}
	ok, err := c.q.IssueMatchesFilter(ctx, issueID, compiled.SQL, compiled.Args)
	if err != nil {
		return false, platform.Internal(fmt.Errorf("fan-out: match view filter: %w", err))
	}
	return ok, nil
}
