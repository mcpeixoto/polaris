package webhookout

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

// SignHex is a hex HMAC-SHA256 of the raw body. The consumer must hash the bytes they
// received, not a re-serialised JSON object — two encoders of the same map are not the
// same string, and that mismatch is how signatures "randomly" fail in production.
func SignHex(secret string, rawBody []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(rawBody)
	return hex.EncodeToString(mac.Sum(nil))
}

// EqualSignature is a constant-time compare of two hex MAC strings. Missing or odd-length
// headers are a miss, not a panic.
func EqualSignature(got, want string) bool {
	a, errA := hex.DecodeString(got)
	b, errB := hex.DecodeString(want)
	if errA != nil || errB != nil || len(a) != len(b) {
		return false
	}
	return hmac.Equal(a, b)
}
