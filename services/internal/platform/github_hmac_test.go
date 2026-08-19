package platform

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestGitHubSignatureOK(t *testing.T) {
	t.Parallel()
	const secret = "whsec_test"
	body := []byte(`{"zen":"Anything added dilutes everything else."}`)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	header := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if !GitHubSignatureOK(secret, body, header) {
		t.Fatal("a correctly signed body must verify")
	}
	if GitHubSignatureOK(secret, body, "sha256=deadbeef") {
		t.Fatal("a wrong digest must not verify")
	}
	if GitHubSignatureOK(secret, append(body, 'x'), header) {
		t.Fatal("a mutated body must not verify")
	}
	if GitHubSignatureOK("", body, header) {
		t.Fatal("an empty secret must not verify: that is how a missing env var would admit anyone")
	}
	if GitHubSignatureOK(secret, body, "") {
		t.Fatal("a missing header must not verify")
	}
}
