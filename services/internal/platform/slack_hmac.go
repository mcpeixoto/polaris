package platform

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Slack's documented replay window for request signatures.
const slackReplayWindow = 5 * time.Minute

// SlackSignatureOK reports whether X-Slack-Signature matches v0 HMAC-SHA256 of
// "v0:{timestamp}:{body}" with the signing secret.
//
// An empty secret or a missing header is a miss: unsigned Slack traffic must not be
// admitted. The comparison is constant-time on the hex digest.
func SlackSignatureOK(secret string, timestamp string, body []byte, header string) bool {
	if secret == "" {
		return false
	}
	got := strings.TrimSpace(header)
	if got == "" || timestamp == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = fmt.Fprintf(mac, "v0:%s:", timestamp)
	_, _ = mac.Write(body)
	want := "v0=" + hex.EncodeToString(mac.Sum(nil))
	if len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(strings.ToLower(got)), []byte(strings.ToLower(want))) == 1
}

// SlackTimestampOK reports whether X-Slack-Request-Timestamp is within the replay window.
func SlackTimestampOK(header string, now time.Time) bool {
	raw := strings.TrimSpace(header)
	if raw == "" {
		return false
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
	return delta <= slackReplayWindow
}
