package httpapi_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/auth"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	stripein "github.com/peixotolabs/polaris/services/internal/integrations/stripe"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

const (
	testWebhookSecret = "whsec_test_secret"
	testPriceMonthly  = "price_pro_monthly"
	testPriceYearly   = "price_pro_yearly"
)

type billingHarness struct {
	router  http.Handler
	fixture *testutil.Fixture
	token   string
	// stripeCalls records what was asked of the fake Stripe, so a test can assert on the
	// request the product made rather than only on what it did with the answer.
	stripeCalls *[]stripeCall
}

type stripeCall struct {
	method string
	path   string
	form   url.Values
}

// billingRouter wires the real router against a fake Stripe.
//
// The fake is an httptest server the config points at, so everything from the handler down
// through the client's form encoding is the production path; only the far end is ours.
func billingRouter(t *testing.T, configured bool, subscriptionBody func() []byte) billingHarness {
	t.Helper()

	calls := make([]stripeCall, 0, 4)
	stripe := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		calls = append(calls, stripeCall{method: r.Method, path: r.URL.Path, form: r.PostForm})
		switch {
		case r.URL.Path == "/v1/checkout/sessions":
			_, _ = w.Write([]byte(`{"id":"cs_1","url":"https://checkout.stripe.com/c/pay/cs_1"}`))
		case r.URL.Path == "/v1/billing_portal/sessions":
			_, _ = w.Write([]byte(`{"url":"https://billing.stripe.com/p/session/x"}`))
		case strings.HasPrefix(r.URL.Path, "/v1/subscriptions/"):
			if subscriptionBody == nil {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"error":{"message":"No such subscription"}}`))
				return
			}
			_, _ = w.Write(subscriptionBody())
		default:
			t.Errorf("unexpected Stripe path %s", r.URL.Path)
		}
	}))
	t.Cleanup(stripe.Close)

	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	cfg := platform.Config{
		JWTSecret:      "test-secret-long-enough-for-hmac",
		AccessTokenTTL: time.Minute,
		PublicURL:      "https://polaris.example",
		StripeBaseURL:  stripe.URL,
	}
	if configured {
		cfg.StripeSecretKey = "sk_test_key"
		cfg.StripeWebhookSecret = testWebhookSecret
		cfg.StripePriceProMonthly = testPriceMonthly
		cfg.StripePriceProYearly = testPriceYearly
	}

	tokens := httpapi.NewTokens(cfg.JWTSecret, cfg.AccessTokenTTL)
	tok, err := tokens.Issue(auth.Claims{AccountID: f.AccountID})
	if err != nil {
		t.Fatal(err)
	}
	router := httpapi.NewRouter(httpapi.Deps{
		Service: domain.NewService(db),
		Tokens:  tokens,
		Config:  cfg,
	})
	return billingHarness{router: router, fixture: f, token: tok, stripeCalls: &calls}
}

func (h billingHarness) do(t *testing.T, method, path, body string, authed bool) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if authed {
		req.Header.Set("Authorization", "Bearer "+h.token)
		req.Header.Set(httpapi.WorkspaceHeader, h.fixture.WorkspaceID.String())
	}
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	return rec
}

func signStripe(t *testing.T, body []byte, at time.Time) string {
	t.Helper()
	ts := fmt.Sprintf("%d", at.Unix())
	mac := hmac.New(sha256.New, []byte(testWebhookSecret))
	_, _ = mac.Write([]byte(ts + "."))
	_, _ = mac.Write(body)
	return fmt.Sprintf("t=%s,v1=%s", ts, hex.EncodeToString(mac.Sum(nil)))
}

func subscriptionEvent(t *testing.T, id, eventType, workspaceID, status, price string, seats int, end time.Time) []byte {
	t.Helper()
	object := map[string]any{
		"id":                 "sub_123",
		"customer":           "cus_123",
		"status":             status,
		"current_period_end": end.Unix(),
		"metadata":           map[string]string{stripein.WorkspaceMetadataKey: workspaceID},
		"items": map[string]any{"data": []any{map[string]any{
			"quantity": seats,
			"price":    map[string]string{"id": price},
		}}},
	}
	raw, err := json.Marshal(map[string]any{
		"id": id, "type": eventType, "data": map[string]any{"object": object},
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func (h billingHarness) postWebhook(t *testing.T, body []byte, signature string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/webhooks/stripe", strings.NewReader(string(body)))
	req.Header.Set("Stripe-Signature", signature)
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	return rec
}

func (h billingHarness) plan(t *testing.T) string {
	t.Helper()
	ws, err := h.fixture.DB.Queries().GetWorkspace(context.Background(), h.fixture.WorkspaceID)
	if err != nil {
		t.Fatalf("reading the workspace: %v", err)
	}
	return ws.Plan
}

// The pricing page reads this to decide whether to offer a purchase at all. A deployment
// with no Stripe credentials — every self-host — must say so.
func TestBillingConfigReportsWhetherAnybodyCanBuy(t *testing.T) {
	for _, configured := range []bool{false, true} {
		t.Run(fmt.Sprintf("configured=%v", configured), func(t *testing.T) {
			h := billingRouter(t, configured, nil)
			rec := h.do(t, http.MethodGet, "/billing/config", "", false)
			if rec.Code != http.StatusOK {
				t.Fatalf("status %d body %s", rec.Code, rec.Body)
			}
			var got struct {
				Enabled bool `json:"enabled"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if got.Enabled != configured {
				t.Fatalf("enabled = %v, want %v", got.Enabled, configured)
			}
		})
	}
}

