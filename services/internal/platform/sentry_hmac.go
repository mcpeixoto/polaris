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

const sentryFreshnessWindow = 60 * time.Second

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

// SentryTimestampOK reports whether Sentry-Hook-Timestamp is within the freshness window.
//
// This is NOT replay protection, and the previous version of this comment calling it a
// "replay window" is most of why it looked like some. Sentry's signature is an HMAC of the
// raw body and nothing else — the timestamp is outside the MAC — so a replayer posting a
// captured body simply supplies today's timestamp beside it and the window is satisfied.
// The check is an assertion about a number the caller chose. It cannot be strengthened from
// this side either: adding the timestamp to the MAC would mean computing a signature Sentry
// does not send, and every real delivery would start failing.
//
// What it is worth keeping for is the accidental case — a stuck queue, a replayed capture in
// a test fixture, a clock that walked — where nobody is lying to us. Actual replay defence
// is ReplayGuard in webhook_replay.go, which remembers the body digest: the body is the one
// part of the request the signature does pin, so it is the one part a replayer cannot vary.
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
	return delta <= sentryFreshnessWindow
}
