package domain

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Billing: the only production code that writes a workspace's plan.
//
// `workspace.plan`, `seat_limit`, `plan_expires_at` and `plan_lapsed_at` are what the
// entire entitlement matrix resolves against, and until this file existed nothing wrote
// any of them outside a test fixture — the lapse rule was implemented, tested, wired into
// every gated write, and unreachable, because no code ever set the column that triggers it.
//
// Neither entry point here takes an *authz.Principal, and that is the design rather than an
// omission. Every other mutation in this package takes one because a request caused it;
// these two are caused by a payment provider and a clock. A plan is a fact about a
// subscription, not something a request may set, which is why nothing in the GraphQL schema
// leads here and no mutation input carries a `plan` field. If one ever does, this comment is
// the thing it contradicts: a workspace that can upgrade itself by sending a mutation is a
// paywall with a public bypass.

// PlanLapseGrace is how long a subscription may sit past due before the workspace's gated
// writes narrow to the free tier.
//
// Seven days, and the number is a dunning window rather than a technical one: a card
// expires, the retry cycle runs, somebody comes back from a week off and updates it. Making
// it shorter turns an expired card into a same-week outage for a customer who intends to
// pay; making it much longer means the product is free for anyone willing to let a payment
// fail. Nothing is lost either way — a lapse narrows writes, never reads.
const PlanLapseGrace = 7 * 24 * time.Hour

// SubscriptionStatus is our vocabulary for where a subscription stands, not the payment
// provider's. Provider adapters map into this set, so a processor inventing a state is a
// mapping change in Go rather than a webhook that cannot be written down — and a billing
// event we failed to persist is the one failure here that silently costs money.
//
// The values match the subscription_status_check constraint in migration 000077.
type SubscriptionStatus string

const (
	SubscriptionTrialing SubscriptionStatus = "trialing"
	SubscriptionActive   SubscriptionStatus = "active"
	SubscriptionPastDue  SubscriptionStatus = "past_due"
	SubscriptionCanceled SubscriptionStatus = "canceled"
	SubscriptionPaused   SubscriptionStatus = "paused"
)

func (s SubscriptionStatus) Valid() bool {
	switch s {
	case SubscriptionTrialing, SubscriptionActive, SubscriptionPastDue,
		SubscriptionCanceled, SubscriptionPaused:
		return true
	}
	return false
}

// healthy reports whether the provider considers the account paid up. A trial counts: the
// customer is entitled to everything the plan gives while it runs, and the day it stops
// being true the provider says so.
func (s SubscriptionStatus) healthy() bool {
	return s == SubscriptionTrialing || s == SubscriptionActive
}

// SubscriptionState is everything a payment provider has just told us about one workspace,
// plus what that means for the workspace's entitlements.
//
// It is a whole state and not a patch. Billing events arrive out of order and get replayed,
// so an apply that merged into whatever was already there would let a stale webhook
// resurrect last month's seat deal; restating everything makes the newest event win outright
// and makes a replay a no-op.
type SubscriptionState struct {
	WorkspaceID uuid.UUID

	// Provider is the processor this came from ('stripe'). CustomerID and SubscriptionID
	// are its identifiers and are meaningless without it.
	Provider   string
	CustomerID string
	// SubscriptionID is nil while a customer exists but has never completed a checkout.
	SubscriptionID *string

	Status SubscriptionStatus

	// CurrentPeriodEnd is the end of the period that has been paid for. It is also what
	// workspace.plan_expires_at is set from — one fact with one source, because the lapse
	// job measures its grace against this column and a second copy that drifted would put
	// two servers on different sides of the same deadline.
	CurrentPeriodEnd *time.Time

	// SeatsPaid is how many seats are being billed. Recorded, not enforced: see SeatLimit.
	SeatsPaid *int

	// Plan is the tier the workspace is entitled to. The provider adapter derives it from
	// the price the customer is on; this package does not know about prices.
	Plan entitlement.Plan

	// SeatLimit pins the workspace's seat ceiling, overriding the plan's own. nil means
	// "whatever the plan says", which is the normal answer for a metered per-seat plan:
	// adding a person is billed by proration, not refused, and a Pro workspace that could
	// not invite its next hire until somebody edited a subscription would be a worse
	// product than the free tier. Set it only for a capped deal — that is what the column
	// was added for.
	SeatLimit *int
}

