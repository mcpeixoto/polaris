package push_test

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/push"
)

func TestNew_NoCredentialsIsNop(t *testing.T) {
	s, err := push.New(push.Config{})
	if err != nil {
		t.Fatal(err)
	}
	res := s.Send(context.Background(), push.Notification{Token: "abc"})
	if res.Err != nil || res.Status != http.StatusOK {
		t.Fatalf("nop should accept: %+v", res)
	}
}

func TestAPNs_SendPostsToSandboxHost(t *testing.T) {
	var sawHost, sawAuth, sawTopic string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawHost = r.Host
		sawAuth = r.Header.Get("authorization")
		sawTopic = r.Header.Get("apns-topic")
		if !strings.HasPrefix(r.URL.Path, "/3/device/") {
			t.Errorf("path = %s", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"title":"Polaris"`) {
			t.Errorf("body = %s", body)
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	pemKey := mustPEM(t)
	client := server.Client()
	// Point the APNs client at our test server by swapping the HTTP client and faking
	// the host via a custom transport that rewrites the URL — simpler: use the test
	// server's URL by overriding through a round-tripper.
	client.Transport = rewriteHost(server.URL, client.Transport)

	s, err := push.New(push.Config{
		KeyID:      "KEYID1234",
		TeamID:     "TEAMID1234",
		KeyPEM:     pemKey,
		Bundle:     "com.peixotolabs.polaris",
		HTTPClient: client,
	})
	if err != nil {
		t.Fatal(err)
	}
	res := s.Send(context.Background(), push.Notification{
		Token:       "deadbeef",
		Environment: push.Sandbox,
		Title:       "Polaris",
		Body:        "assigned ENG-1 to you",
	})
	if res.Err != nil {
		t.Fatalf("send: %v", res.Err)
	}
	if res.Status != http.StatusOK {
		t.Fatalf("status = %d reason %s", res.Status, res.Reason)
	}
	if sawHost == "" || !strings.HasPrefix(sawAuth, "bearer ") || sawTopic != "com.peixotolabs.polaris" {
		t.Fatalf("host=%q auth=%q topic=%q", sawHost, sawAuth, sawTopic)
	}
}

func TestResult_Unregistered(t *testing.T) {
	if !(push.Result{Status: http.StatusGone}).Unregistered() {
		t.Fatal("410 must be unregistered")
	}
	if !(push.Result{Reason: "BadDeviceToken"}).Unregistered() {
		t.Fatal("BadDeviceToken must be unregistered")
	}
	if (push.Result{Status: http.StatusOK}).Unregistered() {
		t.Fatal("200 must not be unregistered")
	}
}

func mustPEM(t *testing.T) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

type hostRewriter struct {
	base string
	next http.RoundTripper
}

func rewriteHost(base string, next http.RoundTripper) http.RoundTripper {
	if next == nil {
		next = http.DefaultTransport
	}
	return hostRewriter{base: strings.TrimRight(base, "/"), next: next}
}

func (h hostRewriter) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	u := strings.TrimPrefix(req.URL.RequestURI(), "/")
	target := h.base + "/" + u
	parsed, err := http.NewRequestWithContext(req.Context(), req.Method, target, req.Body)
	if err != nil {
		return nil, err
	}
	parsed.Header = clone.Header
	return h.next.RoundTrip(parsed)
}
