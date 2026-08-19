package webhookout

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestSignHex_IsHMACSHA256OfTheRawBytes(t *testing.T) {
	t.Parallel()
	body := []byte(`{"action":"create","type":"Issue"}`)
	secret := "s3cret"
	got := SignHex(secret, body)

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	want := hex.EncodeToString(mac.Sum(nil))
	if got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
	if !EqualSignature(got, want) {
		t.Fatal("EqualSignature rejected its own output")
	}
	if EqualSignature(got, SignHex("other", body)) {
		t.Fatal("a different secret must not verify")
	}
}

func TestSignHex_ReserialisingJSONWouldNotMatch(t *testing.T) {
	t.Parallel()
	// The documented failure mode: hashing a parsed-and-marshalled object instead of the
	// bytes on the wire. Two equivalent objects, two signatures.
	raw := []byte(`{"b":1,"a":2}`)
	remarshalled := []byte(`{"a":2,"b":1}`)
	if SignHex("k", raw) == SignHex("k", remarshalled) {
		t.Fatal("two encodings of the same map must not share a signature — that would hide the bug this exists to catch")
	}
}