// ApplySubscription records what the provider said and moves the workspace onto the plan it
// implies, in one transaction.
//
// Both halves or neither. A subscription row saying "active, pro" beside a workspace still
// on free is a customer paying for a product they cannot use, and the reverse is a workspace
// on Enterprise with no record of why — the first is a support ticket, the second is one
// nobody opens.
//
// It clears plan_lapsed_at when the subscription is healthy, and never sets it. A recovered
// payment restores writes on the spot rather than at the next tick of the sweep, because the
// customer is watching; deciding that an account has been past due long enough to lapse is
// SweepLapsedPlans's job, since it is the only thing that knows how long.
func (s *Service) ApplySubscription(
	ctx context.Context, in SubscriptionState,
) (model.Workspace, int64, error) {
	if err := in.validate(); err != nil {
		return model.Workspace{}, 0, err
	}

	var (
		out     model.Workspace
		version int64
	)
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if _, err := q.UpsertSubscription(ctx, store.UpsertSubscriptionParams{
			// Only used when the row is new; the upsert leaves an existing row's id alone.
			ID:                     uuid.Must(uuid.NewV7()),
			WorkspaceID:            in.WorkspaceID,
			Provider:               in.Provider,
			ProviderCustomerID:     in.CustomerID,
			ProviderSubscriptionID: in.SubscriptionID,
			Status:                 string(in.Status),
			CurrentPeriodEnd:       in.CurrentPeriodEnd,
			SeatsPaid:              int32PtrFromInt(in.SeatsPaid),
		}); err != nil {
			if store.IsForeignKeyViolation(err) {
				return platform.NotFound("workspace")
			}
			if store.IsUniqueViolation(err, "subscription_provider_subscription_key") {
				// One provider subscription pointing at two workspaces bills one company
				// and entitles two. Refusing is the only safe answer: the adapter has the
				// customer id and can say which workspace it meant.
				return platform.Conflict("that subscription is already linked to another workspace")
			}
			return platform.Internal(err)
		}

		row, err := q.ApplyWorkspacePlan(ctx, store.ApplyWorkspacePlanParams{
			ID:            in.WorkspaceID,
			Plan:          string(in.Plan),
			SeatLimit:     int32PtrFromInt(in.SeatLimit),
			PlanExpiresAt: in.CurrentPeriodEnd,
			// A free plan cannot lapse, so a cancellation that lands the workspace back on
			// free clears the flag too — leaving the timestamp behind would be a column
			// saying something untrue about a workspace that owes nothing.
			ClearLapsed: in.Status.healthy() || in.Plan == entitlement.PlanFree,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("workspace")
			}
			return platform.Internal(err)
		}
		out = toWorkspace(row)

		// Emitted like any other write. The plan and the lapse are on the replicated
		// workspace row, so every open client learns that its gates moved without waiting
		// for a reload — which for a recovered payment is the difference between "it works
		// again" and "it still says I have to upgrade".
		version, err = s.em.Emit(ctx, q, in.WorkspaceID, authz.SystemActor(), Change{
			EntityType: "workspace", EntityID: out.ID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: out,
		})
		return err
	})
	if err != nil {
		return model.Workspace{}, 0, err
	}
	return out, version, nil
}

func (in SubscriptionState) validate() error {
	if in.WorkspaceID == uuid.Nil {
		return platform.Validation("workspaceID", "a subscription must name a workspace")
	}
	if in.Provider == "" {
		return platform.Validation("provider", "a subscription must name its payment provider")
	}
	if in.CustomerID == "" {
		return platform.Validation("customerID", "a subscription must name the provider's customer")
	}
	if !in.Status.Valid() {
		return platform.Validation("status", fmt.Sprintf("unknown subscription status %q", in.Status))
	}
	if !in.Plan.Valid() {
		return platform.Validation("plan", fmt.Sprintf("unknown plan %q", in.Plan))
	}
	// self_hosted is not something anybody can buy: it is what an install someone runs
	// themselves already is. Selling it would put a cloud workspace on the one plan whose
	// meaning is "nobody is billing this".
	if in.Plan == entitlement.PlanSelfHosted {
		return platform.Validation("plan", "self_hosted is not a plan a subscription can grant")
	}
	if in.SeatsPaid != nil && *in.SeatsPaid <= 0 {
		return platform.Validation("seatsPaid", "a subscription bills at least one seat")
	}
	if in.SeatLimit != nil && *in.SeatLimit <= 0 {
		// Not merely invalid: it is the value that locks a workspace out of every seat it
		// has, and the database rejects it too (workspace_seat_limit_positive).
		return platform.Validation("seatLimit", "a seat limit must be at least one")
	}
	return nil
}

