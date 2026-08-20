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

const sentryReplayWindow = 60 * time.Second

// SentrySignatureOK reports whether Sentry-Hook-Signature matches the HMAC of body.
//
// Sentry's integration-platform webhooks sign the raw bytes with the client secret and
// send a hex digest with no algorithm prefix. An empty secret or a missing header is a
// miss rather than a panic: a misconfigured install should refuse the request, not take
// the process down.
func SentrySignatureOK(secret string, body []byte, header string) bool {
	if secret == "" {
		return false
	}
	got := strings.TrimSpace(header)
	if got == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	want := hex.EncodeToString(mac.Sum(nil))
	if len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(strings.ToLower(got)), []byte(strings.ToLower(want))) == 1
}

// SentryTokenOK reports whether X-Sentry-Token matches the stored webhook secret.
//
// Alert-rule webhooks have no HMAC; the product asks the admin to set this header on the
// Sentry action. Empty values are a miss: unsigned traffic must not be admitted.
func SentryTokenOK(secret, header string) bool {
	if secret == "" || header == "" {
		return false
	}
	if len(secret) != len(header) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(secret), []byte(header)) == 1
}

// SentryTimestampOK reports whether Sentry-Hook-Timestamp is within the replay window.
//
// An empty header is allowed: alert-rule POSTs do not send one. A present but unparsable
// value is a miss, because treating junk as "no timestamp" would admit a replay that
// bothered to send the header.
func SentryTimestampOK(header string, now time.Time) bool {
	raw := strings.TrimSpace(header)
	if raw == "" {
		return true
	}
	sec, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return false
	}
	ts := time.Unix(sec, 0)
	delta := now.Sub(ts)
	if delta < 0 {
		delta = -delta
	}
	return delta <= sentryReplayWindow
}
