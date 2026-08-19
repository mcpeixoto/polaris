package httpapi

import (
	"net/http"
	"testing"
)

func TestRequestIsLoopback_AcceptsLocalHosts(t *testing.T) {
	t.Parallel()
	for _, host := range []string{
		"localhost",
		"localhost:5173",
		"localhost:8088",
		"127.0.0.1",
		"127.0.0.1:5173",
		"[::1]",
		"[::1]:5173",
	} {
		req := &http.Request{Host: host, RemoteAddr: "127.0.0.1:54321"}
		if !requestIsLoopback(req) {
			t.Errorf("Host %q from 127.0.0.1 should be loopback", host)
		}
	}

	ipv6 := &http.Request{Host: "[::1]:5173", RemoteAddr: "[::1]:54321"}
	if !requestIsLoopback(ipv6) {
		t.Error("IPv6 loopback peer should be accepted")
	}
}

func TestRequestIsLoopback_RefusesAPublicHost(t *testing.T) {
	t.Parallel()
	req := &http.Request{Host: "polaris.example.com", RemoteAddr: "127.0.0.1:54321"}
	if requestIsLoopback(req) {
		t.Fatal("a real hostname must not pass even when the peer is loopback")
	}
}

func TestRequestIsLoopback_RefusesASpoofedHostFromOffBox(t *testing.T) {
	t.Parallel()
	// httptest's default peer is TEST-NET-1. A production API, or Docker self-host
	// behind Caddy, looks like this: Host can be anything the caller writes.
	req := &http.Request{Host: "localhost:5173", RemoteAddr: "192.0.2.1:1234"}
	if requestIsLoopback(req) {
		t.Fatal("Host: localhost from a non-loopback peer must not mint a session")
	}
}

func TestRequestIsLoopback_IgnoresForwardedHeaders(t *testing.T) {
	t.Parallel()
	req := &http.Request{
		Host:       "polaris.example.com",
		RemoteAddr: "203.0.113.9:443",
		Header:     http.Header{"X-Forwarded-Host": []string{"localhost"}, "X-Forwarded-For": []string{"127.0.0.1"}},
	}
	if requestIsLoopback(req) {
		t.Fatal("forwarded localhost must not count — those headers are caller-controlled")
	}
}
