package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	stripein "github.com/peixotolabs/polaris/services/internal/integrations/stripe"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// stripeMaxBody caps a webhook delivery. Stripe's events are kilobytes; an invoice with
// hundreds of lines is still far inside this.
const stripeMaxBody = 1 << 20

type billingHandlers struct {
	svc    *domain.Service
	client *stripein.Client
	// prices is the price-id to plan map, built from config once at wiring time.
	prices stripein.PriceMap
	// monthly and yearly are the two prices a checkout may be opened at.
	monthly, yearly string
	webhookSecret   string
	publicURL       string
	automaticTax    bool
	replay          *platform.ReplayGuard
}

// enabled reports whether this deployment can sell anything. Mirrors Config.BillingEnabled,
// against the parts that actually reached the handler.
func (h *billingHandlers) enabled() bool {
	return h.client != nil && h.webhookSecret != "" && h.monthly != ""
}

// config answers the one question the marketing pages ask: can anybody buy this?
//
// Anonymous and cacheable-cheap, because the pricing page is rendered for people who have
// no account. It carries no price ids and no keys — only the boolean. A page that assumed
// billing worked would put a "Get started" button on a plan the server cannot sell, which
// is the exact failure this endpoint exists to prevent.
func (h *billingHandlers) config(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": h.enabled()})
}

// state is the administrator's view of their own subscription.
func (h *billingHandlers) state(w http.ResponseWriter, r *http.Request) {
	p, ok := authz.PrincipalFrom(r.Context())
	if !ok {
		writeError(w, r, platform.Unauthorized("this request must name a workspace"))
		return
	}
	record, err := h.svc.BillingFor(r.Context(), p)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":          h.enabled(),
		"plan":             string(record.Plan),
		"status":           string(record.Status),
		"seatsUsed":        record.SeatsUsed,
		"seatsPaid":        record.SeatsPaid,
		"currentPeriodEnd": record.CurrentPeriodEnd,
		"lapsed":           record.Lapsed,
		"hasSubscription":  record.SubscriptionID != nil,
		"canManage":        record.CustomerID != "",
	})
}

type checkoutRequest struct {
	// Interval is "monthly" or "yearly". Not a price id: a client that could name the price
	// could name a cheaper one, and the price a workspace is charged is not a client's
	// decision.
	Interval string `json:"interval"`
}

// checkout opens a Stripe Checkout session for the caller's workspace.
func (h *billingHandlers) checkout(w http.ResponseWriter, r *http.Request) {
	p, ok := authz.PrincipalFrom(r.Context())
	if !ok {
		writeError(w, r, platform.Unauthorized("this request must name a workspace"))
		return
	}
	if !h.enabled() {
		writeError(w, r, platform.Validation("", "this deployment has no billing configured"))
		return
	}

	var body checkoutRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&body); err != nil && err != io.EOF {
		writeError(w, r, platform.Validation("", "could not read the request body"))
		return
	}
	price := h.monthly
	switch strings.TrimSpace(body.Interval) {
	case "", "monthly":
	case "yearly":
		if h.yearly == "" {
			writeError(w, r, platform.Validation("interval", "this deployment sells no annual price"))
			return
		}
		price = h.yearly
	default:
		writeError(w, r, platform.Validation("interval", "must be monthly or yearly"))
		return
	}

	// BillingFor is the authorization check as well as the read: it refuses anybody who is
	// not an administrator, which is the same gate the portal and the state endpoint use.
	record, err := h.svc.BillingFor(r.Context(), p)
	if err != nil {
		writeError(w, r, err)
		return
	}

	base := strings.TrimRight(h.publicURL, "/")
	url, err := h.client.CreateCheckoutSession(r.Context(), stripein.CheckoutInput{
		WorkspaceID: p.WorkspaceID.String(),
		PriceID:     price,
		// Seats are what the workspace uses today. Stripe prorates from here, so this is a
		// starting quantity rather than a ceiling — see the SeatLimit comment in the domain.
		Seats: record.SeatsUsed,
		// Reusing the customer keeps one company's invoices, tax ids and cards on one
		// record instead of scattering them over a new customer per purchase.
		CustomerID:   record.CustomerID,
		SuccessURL:   base + "/settings/billing?checkout=done",
		CancelURL:    base + "/settings/billing?checkout=cancelled",
		AutomaticTax: h.automaticTax,
	})
	if err != nil {
		platform.Log(r.Context()).Error("stripe checkout session failed",
			"workspace", p.WorkspaceID, "error", err)
		writeError(w, r, platform.Internal(err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url})
}

