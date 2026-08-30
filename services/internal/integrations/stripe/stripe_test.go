package stripe

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
)

const (
	proMonthly = "price_pro_monthly"
	proYearly  = "price_pro_yearly"
	entPrice   = "price_enterprise"
)

func prices() PriceMap {
	return PriceMap{Pro: []string{proMonthly, proYearly}, Enterprise: []string{entPrice}}
}

func subscriptionJSON(workspaceID, status, priceID string, quantity int, periodEnd int64) []byte {
	sub := map[string]any{
		"id":                 "sub_123",
		"customer":           "cus_123",
		"status":             status,
		"current_period_end": periodEnd,
		"metadata":           map[string]string{WorkspaceMetadataKey: workspaceID},
		"items": map[string]any{
			"data": []any{map[string]any{
				"quantity": quantity,
				"price":    map[string]string{"id": priceID},
			}},
		},
	}
	raw, err := json.Marshal(sub)
	if err != nil {
		panic(err)
	}
	return raw
}

func decodeSub(t *testing.T, raw []byte) Subscription {
	t.Helper()
	var sub Subscription
	if err := json.Unmarshal(raw, &sub); err != nil {
		t.Fatalf("decoding the fixture: %v", err)
	}
	return sub
}

func TestStateForActiveSubscription(t *testing.T) {
	workspace := uuid.Must(uuid.NewV7())
	end := time.Now().Add(20 * 24 * time.Hour).Unix()
	sub := decodeSub(t, subscriptionJSON(workspace.String(), "active", proMonthly, 7, end))

	state, mapped, err := StateFor(sub, prices())
	if err != nil {
		t.Fatalf("StateFor: %v", err)
	}
	if !mapped {
		t.Fatal("a configured price reported as unmapped")
	}
	if state.WorkspaceID != workspace {
		t.Fatalf("workspace = %s, want %s", state.WorkspaceID, workspace)
	}
	if state.Plan != entitlement.PlanPro || state.Status != domain.SubscriptionActive {
		t.Fatalf("plan/status = %s/%s", state.Plan, state.Status)
	}
	if state.SeatsPaid == nil || *state.SeatsPaid != 7 {
		t.Fatalf("seats = %v, want 7", state.SeatsPaid)
	}
	if state.CurrentPeriodEnd == nil || state.CurrentPeriodEnd.Unix() != end {
		t.Fatalf("period end = %v, want %d", state.CurrentPeriodEnd, end)
	}
	if state.Provider != Provider || state.SubscriptionID == nil || *state.SubscriptionID != "sub_123" {
		t.Fatalf("provider identifiers not carried through: %+v", state)
	}
	// A per-seat plan is billed by proration, not capped. Pinning the ceiling here would
	// refuse the customer's next hire until somebody edited the subscription.
	if state.SeatLimit != nil {
		t.Fatalf("seat limit = %v, want nil for a metered plan", *state.SeatLimit)
	}
}

func TestStateForEnterprisePrice(t *testing.T) {
	sub := decodeSub(t, subscriptionJSON(uuid.Must(uuid.NewV7()).String(), "active", entPrice, 40, 0))
	state, _, err := StateFor(sub, prices())
	if err != nil {
		t.Fatalf("StateFor: %v", err)
	}
	if state.Plan != entitlement.PlanEnterprise {
		t.Fatalf("plan = %s, want enterprise", state.Plan)
	}
}

// A price nobody configured still entitles Pro, and says it was unmapped so the caller can
// log it. Refusing would take the product away from a customer who is paying for it.
func TestStateForUnmappedPrice(t *testing.T) {
	sub := decodeSub(t, subscriptionJSON(uuid.Must(uuid.NewV7()).String(), "active", "price_new", 3, 0))
	state, mapped, err := StateFor(sub, prices())
	if err != nil {
		t.Fatalf("StateFor: %v", err)
	}
	if mapped {
		t.Fatal("an unconfigured price reported as mapped")
	}
	if state.Plan != entitlement.PlanPro {
		t.Fatalf("plan = %s, want pro", state.Plan)
	}
}