// The whole point of the endpoint: an event Stripe signed moves the workspace onto the plan
// that was paid for, and the sync stream carries it.
func TestStripeWebhookAppliesAPaidSubscription(t *testing.T) {
	h := billingRouter(t, true, nil)
	// Whatever the fixture starts on — POLARIS_DEFAULT_PLAN decides, and it is self_hosted —
	// the point is that the paid subscription moves it.
	if got := h.plan(t); got == "pro" {
		t.Fatalf("fixture workspace already starts on pro, so this test proves nothing")
	}

	body := subscriptionEvent(t, "evt_1", "customer.subscription.created",
		h.fixture.WorkspaceID.String(), "active", testPriceMonthly, 6, time.Now().Add(30*24*time.Hour))
	rec := h.postWebhook(t, body, signStripe(t, body, time.Now()))

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
	if got := h.plan(t); got != "pro" {
		t.Fatalf("plan = %s after a paid subscription, want pro", got)
	}

	sub, err := h.fixture.DB.Queries().GetSubscription(context.Background(), h.fixture.WorkspaceID)
	if err != nil {
		t.Fatalf("no subscription row was written: %v", err)
	}
	if sub.Provider != "stripe" || sub.ProviderCustomerID != "cus_123" || sub.Status != "active" {
		t.Fatalf("subscription row = %+v", sub)
	}
	if sub.SeatsPaid == nil || *sub.SeatsPaid != 6 {
		t.Fatalf("seats paid = %v, want 6", sub.SeatsPaid)
	}
}

// A cancellation has to take the plan away, or a customer who left keeps the product.
func TestStripeWebhookCancellationReturnsTheWorkspaceToFree(t *testing.T) {
	h := billingRouter(t, true, nil)
	live := subscriptionEvent(t, "evt_live", "customer.subscription.created",
		h.fixture.WorkspaceID.String(), "active", testPriceMonthly, 3, time.Now().Add(30*24*time.Hour))
	if rec := h.postWebhook(t, live, signStripe(t, live, time.Now())); rec.Code != http.StatusOK {
		t.Fatalf("setting up the live subscription: %d %s", rec.Code, rec.Body)
	}

	dead := subscriptionEvent(t, "evt_dead", "customer.subscription.deleted",
		h.fixture.WorkspaceID.String(), "canceled", testPriceMonthly, 3, time.Now())
	if rec := h.postWebhook(t, dead, signStripe(t, dead, time.Now())); rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
	if got := h.plan(t); got != "free" {
		t.Fatalf("plan = %s after a cancellation, want free", got)
	}
}