// SweepLapsedPlans marks workspaces whose subscription has been past due beyond the grace
// window, and lifts the mark from the ones that have recovered. It is the job the comments
// on entitlement.Facts.PlanLapsedAt and entitlementSetFor have referred to since the lapse
// rule was written.
//
// Idempotent by construction rather than by bookkeeping: both statements restate the
// condition their listing query already checked, so a second pass, a second worker, or a
// webhook applying a recovery mid-sweep writes nothing instead of overwriting a fresher
// answer with a stale one.
//
// Whether a plan has lapsed is decided here and nowhere else. internal/entitlement
// deliberately has no clock and never re-derives it from plan_expires_at, because two places
// deciding is how a workspace comes back lapsed on one server and not on another for the
// width of a clock skew.
//
// Returns the number of workspaces whose lapse state actually changed.
func (s *Service) SweepLapsedPlans(ctx context.Context, now time.Time) (int, error) {
	cutoff := now.Add(-PlanLapseGrace)

	lapse, err := s.db.Queries().ListSubscriptionsPastDueBeyondGrace(ctx, cutoff)
	if err != nil {
		return 0, platform.Internal(err)
	}
	recovered, err := s.db.Queries().ListSubscriptionsRecoveredFromLapse(ctx, cutoff)
	if err != nil {
		return 0, platform.Internal(err)
	}

	changed := 0
	for _, workspaceID := range lapse {
		ok, err := s.setLapse(ctx, workspaceID, &now)
		if err != nil {
			// The workspace that failed is named and the sweep stops. The next tick starts
			// from the same listing minus whatever already landed, so nothing is skipped —
			// and carrying on past a database error would turn one bad workspace into a log
			// line per workspace, every hour, until somebody muted the job.
			return changed, fmt.Errorf("lapse workspace %s: %w", workspaceID, err)
		}
		if ok {
			changed++
		}
	}
	for _, workspaceID := range recovered {
		ok, err := s.setLapse(ctx, workspaceID, nil)
		if err != nil {
			return changed, fmt.Errorf("restore workspace %s: %w", workspaceID, err)
		}
		if ok {
			changed++
		}
	}
	return changed, nil
}

// setLapse writes one workspace's lapse state and emits it. lapsedAt nil clears the mark.
// Reports whether anything changed: the guarded UPDATE answers no rows when another pass
// got there first, which is the expected outcome and not an error.
func (s *Service) setLapse(ctx context.Context, workspaceID uuid.UUID, lapsedAt *time.Time) (bool, error) {
	changed := false
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		var (
			row store.Workspace
			err error
		)
		if lapsedAt != nil {
			row, err = q.MarkWorkspacePlanLapsed(ctx, store.MarkWorkspacePlanLapsedParams{
				ID: workspaceID, LapsedAt: lapsedAt,
			})
		} else {
			row, err = q.ClearWorkspacePlanLapsed(ctx, workspaceID)
		}
		if err != nil {
			if store.IsNotFound(err) {
				return nil
			}
			return platform.Internal(err)
		}
		changed = true

		// Same emit as any other workspace write. Without it a lapsed workspace's clients
		// keep drawing every gated control as available until they next reload, and a
		// recovered one keeps drawing the paywall.
		_, err = s.em.Emit(ctx, q, workspaceID, authz.SystemActor(), Change{
			EntityType: "workspace", EntityID: workspaceID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: toWorkspace(row),
		})
		return err
	})
	return changed, err
}

// int32PtrFromInt and intPtrFromInt32 convert a nullable seat count between the column's
// width and the policy layer's. nil survives both ways, because nil means "whatever the plan
// says" and that is a different claim from any number.
func int32PtrFromInt(n *int) *int32 {
	if n == nil {
		return nil
	}
	v := int32(*n)
	return &v
}

func intPtrFromInt32(n *int32) *int {
	if n == nil {
		return nil
	}
	v := int(*n)
	return &v
}