func TestStateForStatusMapping(t *testing.T) {
	cases := map[string]struct {
		want domain.SubscriptionStatus
		plan entitlement.Plan
	}{
		"active":             {domain.SubscriptionActive, entitlement.PlanPro},
		"trialing":           {domain.SubscriptionTrialing, entitlement.PlanPro},
		"past_due":           {domain.SubscriptionPastDue, entitlement.PlanPro},
		"unpaid":             {domain.SubscriptionPastDue, entitlement.PlanPro},
		"paused":             {domain.SubscriptionPaused, entitlement.PlanPro},
		"canceled":           {domain.SubscriptionCanceled, entitlement.PlanFree},
		"incomplete":         {domain.SubscriptionCanceled, entitlement.PlanFree},
		"incomplete_expired": {domain.SubscriptionCanceled, entitlement.PlanFree},
	}
	for status, want := range cases {
		t.Run(status, func(t *testing.T) {
			sub := decodeSub(t, subscriptionJSON(uuid.Must(uuid.NewV7()).String(), status, proMonthly, 2, 0))
			state, _, err := StateFor(sub, prices())
			if err != nil {
				t.Fatalf("StateFor: %v", err)
			}
			if state.Status != want.want {
				t.Fatalf("status = %s, want %s", state.Status, want.want)
			}
			// A dead subscription entitles nothing, whatever price it was on.
			if state.Plan != want.plan {
				t.Fatalf("plan = %s, want %s", state.Plan, want.plan)
			}
		})
	}
}

func TestStateForRejectsUnattributableSubscription(t *testing.T) {
	for _, metadata := range []string{"", "not-a-uuid"} {
		sub := decodeSub(t, subscriptionJSON(metadata, "active", proMonthly, 1, 0))
		if _, _, err := StateFor(sub, prices()); err == nil {
			t.Fatalf("accepted a subscription whose workspace metadata was %q", metadata)
		}
	}
}

func TestStateForUnknownStatusIsAnError(t *testing.T) {
	sub := decodeSub(t, subscriptionJSON(uuid.Must(uuid.NewV7()).String(), "quantum", proMonthly, 1, 0))
	if _, _, err := StateFor(sub, prices()); err == nil {
		t.Fatal("accepted a status this product has no word for")
	}
}

// Stripe's newer API versions put the paid-through date on the item rather than the
// subscription. Reading only the old place would leave plan_expires_at empty and hand the
// lapse sweep a workspace with no deadline.
func TestPeriodEndFallsBackToTheItem(t *testing.T) {
	raw := []byte(`{"id":"sub_1","customer":"cus_1","status":"active",
	  "metadata":{"` + WorkspaceMetadataKey + `":"` + uuid.Must(uuid.NewV7()).String() + `"},
	  "items":{"data":[{"quantity":3,"current_period_end":1893456000,
	    "price":{"id":"` + proMonthly + `"}}]}}`)
	state, _, err := StateFor(decodeSub(t, raw), prices())
	if err != nil {
		t.Fatalf("StateFor: %v", err)
	}
	if state.CurrentPeriodEnd == nil || state.CurrentPeriodEnd.Unix() != 1893456000 {
		t.Fatalf("period end = %v, want the item's", state.CurrentPeriodEnd)
	}
}

func TestNewClientIsNilWithoutAKey(t *testing.T) {
	if NewClient("  ", "", time.Second) != nil {
		t.Fatal("a client was built with no secret key")
	}
}