// checkout.session.completed names a subscription without describing it, so the handler has
// to go and read the subscription before it can entitle anything.
func TestStripeWebhookReadsTheSubscriptionACheckoutCreated(t *testing.T) {
	var workspaceID string
	h := billingRouter(t, true, func() []byte {
		return []byte(`{"id":"sub_456","customer":"cus_456","status":"active",
		  "current_period_end":1893456000,
		  "metadata":{"` + stripein.WorkspaceMetadataKey + `":"` + workspaceID + `"},
		  "items":{"data":[{"quantity":4,"price":{"id":"` + testPriceMonthly + `"}}]}}`)
	})
	workspaceID = h.fixture.WorkspaceID.String()

	body, err := json.Marshal(map[string]any{
		"id": "evt_checkout", "type": "checkout.session.completed",
		"data": map[string]any{"object": map[string]any{
			"id": "cs_1", "customer": "cus_456", "subscription": "sub_456",
			"client_reference_id": workspaceID,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}

	rec := h.postWebhook(t, body, signStripe(t, body, time.Now()))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
	if got := h.plan(t); got != "pro" {
		t.Fatalf("plan = %s after a completed checkout, want pro", got)
	}
}

func TestStripeWebhookRefusesWhatItCannotVerify(t *testing.T) {
	h := billingRouter(t, true, nil)
	// The assertion is that nothing moved, not that the workspace is on any particular
	// plan: what a refused delivery must not do is change the answer.
	before := h.plan(t)
	body := subscriptionEvent(t, "evt_forged", "customer.subscription.created",
		h.fixture.WorkspaceID.String(), "active", testPriceMonthly, 500, time.Now().Add(time.Hour))

	cases := map[string]string{
		"no signature":            "",
		"a made-up one":           "t=1700000000,v1=" + hex.EncodeToString(make([]byte, 32)),
		"one signed too long ago": signStripe(t, body, time.Now().Add(-time.Hour)),
	}
	for name, signature := range cases {
		t.Run(name, func(t *testing.T) {
			rec := h.postWebhook(t, body, signature)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status %d body %s — an unverified delivery must be refused", rec.Code, rec.Body)
			}
			if got := h.plan(t); got != before {
				t.Fatalf("plan moved from %s to %s — an unverified delivery granted a plan", before, got)
			}
		})
	}
}

// A deployment with no billing configured has an empty signing secret, and an empty secret
// verifies nothing. Without this the endpoint would be an open grant on every self-host.
func TestStripeWebhookRefusesEverythingWhenBillingIsOff(t *testing.T) {
	h := billingRouter(t, false, nil)
	before := h.plan(t)
	body := subscriptionEvent(t, "evt_x", "customer.subscription.created",
		h.fixture.WorkspaceID.String(), "active", testPriceMonthly, 9, time.Now().Add(time.Hour))

	rec := h.postWebhook(t, body, signStripe(t, body, time.Now()))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d — an unconfigured deployment accepted a billing event", rec.Code)
	}
	if got := h.plan(t); got != before {
		t.Fatalf("plan moved from %s to %s on a deployment with no billing", before, got)
	}
}

// Stripe delivers at least once, and the event id is inside the signed payload.
func TestStripeWebhookIgnoresARedelivery(t *testing.T) {
	h := billingRouter(t, true, nil)
	body := subscriptionEvent(t, "evt_same", "customer.subscription.created",
		h.fixture.WorkspaceID.String(), "active", testPriceMonthly, 2, time.Now().Add(time.Hour))
	signature := signStripe(t, body, time.Now())

	first := h.postWebhook(t, body, signature)
	second := h.postWebhook(t, body, signature)
	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("statuses %d and %d", first.Code, second.Code)
	}
	if !strings.Contains(second.Body.String(), "duplicate") {
		t.Fatalf("the second delivery was not recognised as a replay: %s", second.Body)
	}
}

// Stripe sends dozens of event types. Anything we do not read is a 200, because a 400 would
// be retried for days and fill the operator's dashboard with failures that mean nothing.
func TestStripeWebhookIgnoresEventsItDoesNotRead(t *testing.T) {
	h := billingRouter(t, true, nil)
	body := []byte(`{"id":"evt_ping","type":"invoice.created","data":{"object":{}}}`)
	rec := h.postWebhook(t, body, signStripe(t, body, time.Now()))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "ignored") {
		t.Fatalf("body = %s", rec.Body)
	}
}

// A subscription created by hand in the Stripe dashboard has no workspace on it. It cannot
// be attributed, must not be guessed at, and must not be retried forever.
func TestStripeWebhookIgnoresAnUnattributableSubscription(t *testing.T) {
	h := billingRouter(t, true, nil)
	before := h.plan(t)
	body := subscriptionEvent(t, "evt_orphan", "customer.subscription.updated",
		"", "active", testPriceMonthly, 1, time.Now().Add(time.Hour))
	rec := h.postWebhook(t, body, signStripe(t, body, time.Now()))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
	if got := h.plan(t); got != before {
		t.Fatalf("plan moved from %s to %s — an unattributable event moved a workspace", before, got)
	}
}

