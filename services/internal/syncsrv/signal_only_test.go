package syncsrv_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/syncsrv"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Signal-only sessions are the iOS client's middle path: no replica, no bootstrap, but a
// socket whose delta frames say "something you can see changed" so the app refetches now
// rather than on its next thirty-second poll. The one thing such a client must be exempt
// from is the client-schema check, because pinning a phone to the web store's shape
// version means an App Store release per schema bump. Everything else about the session
// has to be exactly as strict as before, which is what the tests below hold.

// sendHello dials the harness and writes an arbitrary hello, for the tests that need a
// frame the harness's own connect helper would never produce.
func sendHello(t *testing.T, serverURL string, hello syncsrv.Hello) *client {
	t.Helper()

	url := "ws" + strings.TrimPrefix(serverURL, "http")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close(websocket.StatusNormalClosure, "") })

	frame, _ := json.Marshal(hello)
	if err := conn.Write(ctx, websocket.MessageText, frame); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	return &client{t: t, conn: conn}
}

func (h *harness) signalOnlyHello(clientSchema int) syncsrv.Hello {
	return syncsrv.Hello{
		Type:         syncsrv.TypeHello,
		Token:        "dev",
		Workspace:    h.fixture.WorkspaceID,
		ClientSchema: clientSchema,
		ClientID:     uuid.New(),
		SignalOnly:   true,
	}
}

func TestSignalOnly_AcceptsAMismatchedClientSchema(t *testing.T) {
	h := newHarness(t)

	// Zero is what the iOS client sends: it has no schema to declare. Any other number
	// would do — the point is that the field is not consulted for a signal-only hello.
	c := sendHello(t, h.server.URL, h.signalOnlyHello(0))
	frame := c.next(5 * time.Second)
	if frame["t"] != syncsrv.TypeReady {
		t.Fatalf("a signal-only client holds no rows a schema mismatch could corrupt, so it must be accepted; got %v", frame)
	}
	if _, ok := frame["version"].(float64); !ok {
		t.Errorf("ready must still carry the workspace version, so the client knows whether it is behind: %v", frame)
	}
}

func TestSignalOnly_AMismatchWithoutTheFlagIsStillRefused(t *testing.T) {
	h := newHarness(t)

	hello := h.signalOnlyHello(syncsrv.ClientSchema + 1)
	hello.SignalOnly = false
	c := sendHello(t, h.server.URL, hello)

	frame := c.next(5 * time.Second)
	if frame["t"] != syncsrv.TypeError {
		t.Fatalf("the exemption is for clients that declare they keep no replica; a replica-holding client on the wrong schema must still be refused, got %v", frame)
	}
	if frame["code"] != string(platform.CodeConflict) {
		t.Errorf("expected %s, got %v", platform.CodeConflict, frame["code"])
	}
}

// The flag exempts the schema check and nothing else: a bad token is a bad token.
func TestSignalOnly_StillRequiresAValidToken(t *testing.T) {
	h := newHarness(t)

	hello := h.signalOnlyHello(0)
	hello.Token = "not-a-real-token"
	c := sendHello(t, h.server.URL, hello)

	frame := c.next(5 * time.Second)
	if frame["t"] != syncsrv.TypeError {
		t.Fatalf("signalOnly must not weaken authentication, got %v", frame)
	}
	if frame["code"] != string(platform.CodeUnauthorized) {
		t.Errorf("expected %s, got %v", platform.CodeUnauthorized, frame["code"])
	}
}