func TestCreateCheckoutSession(t *testing.T) {
	workspace := uuid.Must(uuid.NewV7()).String()
	var got url.Values
	var auth string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/checkout/sessions" {
			t.Errorf("path = %s", r.URL.Path)
		}
		auth = r.Header.Get("Authorization")
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parsing the form: %v", err)
		}
		got = r.PostForm
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"cs_1","url":"https://checkout.stripe.com/c/pay/cs_1"}`))
	}))
	defer server.Close()

	client := NewClient("sk_test_key", server.URL, 5*time.Second)
	url, err := client.CreateCheckoutSession(context.Background(), CheckoutInput{
		WorkspaceID:   workspace,
		PriceID:       proMonthly,
		Seats:         4,
		CustomerEmail: "owner@example.com",
		SuccessURL:    "https://polaris.example/settings/billing?checkout=done",
		CancelURL:     "https://polaris.example/settings/billing",
	})
	if err != nil {
		t.Fatalf("CreateCheckoutSession: %v", err)
	}
	if url != "https://checkout.stripe.com/c/pay/cs_1" {
		t.Fatalf("url = %s", url)
	}
	if auth != "Bearer sk_test_key" {
		t.Fatalf("authorization = %q", auth)
	}
	if got.Get("mode") != "subscription" || got.Get("line_items[0][quantity]") != "4" {
		t.Fatalf("form = %v", got)
	}
	// The one field that matters after checkout: it is what puts the workspace on the
	// subscription, so every later webhook can say who it is about.
	if got.Get("subscription_data[metadata]["+WorkspaceMetadataKey+"]") != workspace {
		t.Fatalf("the subscription metadata did not carry the workspace: %v", got)
	}
	if got.Get("customer_email") != "owner@example.com" {
		t.Fatalf("customer email = %q", got.Get("customer_email"))
	}
	// Stripe refuses a session that names both, so only one is ever sent.
	if got.Has("customer") {
		t.Fatal("sent customer and customer_email together")
	}
	if got.Has("automatic_tax[enabled]") {
		t.Fatal("asked for Stripe Tax without being told to")
	}
}

func TestCreateCheckoutSessionPrefersAnExistingCustomer(t *testing.T) {
	var got url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		got = r.PostForm
		_, _ = w.Write([]byte(`{"url":"https://checkout.stripe.com/c/pay/cs_2"}`))
	}))
	defer server.Close()

	client := NewClient("sk_test_key", server.URL, 5*time.Second)
	if _, err := client.CreateCheckoutSession(context.Background(), CheckoutInput{
		WorkspaceID: uuid.Must(uuid.NewV7()).String(), PriceID: proMonthly, Seats: 1,
		CustomerID: "cus_existing", CustomerEmail: "owner@example.com", AutomaticTax: true,
	}); err != nil {
		t.Fatalf("CreateCheckoutSession: %v", err)
	}
	if got.Get("customer") != "cus_existing" || got.Has("customer_email") {
		t.Fatalf("form = %v", got)
	}
	if got.Get("automatic_tax[enabled]") != "true" {
		t.Fatal("Stripe Tax was asked for and not sent")
	}
}

// Stripe's message is the only thing that says which price id was wrong, and it is worth
// carrying into the caller's error rather than reporting "500 from Stripe".
func TestClientCarriesStripesErrorMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"No such price: 'price_typo'","code":"resource_missing"}}`))
	}))
	defer server.Close()

	client := NewClient("sk_test_key", server.URL, 5*time.Second)
	_, err := client.CreateCheckoutSession(context.Background(), CheckoutInput{PriceID: "price_typo", Seats: 1})
	if err == nil {
		t.Fatal("a 400 came back as success")
	}
	if want := "No such price"; !strings.Contains(err.Error(), want) {
		t.Fatalf("error = %q, want it to carry %q", err, want)
	}
}

func TestGetSubscriptionAndPortal(t *testing.T) {
	workspace := uuid.Must(uuid.NewV7()).String()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/subscriptions/sub_123":
			_, _ = w.Write(subscriptionJSON(workspace, "active", proMonthly, 2, 1893456000))
		case "/v1/billing_portal/sessions":
			_, _ = w.Write([]byte(`{"url":"https://billing.stripe.com/p/session/x"}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := NewClient("sk_test_key", server.URL, 5*time.Second)
	sub, err := client.GetSubscription(context.Background(), "sub_123")
	if err != nil {
		t.Fatalf("GetSubscription: %v", err)
	}
	if sub.Status != "active" || sub.Metadata[WorkspaceMetadataKey] != workspace {
		t.Fatalf("subscription = %+v", sub)
	}

	portal, err := client.CreatePortalSession(context.Background(), "cus_123", "https://polaris.example/settings/billing")
	if err != nil {
		t.Fatalf("CreatePortalSession: %v", err)
	}
	if portal != "https://billing.stripe.com/p/session/x" {
		t.Fatalf("portal url = %s", portal)
	}
}
