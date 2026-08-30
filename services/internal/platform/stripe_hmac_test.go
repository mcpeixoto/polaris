package platform

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"testing"
	"time"
)

const testStripeSecret = "whsec_ZmFrZV9zZWNyZXRfZm9yX3Rlc3Rz"

func stripeHeader(t *testing.T, secret string, body []byte, at time.Time) string {
	t.Helper()
	ts := fmt.Sprintf("%d", at.Unix())
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(ts + "."))
	_, _ = mac.Write(body)
	return fmt.Sprintf("t=%s,v1=%s", ts, hex.EncodeToString(mac.Sum(nil)))
}

func TestStripeSignatureOK(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	body := []byte(`{"id":"evt_1","type":"customer.subscription.updated"}`)

	if !StripeSignatureOK(testStripeSecret, body, stripeHeader(t, testStripeSecret, body, now), now) {
		t.Fatal("a signature we just computed did not verify")
	}
}

// A rotation sends the old and the new signature in one header. Refusing a header because
// one of its v1 values is stale would take the endpoint down for the length of the rotation,
// which is the window the second signature exists to cover.
func TestStripeSignatureAcceptsOneOfSeveral(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	body := []byte(`{"id":"evt_2"}`)
	good := stripeHeader(t, testStripeSecret, body, now)
	header := good + ",v1=" + hex.EncodeToString(make([]byte, sha256.Size))

	if !StripeSignatureOK(testStripeSecret, body, header, now) {
		t.Fatal("a header carrying a valid signature beside a wrong one was refused")
	}
}

func TestStripeSignatureRejections(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	body := []byte(`{"id":"evt_3"}`)
	valid := stripeHeader(t, testStripeSecret, body, now)

	cases := []struct {
		name   string
		secret string
		body   []byte
		header string
		now    time.Time
	}{
		// A deployment with no billing configured must not accept billing traffic. An empty
		// secret verifying anything would make "we forgot to set it" indistinguishable from
		// "Stripe sent this".
		{"no secret configured", "", body, valid, now},
		{"wrong secret", "whsec_other", body, valid, now},
		{"body edited after signing", testStripeSecret, []byte(`{"id":"evt_3","seats":9000}`), valid, now},
		{"no header", testStripeSecret, body, "", now},
		{"no v1 in header", testStripeSecret, body, "t=1700000000", now},
		{"no timestamp in header", testStripeSecret, body, "v1=" + hex.EncodeToString(make([]byte, 32)), now},
		{"timestamp is not a number", testStripeSecret, body, "t=yesterday,v1=" + hex.EncodeToString(make([]byte, 32)), now},
		{"v1 is not hex", testStripeSecret, body, "t=1700000000,v1=zzzz", now},
		// The timestamp is inside the MAC, so this is real replay defence and not decoration.
		{"replayed an hour later", testStripeSecret, body, valid, now.Add(time.Hour)},
		{"clock ran an hour behind", testStripeSecret, body, valid, now.Add(-time.Hour)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if StripeSignatureOK(tc.secret, tc.body, tc.header, tc.now) {
				t.Fatal("accepted a delivery it should have refused")
			}
		})
	}
}

// Inside the window on both sides, because Stripe's clock and ours are not the same clock.
func TestStripeSignatureToleranceEdges(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	body := []byte(`{"id":"evt_4"}`)
	header := stripeHeader(t, testStripeSecret, body, now)

	for _, skew := range []time.Duration{StripeToleranceWindow - time.Second, -(StripeToleranceWindow - time.Second)} {
		if !StripeSignatureOK(testStripeSecret, body, header, now.Add(skew)) {
			t.Fatalf("refused a delivery %s inside the tolerance window", skew)
		}
	}
}
