package webhookout

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestDeliverer_SignsTheRawBodyAndPinsLoopbackOnlyWhenAllowed(t *testing.T) {
	t.Parallel()
	var gotBody []byte
	var gotSig, gotEvent, gotUA string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		gotSig = r.Header.Get("Polaris-Signature")
		gotEvent = r.Header.Get("Polaris-Event")
		gotUA = r.Header.Get("User-Agent")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	body := []byte(`{"action":"create","type":"Issue"}`)
	secret := "hook-secret"
	d := Deliverer{AllowPrivate: true, Timeout: time.Second}
	res := d.Send(context.Background(), Destination{
		URL:        srv.URL,
		Secret:     secret,
		Event:      "Issue",
		DeliveryID: uuid.Must(uuid.NewV7()),
		Timestamp:  time.UnixMilli(1_700_000_000_000),
		Body:       body,
	})
	if res.Err != nil {
		t.Fatalf("send: %v", res.Err)
	}
	if res.Status != 200 {
		t.Fatalf("status %d", res.Status)
	}
	if !bytesEqual(gotBody, body) {
		t.Fatalf("body = %s, want the exact bytes signed", gotBody)
	}
	if !EqualSignature(gotSig, SignHex(secret, body)) {
		t.Fatalf("signature %q does not match the raw body", gotSig)
	}
	if gotEvent != "Issue" || gotUA != userAgent {
		t.Fatalf("event=%q ua=%q", gotEvent, gotUA)
	}
}

func TestDeliverer_RefusesAPrivateResolution(t *testing.T) {
	t.Parallel()
	d := Deliverer{
		Timeout: time.Second,
		LookupIP: func(context.Context, string) ([]net.IP, error) {
			return []net.IP{net.ParseIP("10.0.0.8")}, nil
		},
	}
	res := d.Send(context.Background(), Destination{
		URL:    "https://hooks.example.com/x",
		Secret: "s",
		Event:  "Issue",
		Body:   []byte(`{}`),
	})
	if res.Err == nil || !strings.Contains(res.Err.Error(), "private") {
		t.Fatalf("want a private-host refusal, got %+v", res)
	}
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
