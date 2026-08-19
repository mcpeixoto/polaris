package platform

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
)

// GitHubSignatureOK reports whether X-Hub-Signature-256 matches the HMAC of body.
//
// GitHub signs the raw bytes, so the compare has to happen before the body is decoded.
// An empty secret or a missing header is a miss rather than a panic: a misconfigured
// install should refuse the request, not take the process down.
func GitHubSignatureOK(secret string, body []byte, header string) bool {
	if secret == "" {
		return false
	}
	got, ok := strings.CutPrefix(strings.TrimSpace(header), "sha256=")
	if !ok || got == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	want := hex.EncodeToString(mac.Sum(nil))
	if len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(strings.ToLower(got)), []byte(want)) == 1
}