// portal opens Stripe's billing portal, where a card is changed and a plan is cancelled.
func (h *billingHandlers) portal(w http.ResponseWriter, r *http.Request) {
	p, ok := authz.PrincipalFrom(r.Context())
	if !ok {
		writeError(w, r, platform.Unauthorized("this request must name a workspace"))
		return
	}
	if !h.enabled() {
		writeError(w, r, platform.Validation("", "this deployment has no billing configured"))
		return
	}
	record, err := h.svc.BillingFor(r.Context(), p)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if record.CustomerID == "" {
		writeError(w, r, platform.Validation("", "this workspace has never been through a checkout"))
		return
	}
	url, err := h.client.CreatePortalSession(
		r.Context(), record.CustomerID, strings.TrimRight(h.publicURL, "/")+"/settings/billing")
	if err != nil {
		platform.Log(r.Context()).Error("stripe portal session failed",
			"workspace", p.WorkspaceID, "error", err)
		writeError(w, r, platform.Internal(err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url})
}

// webhook is where money becomes an entitlement.
//
// Everything before ApplySubscription is refusal: an unsigned delivery, a delivery outside
// the tolerance window, a replay, an event about something else. A 200 with an "ignored"
// body is the answer to every event we do not act on, because Stripe retries anything else
// for days and a permanent 400 on an event type we simply do not read would fill an
// operator's dashboard with failures that mean nothing.
func (h *billingHandlers) webhook(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, stripeMaxBody)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, r, platform.Validation("", "could not read the request body"))
		return
	}
	now := time.Now()
	if !platform.StripeSignatureOK(h.webhookSecret, body, r.Header.Get("Stripe-Signature"), now) {
		// Unauthorized and not Validation: the delivery did not prove it came from Stripe,
		// and an unsigned POST to this path is either a misconfiguration or somebody trying
		// to grant themselves a plan.
		writeError(w, r, platform.Unauthorized("that delivery is not signed by Stripe"))
		return
	}

	var event stripein.Event
	if err := json.Unmarshal(body, &event); err != nil {
		writeError(w, r, platform.Validation("", "could not parse the Stripe event"))
		return
	}

	// The event id is Stripe's own idempotency key and is inside the signed payload, so a
	// replayer cannot vary it. Stripe delivers at least once by design.
	key := platform.WebhookDeliveryKey("stripe", event.Type, []byte(event.ID))
	if h.replay.Seen(key, now) {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored", "reason": "duplicate"})
		return
	}

	if h.apply(w, r, event) {
		h.replay.Record(key, now)
	}
}

// apply acts on one verified event and reports whether it finished.
//
// False leaves the delivery replayable, which is what every failure path wants: Stripe will
// send it again, and a database blip that dropped a payment on the floor is the one failure
// here that costs a customer their product.
func (h *billingHandlers) apply(w http.ResponseWriter, r *http.Request, event stripein.Event) bool {
	ctx := r.Context()
	log := platform.Log(ctx)

	var sub stripein.Subscription
	switch event.Type {
	case "customer.subscription.created",
		"customer.subscription.updated",
		"customer.subscription.deleted":
		if err := json.Unmarshal(event.Data.Object, &sub); err != nil {
			writeError(w, r, platform.Validation("", "could not parse the subscription object"))
			return false
		}

	case "checkout.session.completed":
		// The session says a purchase happened and names the subscription, but carries
		// neither its status nor what was bought. Reading the subscription is the only way
		// to apply a plan that reflects what Stripe actually created — and it is also what
		// closes the window where a customer has paid and no subscription event has arrived
		// yet.
		var session stripein.CheckoutSession
		if err := json.Unmarshal(event.Data.Object, &session); err != nil {
			writeError(w, r, platform.Validation("", "could not parse the checkout session"))
			return false
		}
		if session.Subscription == "" {
			writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored", "reason": "not a subscription checkout"})
			return true
		}
		fetched, err := h.client.GetSubscription(ctx, session.Subscription)
		if err != nil {
			log.Error("stripe: could not read the subscription a checkout created",
				"subscription", session.Subscription, "error", err)
			writeError(w, r, platform.Internal(err))
			return false
		}
		sub = fetched

	default:
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored", "reason": "unhandled event type"})
		return true
	}

	state, mapped, err := stripein.StateFor(sub, h.prices)
	if err != nil {
		// An event we cannot attribute to a workspace is not retryable — the next delivery
		// will say the same thing — so it is recorded as handled and logged loudly. This is
		// the shape of a subscription created in the Stripe dashboard by hand, without the
		// workspace metadata the checkout writes.
		log.Error("stripe: unattributable subscription event",
			"event", event.ID, "type", event.Type, "subscription", sub.ID, "error", err)
		writeJSON(w, http.StatusOK, map[string]string{"ok": "ignored", "reason": "no workspace on the subscription"})
		return true
	}
	if !mapped {
		log.Warn("stripe: subscription is on a price this deployment does not know",
			"subscription", sub.ID, "workspace", state.WorkspaceID, "plan", string(state.Plan))
	}

	if _, _, err := h.svc.ApplySubscription(ctx, state); err != nil {
		log.Error("stripe: applying a subscription failed",
			"event", event.ID, "workspace", state.WorkspaceID, "error", err)
		writeError(w, r, err)
		return false
	}
	log.Info("stripe: applied a subscription",
		"event", event.ID, "type", event.Type, "workspace", state.WorkspaceID,
		"plan", string(state.Plan), "status", string(state.Status))
	writeJSON(w, http.StatusOK, map[string]string{"ok": "applied"})
	return true
}
