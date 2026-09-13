package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// handshake dials a server that accepts with allowedOrigins(cfg) and reports whether the
// upgrade was allowed for the given Origin.
func handshake(t *testing.T, cfg platform.Config, origin string) bool {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: allowedOrigins(cfg)})
		if err != nil {
			return
		}
		_ = c.Close(websocket.StatusNormalClosure, "")
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{origin}},
	})
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		if resp == nil || resp.StatusCode != http.StatusForbidden {
			t.Fatalf("dial with Origin %q: %v", origin, errors.Unwrap(err))
		}
		return false
	}
	_ = c.Close(websocket.StatusNormalClosure, "")
	return true
}

// The desktop app signs in through the API, whose CORS allows its scheme, and then opens
// the sync socket from the same origin. A hub that refused it left the app on
// "Reconnecting" forever while everything else looked signed in.
func TestAllowedOriginsAdmitTheDesktopApp(t *testing.T) {
	cfg := platform.Config{Env: "production", PublicURL: "https://polaris.example.com"}

	for origin, want := range map[string]bool{
		"polaris-app://app":           true,
		"https://polaris.example.com": true,
		"https://evil.example":        false,
		"other://app":                 false,
	} {
		if got := handshake(t, cfg, origin); got != want {
			t.Errorf("Origin %q allowed = %v, want %v", origin, got, want)
		}
	}
}

// POLARIS_ALLOWED_ORIGINS already lets a separate front end call the API. Its socket has to
// be allowed too, or that front end has the same half-working shape the desktop app had.
func TestAllowedOriginsIncludeOperatorOrigins(t *testing.T) {
	cfg := platform.Config{
		Env:            "production",
		PublicURL:      "https://polaris.example.com",
		AllowedOrigins: []string{" https://Front.Example.com/ "},
	}

	if !handshake(t, cfg, "https://front.example.com") {
		t.Error("operator-listed origin was refused")
	}
	if handshake(t, cfg, "https://other.example.com") {
		t.Error("unlisted origin was allowed")
	}
}
