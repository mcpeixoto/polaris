package platform

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"testing"
	"time"
)

func TestSentrySignatureOK(t *testing.T) {
	t.Parallel()
	const secret = "sntrys_test"
	body := []byte(`{"action":"created"}`)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	header := hex.EncodeToString(mac.Sum(nil))

	if !SentrySignatureOK(secret, body, header) {
		t.Fatal("a correctly signed body must verify")
	}
	if !SentrySignatureOK(secret, body, stringsUpper(header)) {
		t.Fatal("hex case must not matter")
	}
	if SentrySignatureOK(secret, body, "deadbeef") {
		t.Fatal("a wrong digest must not verify")
	}
	if SentrySignatureOK(secret, append(body, 'x'), header) {
		t.Fatal("a mutated body must not verify")
	}
	if SentrySignatureOK("", body, header) {
		t.Fatal("an empty secret must not verify")
	}
	if SentrySignatureOK(secret, body, "") {
		t.Fatal("a missing header must not verify")
	}
}

func TestSentryTokenOK(t *testing.T) {
	t.Parallel()
	const secret = "sentry_abc"
	if !SentryTokenOK(secret, secret) {
		t.Fatal("the matching token must verify")
	}
	if SentryTokenOK(secret, "sentry_other") {
		t.Fatal("a different token must be refused")
	}
	if SentryTokenOK(secret, "") {
		t.Fatal("a missing header must be refused")
	}
	if SentryTokenOK("", secret) {
		t.Fatal("an empty stored secret must be refused")
	}
}

func TestSentryTimestampOK(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 20, 21, 0, 0, 0, time.UTC)
	if !SentryTimestampOK("", now) {
		t.Fatal("a missing timestamp is allowed: alert webhooks do not send one")
	}
	fresh := strconv.FormatInt(now.Unix(), 10)
	if !SentryTimestampOK(fresh, now) {
		t.Fatal("a current timestamp must verify")
	}
	stale := strconv.FormatInt(now.Add(-2*time.Minute).Unix(), 10)
	if SentryTimestampOK(stale, now) {
		t.Fatal("a timestamp older than 60s must be refused")
	}
	if SentryTimestampOK("not-a-unix-time", now) {
		t.Fatal("junk in the timestamp header must be refused")
	}
}

func stringsUpper(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'a' && c <= 'f' {
			b[i] = c - 32
		}
	}
	return string(b)
}
