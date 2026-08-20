package platform

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"testing"
	"time"
)

func TestSlackSignatureOK(t *testing.T) {
	t.Parallel()
	const secret = "slack_signing_secret"
	const ts = "1531420618"
	body := []byte("token=xyzz&team_id=T1")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = fmt.Fprintf(mac, "v0:%s:", ts)
	_, _ = mac.Write(body)
	header := "v0=" + hex.EncodeToString(mac.Sum(nil))

	if !SlackSignatureOK(secret, ts, body, header) {
		t.Fatal("a matching Slack signature must verify")
	}
	if !SlackSignatureOK(secret, ts, body, stringsUpper(header)) {
		t.Fatal("hex case must not matter")
	}
	if SlackSignatureOK(secret, ts, body, "v0=deadbeef") {
		t.Fatal("a wrong digest must not verify")
	}
	if SlackSignatureOK(secret, ts, append(body, 'x'), header) {
		t.Fatal("a mutated body must not verify")
	}
	if SlackSignatureOK("", ts, body, header) {
		t.Fatal("an empty secret must not verify")
	}
	if SlackSignatureOK(secret, ts, body, "") {
		t.Fatal("a missing header must not verify")
	}
}

func TestSlackTimestampOK(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0)
	if !SlackTimestampOK(strconv.FormatInt(now.Unix(), 10), now) {
		t.Fatal("a current timestamp must pass")
	}
	stale := strconv.FormatInt(now.Add(-6*time.Minute).Unix(), 10)
	if SlackTimestampOK(stale, now) {
		t.Fatal("a timestamp older than the replay window must fail")
	}
	if SlackTimestampOK("", now) {
		t.Fatal("a missing timestamp must fail — Slack always sends one")
	}
	if SlackTimestampOK("not-a-unix-time", now) {
		t.Fatal("junk must fail")
	}
}