func TestCheckoutOpensASessionForTheWorkspacesSeats(t *testing.T) {
	h := billingRouter(t, true, nil)

	rec := h.do(t, http.MethodPost, "/billing/checkout", `{"interval":"yearly"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
	var got struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.URL != "https://checkout.stripe.com/c/pay/cs_1" {
		t.Fatalf("url = %s", got.URL)
	}

	calls := *h.stripeCalls
	if len(calls) != 1 || calls[0].path != "/v1/checkout/sessions" {
		t.Fatalf("stripe calls = %+v", calls)
	}
	form := calls[0].form
	if form.Get("line_items[0][price]") != testPriceYearly {
		t.Fatalf("price = %s, want the annual one", form.Get("line_items[0][price]"))
	}
	// Without this the subscription comes back with no workspace on it and the webhook has
	// nothing to attribute the payment to.
	if form.Get("subscription_data[metadata]["+stripein.WorkspaceMetadataKey+"]") != h.fixture.WorkspaceID.String() {
		t.Fatalf("the session did not carry the workspace: %v", form)
	}
	if form.Get("line_items[0][quantity]") == "0" {
		t.Fatalf("quantity = 0; a checkout must bill at least the seats in use")
	}
}

func TestCheckoutRefusesAnIntervalThisDeploymentDoesNotSell(t *testing.T) {
	h := billingRouter(t, true, nil)
	rec := h.do(t, http.MethodPost, "/billing/checkout", `{"interval":"fortnightly"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
}

// An unconfigured deployment must say so rather than 500 on a nil client.
func TestCheckoutSaysSoWhenBillingIsNotConfigured(t *testing.T) {
	h := billingRouter(t, false, nil)
	rec := h.do(t, http.MethodPost, "/billing/checkout", `{}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "billing") {
		t.Fatalf("body = %s", rec.Body)
	}
}

func TestBillingEndpointsRefuseAnAnonymousCaller(t *testing.T) {
	h := billingRouter(t, true, nil)
	for _, path := range []string{"/billing", "/billing/checkout", "/billing/portal"} {
		method := http.MethodGet
		if path != "/billing" {
			method = http.MethodPost
		}
		rec := h.do(t, method, path, `{}`, false)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s = %d, want 401", method, path, rec.Code)
		}
	}
}

// The portal is Stripe's, and it needs a customer. A workspace that never paid has none.
func TestPortalNeedsACustomer(t *testing.T) {
	h := billingRouter(t, true, nil)
	rec := h.do(t, http.MethodPost, "/billing/portal", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}

	body := subscriptionEvent(t, "evt_p", "customer.subscription.created",
		h.fixture.WorkspaceID.String(), "active", testPriceMonthly, 2, time.Now().Add(time.Hour))
	if got := h.postWebhook(t, body, signStripe(t, body, time.Now())); got.Code != http.StatusOK {
		t.Fatalf("setting up the subscription: %d %s", got.Code, got.Body)
	}

	rec = h.do(t, http.MethodPost, "/billing/portal", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "billing.stripe.com") {
		t.Fatalf("body = %s", rec.Body)
	}
}

func TestBillingStateReportsTheWorkspacesPlan(t *testing.T) {
	h := billingRouter(t, true, nil)
	body := subscriptionEvent(t, "evt_state", "customer.subscription.created",
		h.fixture.WorkspaceID.String(), "active", testPriceMonthly, 5, time.Now().Add(30*24*time.Hour))
	if got := h.postWebhook(t, body, signStripe(t, body, time.Now())); got.Code != http.StatusOK {
		t.Fatalf("applying the subscription: %d %s", got.Code, got.Body)
	}

	rec := h.do(t, http.MethodGet, "/billing", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
	var got struct {
		Enabled         bool   `json:"enabled"`
		Plan            string `json:"plan"`
		Status          string `json:"status"`
		SeatsPaid       *int   `json:"seatsPaid"`
		HasSubscription bool   `json:"hasSubscription"`
		CanManage       bool   `json:"canManage"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.Enabled || got.Plan != "pro" || got.Status != "active" || !got.HasSubscription || !got.CanManage {
		t.Fatalf("state = %+v", got)
	}
	if got.SeatsPaid == nil || *got.SeatsPaid != 5 {
		t.Fatalf("seats paid = %v, want 5", got.SeatsPaid)
	}
}
