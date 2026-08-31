package platform

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strconv"
	"strings"
	"time"
)

// StripeToleranceWindow is how far a signed timestamp may be from our clock.
//
// Five minutes is Stripe's own default and the number their retries are tuned against.
// Unlike the Sentry window next door, this one is worth something: Stripe signs
// `timestamp + "." + body`, so the timestamp is inside the MAC and a replayer cannot move
// it without invalidating the signature. Widening this widens the window in which a
// captured delivery can be posted again.
const StripeToleranceWindow = 5 * time.Minute

// StripeSignatureOK reports whether the Stripe-Signature header authenticates body.
//
// The header is a comma-separated list of `key=value` pairs — `t` for the unix seconds the
// event was signed at, `v1` for the hex HMAC-SHA256 of "<t>.<body>" under the endpoint's
// signing secret. More than one v1 may be present while a secret is being rotated, and any
// one of them matching is a pass; that is the whole point of sending several.
//
// Everything unusual is a miss rather than a panic or an error: an empty secret (the
// deployment has no billing configured and must not accept billing traffic), a missing or
// malformed header, a v1 that is not hex, a timestamp outside the tolerance window.
func StripeSignatureOK(secret string, body []byte, header string, now time.Time) bool {
	if secret == "" {
		return false
	}
	timestamp, signatures := parseStripeSignature(header)
	if timestamp == "" || len(signatures) == 0 {
		return false
	}

	sec, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	delta := now.Sub(time.Unix(sec, 0))
	if delta < 0 {
		delta = -delta
	}
	if delta > StripeToleranceWindow {
		return false
	}

	mac := hmac.New(sha256.New, []byte(secret))
	// The signed payload is the timestamp, a literal dot, then the raw bytes — the bytes as
	// they arrived, which is why every caller reads the body before anything can re-encode
	// it. Re-marshalling the JSON first changes key order and whitespace and the signature
	// stops matching for reasons no log line ever explains.
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(body)
	want := mac.Sum(nil)

	for _, candidate := range signatures {
		got, err := hex.DecodeString(candidate)
		if err != nil {
			continue
		}
		if subtle.ConstantTimeCompare(got, want) == 1 {
			return true
		}
	}
	return false
}

// parseStripeSignature pulls the timestamp and every v1 signature out of the header.
//
// Unknown schemes are skipped rather than refused: Stripe has added a scheme before (v0,
// for their test-mode CLI) and an endpoint that rejected a header carrying one would start
// failing on a change that was meant to be backwards compatible.
func parseStripeSignature(header string) (timestamp string, signatures []string) {
	for _, part := range strings.Split(header, ",") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch key {
		case "t":
			timestamp = value
		case "v1":
			signatures = append(signatures, strings.ToLower(value))
		}
	}
	return timestamp, signatures
}
