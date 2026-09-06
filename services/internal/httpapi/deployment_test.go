package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// The endpoint exists so a deploy can be checked against what the stack is configured to
// be, so what it reports has to track Config rather than a constant somebody typed twice.
func TestDeploymentPostureReportsConfig(t *testing.T) {
	h := &deploymentHandlers{
		cfg: platform.Config{
			Env:              "production",
			RegistrationMode: "open",
			DefaultPlan:      "free",
			// BillingEnabled() wants all three, so this is the "can sell" shape.
			StripeSecretKey:       "sk-test-not-a-key",
			StripeWebhookSecret:   "whsec-test",
			StripePriceProMonthly: "price_test",
		},
		revision: "abc1234",
	}

	rec := httptest.NewRecorder()
	h.posture(rec, httptest.NewRequest(http.MethodGet, "/deployment", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}

	var got struct {
		Env              string `json:"env"`
		RegistrationMode string `json:"registrationMode"`
		DefaultPlan      string `json:"defaultPlan"`
		BillingEnabled   bool   `json:"billingEnabled"`
		Edition          string `json:"edition"`
		Revision         string `json:"revision"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Env != "production" || got.RegistrationMode != "open" || got.DefaultPlan != "free" {
		t.Fatalf("posture = %+v", got)
	}
	if !got.BillingEnabled {
		t.Fatal("billingEnabled false on a deployment configured to sell")
	}
	if got.Revision != "abc1234" {
		t.Fatalf("revision = %q", got.Revision)
	}
	if got.Edition != platform.Edition {
		t.Fatalf("edition = %q, want %q", got.Edition, platform.Edition)
	}
}

// A self-hosted install answers the same question with its own defaults, and must not claim
// it can sell anything.
func TestDeploymentPostureOnAnUnconfiguredInstall(t *testing.T) {
	h := &deploymentHandlers{cfg: platform.Config{
		Env:              "production",
		RegistrationMode: "invite",
		DefaultPlan:      "self_hosted",
	}}

	rec := httptest.NewRecorder()
	h.posture(rec, httptest.NewRequest(http.MethodGet, "/deployment", nil))

	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["billingEnabled"] != false {
		t.Fatalf("billingEnabled = %v on an install with no Stripe configuration", got["billingEnabled"])
	}
	if got["registrationMode"] != "invite" || got["defaultPlan"] != "self_hosted" {
		t.Fatalf("posture = %+v", got)
	}
}

// The endpoint is anonymous, so the cost of a new field is that it is public forever. This
// is the guard on the rule in deployment.go: it may say what the server will do, never how
// to be it. A secret reaching this payload is the kind of mistake that is only visible from
// outside, which is where nobody is looking.
func TestDeploymentPostureCarriesNoSecrets(t *testing.T) {
	const secret = "sk-live-this-must-never-be-served"
	h := &deploymentHandlers{cfg: platform.Config{
		Env:                   "production",
		RegistrationMode:      "open",
		DefaultPlan:           "free",
		JWTSecret:             secret,
		StripeSecretKey:       secret,
		StripeWebhookSecret:   secret,
		StripePriceProMonthly: "price_test",
		DatabaseURL:           "postgres://polaris:" + secret + "@db:5432/polaris",
		AIAPIKey:              secret,
		GoogleClientID:        "415057540542-example.apps.googleusercontent.com",
		PublicURL:             "https://polaris.example.com",
	}}

	rec := httptest.NewRecorder()
	h.posture(rec, httptest.NewRequest(http.MethodGet, "/deployment", nil))

	body := rec.Body.String()
	if strings.Contains(body, secret) {
		t.Fatalf("a secret reached the anonymous posture endpoint: %s", body)
	}
	// The hostname and the client id are not credentials, but they are not this endpoint's
	// business either, and an install should not have to think about who may read them.
	for _, leaked := range []string{"polaris.example.com", "googleusercontent.com", "postgres://"} {
		if strings.Contains(body, leaked) {
			t.Fatalf("%q reached the posture endpoint: %s", leaked, body)
		}
	}

	// A field added without a decision is the failure this test is really about, so the
	// payload's shape is pinned: adding one means coming here and saying why it is public.
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want := []string{"env", "registrationMode", "defaultPlan", "billingEnabled", "edition", "revision"}
	if len(got) != len(want) {
		t.Fatalf("payload has %d fields, want %d: %v", len(got), len(want), got)
	}
	for _, key := range want {
		if _, ok := got[key]; !ok {
			t.Fatalf("missing %q: %v", key, got)
		}
	}
}
