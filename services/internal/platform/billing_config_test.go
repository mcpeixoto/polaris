package platform_test

import (
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// fullBilling is a config with every variable BillingEnabled demands.
func fullBilling() platform.Config {
	return platform.Config{
		StripeSecretKey:       "sk_test_1",
		StripeWebhookSecret:   "whsec_1",
		StripePriceProMonthly: "price_monthly",
	}
}

func TestBillingEnabledNeedsAllThree(t *testing.T) {
	if !fullBilling().BillingEnabled() {
		t.Fatal("a config with all three set must be enabled")
	}

	for _, tc := range []struct {
		name  string
		blank func(*platform.Config)
		want  string
	}{
		{"no secret key", func(c *platform.Config) { c.StripeSecretKey = "" }, "POLARIS_STRIPE_SECRET_KEY"},
		{"no webhook secret", func(c *platform.Config) { c.StripeWebhookSecret = "" }, "POLARIS_STRIPE_WEBHOOK_SECRET"},
		{"no monthly price", func(c *platform.Config) { c.StripePriceProMonthly = "" }, "POLARIS_STRIPE_PRICE_PRO_MONTHLY"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := fullBilling()
			tc.blank(&cfg)
			if cfg.BillingEnabled() {
				t.Fatal("a half-configured deployment must not be able to sell anything")
			}
			missing := cfg.BillingMissing()
			if len(missing) != 1 || missing[0] != tc.want {
				t.Fatalf("missing = %v, want [%s]", missing, tc.want)
			}
			if !cfg.BillingHalfConfigured() {
				t.Fatal("one variable short is exactly the state that deserves a warning")
			}
		})
	}
}

// Whitespace is not a credential. A variable set to a stray space in an env file would
// otherwise open a checkout that Stripe rejects.
func TestBillingMissingTreatsBlankAsUnset(t *testing.T) {
	cfg := fullBilling()
	cfg.StripeSecretKey = "   "
	if cfg.BillingEnabled() {
		t.Fatal("a whitespace key must not count as configured")
	}
	if got := cfg.BillingMissing(); len(got) != 1 || got[0] != "POLARIS_STRIPE_SECRET_KEY" {
		t.Fatalf("missing = %v", got)
	}
}

// The ordinary self-host: nothing set, nothing to warn about.
func TestBillingEmptyIsNotHalfConfigured(t *testing.T) {
	var cfg platform.Config
	if cfg.BillingEnabled() {
		t.Fatal("an empty config must not be able to sell anything")
	}
	if cfg.BillingHalfConfigured() {
		t.Fatal("a self-host that set nothing is not mid-setup")
	}
	missing := cfg.BillingMissing()
	if len(missing) != 3 {
		t.Fatalf("missing = %v, want all three", missing)
	}
	// The names are what a reader pastes into their env file, so they must be the real
	// variables rather than field names.
	for _, name := range missing {
		if !strings.HasPrefix(name, "POLARIS_STRIPE_") {
			t.Fatalf("%q is not an environment variable a reader can set", name)
		}
	}
}

func TestBillingConfiguredIsNotHalfConfigured(t *testing.T) {
	if fullBilling().BillingHalfConfigured() {
		t.Fatal("a complete configuration is not mid-setup")
	}
	if got := fullBilling().BillingMissing(); got != nil {
		t.Fatalf("missing = %v, want none", got)
	}
}
