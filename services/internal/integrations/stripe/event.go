// Package stripe adapts Stripe's REST API and webhook events to the vocabulary the billing
// domain speaks. Nothing outside this package knows what a price id is.
package stripe

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
)

// Provider is the value written to subscription.provider for everything this package emits.
const Provider = "stripe"

// WorkspaceMetadataKey is the metadata field carrying the workspace a subscription belongs
// to. Set on the subscription at checkout, which is why later subscription.* events can be
// resolved without a lookup table: the answer travels with the object.
const WorkspaceMetadataKey = "polaris_workspace_id"

// Event is the sliver of a Stripe webhook envelope this product reads.
type Event struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Data struct {
		// Raw, because the shape depends on Type and decoding it twice is cheaper than a
		// struct that is the union of a checkout session and a subscription.
		Object json.RawMessage `json:"object"`
	} `json:"data"`
}

// Subscription is Stripe's subscription object, narrowed to what the plan depends on.
type Subscription struct {
	ID       string `json:"id"`
	Customer string `json:"customer"`
	Status   string `json:"status"`
	// CurrentPeriodEnd moved onto the individual items in Stripe's 2025 API versions and
	// is still sent at the top level by older ones. Both are read; see periodEnd.
	CurrentPeriodEnd int64             `json:"current_period_end"`
	Metadata         map[string]string `json:"metadata"`
	Items            struct {
		Data []struct {
			Quantity         int   `json:"quantity"`
			CurrentPeriodEnd int64 `json:"current_period_end"`
			Price            struct {
				ID string `json:"id"`
			} `json:"price"`
		} `json:"data"`
	} `json:"items"`
}

// CheckoutSession is the completed-checkout object, narrowed the same way.
type CheckoutSession struct {
	ID                string            `json:"id"`
	Customer          string            `json:"customer"`
	Subscription      string            `json:"subscription"`
	ClientReferenceID string            `json:"client_reference_id"`
	Metadata          map[string]string `json:"metadata"`
}

// PriceMap says which plan a price id sells.
type PriceMap struct {
	Pro        []string
	Enterprise []string
}

// PlanFor resolves a price id to the plan it entitles.
//
// An unrecognised price resolves to Pro rather than to an error, and that is a deliberate
// bias toward the customer. Every price in this Stripe account exists because somebody
// bought hosted Polaris, and the cheapest thing they can have bought is Pro. The failure
// this avoids is a customer who paid, holds a live subscription, and is refused the product
// because somebody added a price in the dashboard and did not redeploy — a silent, total
// outage for exactly the people who are paying. The failure it accepts is that a new
// Enterprise price bills as Enterprise but entitles as Pro until the config catches up,
// which is a support conversation rather than a paywall in a paying customer's face.
// `stripeUnmappedPrice` is logged either way.
func (m PriceMap) PlanFor(priceID string) (entitlement.Plan, bool) {
	for _, id := range m.Enterprise {
		if id != "" && id == priceID {
			return entitlement.PlanEnterprise, true
		}
	}
	for _, id := range m.Pro {
		if id != "" && id == priceID {
			return entitlement.PlanPro, true
		}
	}
	return entitlement.PlanPro, false
}

// statusFor maps Stripe's subscription status vocabulary onto ours.
//
// `incomplete` and `incomplete_expired` mean the first payment never succeeded, so they map
// to canceled rather than to trialing: nothing was paid, and the workspace must not hold a
// paid plan on the strength of an abandoned checkout. `unpaid` is what a subscription
// becomes when dunning gives up, which is past due that has run out of retries — it keeps
// past_due so the lapse grace in the domain measures it the same way.
func statusFor(status string) (domain.SubscriptionStatus, error) {
	switch status {
	case "trialing":
		return domain.SubscriptionTrialing, nil
	case "active":
		return domain.SubscriptionActive, nil
	case "past_due", "unpaid":
		return domain.SubscriptionPastDue, nil
	case "canceled", "incomplete", "incomplete_expired":
		return domain.SubscriptionCanceled, nil
	case "paused":
		return domain.SubscriptionPaused, nil
	default:
		return "", fmt.Errorf("stripe: unknown subscription status %q", status)
	}
}

// StateFor turns a Stripe subscription into the state the domain applies.
//
// The workspace comes from the subscription's own metadata. A subscription without it
// cannot be attributed and is refused here rather than guessed at: applying a plan to the
// wrong workspace entitles a company that did not pay and, worse, moves the one that did.
func StateFor(sub Subscription, prices PriceMap) (domain.SubscriptionState, bool, error) {
	raw := sub.Metadata[WorkspaceMetadataKey]
	workspaceID, err := uuid.Parse(raw)
	if err != nil {
		return domain.SubscriptionState{}, false, fmt.Errorf(
			"stripe: subscription %s carries no usable %s", sub.ID, WorkspaceMetadataKey)
	}

	status, err := statusFor(sub.Status)
	if err != nil {
		return domain.SubscriptionState{}, false, err
	}

	plan, mapped := entitlement.PlanPro, true
	if len(sub.Items.Data) > 0 {
		plan, mapped = prices.PlanFor(sub.Items.Data[0].Price.ID)
	}
	// A subscription that has ended entitles nothing. Recording the plan it used to be on
	// would leave a canceled customer holding Pro until something else wrote the row.
	if status == domain.SubscriptionCanceled {
		plan = entitlement.PlanFree
	}

	state := domain.SubscriptionState{
		WorkspaceID:    workspaceID,
		Provider:       Provider,
		CustomerID:     sub.Customer,
		SubscriptionID: &sub.ID,
		Status:         status,
		Plan:           plan,
	}
	if end := periodEnd(sub); !end.IsZero() {
		state.CurrentPeriodEnd = &end
	}
	if len(sub.Items.Data) > 0 && sub.Items.Data[0].Quantity > 0 {
		seats := sub.Items.Data[0].Quantity
		state.SeatsPaid = &seats
	}
	return state, mapped, nil
}

// periodEnd reads whichever of the two places Stripe puts the paid-through date carries it.
func periodEnd(sub Subscription) time.Time {
	if sub.CurrentPeriodEnd > 0 {
		return time.Unix(sub.CurrentPeriodEnd, 0).UTC()
	}
	for _, item := range sub.Items.Data {
		if item.CurrentPeriodEnd > 0 {
			return time.Unix(item.CurrentPeriodEnd, 0).UTC()
		}
	}
	return time.Time{}
}