func TestSignalOnly_ReceivesADeltaWithoutPayloads(t *testing.T) {
	h := newHarness(t)

	c := sendHello(t, h.server.URL, h.signalOnlyHello(0))
	if ready := c.next(5 * time.Second); ready["t"] != syncsrv.TypeReady {
		t.Fatalf("expected ready, got %v", ready)
	}

	p := principalFor(t, h, h.fixture.AccountID)
	issue, _, err := h.svc.CreateIssue(context.Background(), p, domain.CreateIssueInput{
		TeamID: h.fixture.TeamID,
		Title:  "Written while a phone was listening",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}

	delta := c.awaitDelta(5 * time.Second)
	if _, ok := delta["to"].(float64); !ok {
		t.Errorf("the delta's `to` is the version the client refetches against; it must be present: %v", delta)
	}

	found := false
	for _, ch := range changesIn(t, delta) {
		if _, hasPayload := ch["payload"]; hasPayload {
			t.Errorf("a signal-only session never reads payloads, so it should not be sent one: %v", ch)
		}
		if ch["id"] == issue.ID.String() && ch["type"] == "issue" && ch["op"] == "upsert" {
			found = true
		}
	}
	if !found {
		t.Errorf("the signal-only session did not learn about the new issue: %v", delta)
	}
}

// A signal-only client that reconnects from a version it saw is caught up like any other
// — a phone that was backgrounded for a minute learns what moved without a resync it has
// no bootstrap to answer with.
func TestSignalOnly_ResumesFromAVersionItSaw(t *testing.T) {
	h := newHarness(t)
	p := principalFor(t, h, h.fixture.AccountID)

	first := sendHello(t, h.server.URL, h.signalOnlyHello(0))
	ready := first.next(5 * time.Second)
	version := int64(ready["version"].(float64))
	_ = first.conn.Close(websocket.StatusNormalClosure, "")

	issue, _, err := h.svc.CreateIssue(context.Background(), p, domain.CreateIssueInput{
		TeamID: h.fixture.TeamID,
		Title:  "Written while the phone was in a pocket",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}

	hello := h.signalOnlyHello(0)
	hello.Resume = version
	second := sendHello(t, h.server.URL, hello)
	if ready := second.next(5 * time.Second); ready["t"] != syncsrv.TypeReady {
		t.Fatalf("expected ready, got %v", ready)
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		frame := second.next(time.Until(deadline))
		switch frame["t"] {
		case syncsrv.TypeResync:
			t.Fatalf("a live resume must be caught up, not told to re-bootstrap: %v", frame)
		case syncsrv.TypeDelta:
			for _, ch := range changesIn(t, frame) {
				if ch["id"] == issue.ID.String() {
					return
				}
			}
		}
	}
	t.Fatal("the change written while disconnected never reached the resumed signal-only session")
}

// An upgrade request with no Origin header is accepted even when the allowed origins are
// pinned to one host.
//
// Origin is what browsers attach, and the check exists for them: a page on another site
// must not be able to open a socket carrying the visitor's credentials. A native client —
// the iOS app — sends no Origin at all, and there is nothing to protect it from: it holds
// its own bearer token and no cookie jar a stranger's page could borrow. Refusing it would
// mean every native client has to forge a browser origin to get in, which makes the check
// worth less, not more.
//
// Pinned here because it is the library's behaviour, not ours: coder/websocket's
// authenticateOrigin passes an empty Origin, and a future version deciding otherwise would
// take the iOS app offline with nothing in our code to point at.
func TestSync_AnUpgradeWithNoOriginHeaderIsAccepted(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	ctx, cancel := context.WithCancel(context.Background())
	log := platform.NewLogger(platform.Config{Env: "test", LogLevel: "error"})
	hub := syncsrv.NewHub(svc, log)
	go hub.Run(ctx)

	verifier := fakeVerifier{accounts: map[string]uuid.UUID{"dev": f.AccountID}}
	// Not "*": the production shape, where only the public host may open a socket from
	// a browser.
	srv := httptest.NewServer(syncsrv.NewServer(hub, svc, verifier, log, []string{"polaris.example.com"}))
	t.Cleanup(func() {
		srv.Close()
		cancel()
	})

	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	dialCtx, dialCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer dialCancel()

	// A browser on another site is still turned away at the door, so the test is
	// asserting a distinction and not a server that lets everything in.
	hostile := http.Header{}
	hostile.Set("Origin", "https://evil.example")
	if conn, _, err := websocket.Dial(dialCtx, url, &websocket.DialOptions{HTTPHeader: hostile}); err == nil {
		_ = conn.Close(websocket.StatusNormalClosure, "")
		t.Fatal("an upgrade from a foreign Origin must be refused")
	}

	// coder/websocket's Dial sends no Origin header unless asked to, which is exactly
	// what a URLSessionWebSocketTask does.
	conn, _, err := websocket.Dial(dialCtx, url, nil)
	if err != nil {
		t.Fatalf("an upgrade with no Origin header must be accepted: %v", err)
	}
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "") }()

	hello, _ := json.Marshal(syncsrv.Hello{
		Type:       syncsrv.TypeHello,
		Token:      "dev",
		Workspace:  f.WorkspaceID,
		ClientID:   uuid.New(),
		SignalOnly: true,
	})
	if err := conn.Write(dialCtx, websocket.MessageText, hello); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	c := &client{t: t, conn: conn}
	if frame := c.next(5 * time.Second); frame["t"] != syncsrv.TypeReady {
		t.Fatalf("expected ready, got %v", frame)
	}
}
