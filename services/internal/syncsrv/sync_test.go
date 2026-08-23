package syncsrv_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/syncsrv"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// These are the M0 acceptance tests for the sync engine, from
// docs/07-milestones/00-milestone-0.md:
//
//	1. create an issue in one client, see it in another in under 500ms
//	6. a user removed from a team receives revoke and the team's issues vanish
//	7. reconnect resumes from the client's version and loses nothing
//
// They run against a real Postgres and a real WebSocket, because every one of them is
// about behaviour that only exists once LISTEN/NOTIFY, the version counter and the socket
// are all in play at once. A mocked hub would assert that the code calls the functions
// its author expected, which is exactly the assumption under test.

// fakeVerifier maps a token straight to an account id, so a socket test does not need a
// signing key or a login round trip.
type fakeVerifier struct{ accounts map[string]uuid.UUID }

func (f fakeVerifier) VerifyAccessToken(tok string) (uuid.UUID, error) {
	if id, ok := f.accounts[tok]; ok {
		return id, nil
	}
	return uuid.Nil, platform.Unauthorized("unknown token")
}

type harness struct {
	svc      *domain.Service
	server   *httptest.Server
	fixture  *testutil.Fixture
	verifier fakeVerifier
	cancel   context.CancelFunc
}

func newHarness(t *testing.T) *harness {
	t.Helper()

	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	ctx, cancel := context.WithCancel(context.Background())
	log := platform.NewLogger(platform.Config{Env: "test", LogLevel: "error"})

	hub := syncsrv.NewHub(svc, log)
	go hub.Run(ctx)

	verifier := fakeVerifier{accounts: map[string]uuid.UUID{"dev": f.AccountID}}
	// httptest serves on 127.0.0.1 with a random port, so the origin allowance has to be
	// permissive here; production pins it to the configured public host.
	srv := httptest.NewServer(syncsrv.NewServer(hub, svc, verifier, log, []string{"*"}))

	t.Cleanup(func() {
		srv.Close()
		cancel()
	})

	return &harness{svc: svc, server: srv, fixture: f, verifier: verifier, cancel: cancel}
}

// client is a minimal protocol client: connect, hello, collect frames.
type client struct {
	t    *testing.T
	conn *websocket.Conn
}

func (h *harness) connect(t *testing.T, token string, resume int64) *client {
	t.Helper()

	url := "ws" + strings.TrimPrefix(h.server.URL, "http")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close(websocket.StatusNormalClosure, "") })

	hello, _ := json.Marshal(syncsrv.Hello{
		Type:         syncsrv.TypeHello,
		Token:        token,
		Workspace:    h.fixture.WorkspaceID,
		Resume:       resume,
		ClientSchema: syncsrv.ClientSchema,
		ClientID:     uuid.New(),
	})
	if err := conn.Write(ctx, websocket.MessageText, hello); err != nil {
		t.Fatalf("write hello: %v", err)
	}

	return &client{t: t, conn: conn}
}

// next reads one frame, failing the test rather than hanging forever if none arrives.
func (c *client) next(timeout time.Duration) map[string]any {
	c.t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	_, data, err := c.conn.Read(ctx)
	if err != nil {
		c.t.Fatalf("read frame: %v", err)
	}
	var frame map[string]any
	if err := json.Unmarshal(data, &frame); err != nil {
		c.t.Fatalf("decode frame: %v", err)
	}
	return frame
}

// awaitDelta reads until a delta arrives, skipping the housekeeping frames a session may
// legitimately emit first.
func (c *client) awaitDelta(timeout time.Duration) map[string]any {
	c.t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		frame := c.next(time.Until(deadline))
		switch frame["t"] {
		case syncsrv.TypeDelta:
			return frame
		case syncsrv.TypeError:
			c.t.Fatalf("server refused the connection: %v", frame)
		}
	}
	c.t.Fatal("no delta arrived before the deadline")
	return nil
}

func changesIn(t *testing.T, delta map[string]any) []map[string]any {
	t.Helper()
	raw, ok := delta["changes"].([]any)
	if !ok {
		t.Fatalf("delta had no changes: %v", delta)
	}
	out := make([]map[string]any, 0, len(raw))
	for _, c := range raw {
		m, ok := c.(map[string]any)
		if !ok {
			t.Fatalf("malformed change: %v", c)
		}
		out = append(out, m)
	}
	return out
}

func principalFor(t *testing.T, h *harness, accountID uuid.UUID) *authz.Principal {
	t.Helper()
	p, err := h.svc.ResolvePrincipal(context.Background(), accountID, h.fixture.WorkspaceID)
	if err != nil {
		t.Fatalf("resolve principal: %v", err)
	}
	return p
}

// Acceptance test 1.
func TestSync_WriteInOneClientReachesAnother(t *testing.T) {
	h := newHarness(t)

	a := h.connect(t, "dev", 0)
	if ready := a.next(5 * time.Second); ready["t"] != syncsrv.TypeReady {
		t.Fatalf("expected ready, got %v", ready)
	}
	b := h.connect(t, "dev", 0)
	if ready := b.next(5 * time.Second); ready["t"] != syncsrv.TypeReady {
		t.Fatalf("expected ready, got %v", ready)
	}

	p := principalFor(t, h, h.fixture.AccountID)

	start := time.Now()
	issue, _, err := h.svc.CreateIssue(context.Background(), p, domain.CreateIssueInput{
		TeamID: h.fixture.TeamID,
		Title:  "Written by the other tab",
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}

	for name, c := range map[string]*client{"a": a, "b": b} {
		delta := c.awaitDelta(5 * time.Second)
		elapsed := time.Since(start)

		found := false
		for _, ch := range changesIn(t, delta) {
			if ch["id"] == issue.ID.String() && ch["type"] == "issue" && ch["op"] == "upsert" {
				found = true
			}
		}
		if !found {
			t.Errorf("client %s did not receive the new issue: %v", name, delta)
		}
		// The budget is 500ms p99 from commit to render. This asserts the server half of
		// it with generous headroom, so it fails on a real regression rather than on a
		// loaded CI box.
		if elapsed > 2*time.Second {
			t.Errorf("client %s waited %s for a delta; the budget is 500ms end to end", name, elapsed)
		}
	}
}

// Acceptance test 7.
func TestSync_ResumeAfterDisconnectLosesNothing(t *testing.T) {
	h := newHarness(t)
	p := principalFor(t, h, h.fixture.AccountID)
	ctx := context.Background()

	a := h.connect(t, "dev", 0)
	ready := a.next(5 * time.Second)
	version := int64(ready["version"].(float64))

	// Drop the connection and write while nobody is listening — the laptop-lid case.
	_ = a.conn.Close(websocket.StatusNormalClosure, "")

	var created []uuid.UUID
	for i := range 3 {
		issue, _, err := h.svc.CreateIssue(ctx, p, domain.CreateIssueInput{
			TeamID: h.fixture.TeamID,
			Title:  "Written while offline " + string(rune('A'+i)),
		})
		if err != nil {
			t.Fatalf("create issue: %v", err)
		}
		created = append(created, issue.ID)
	}

	// Reconnecting at the old version must deliver everything missed, without a resync.
	b := h.connect(t, "dev", version)
	if ready := b.next(5 * time.Second); ready["t"] != syncsrv.TypeReady {
		t.Fatalf("expected ready, got %v", ready)
	}

	seen := map[string]bool{}
	deadline := time.Now().Add(5 * time.Second)
	for len(seen) < len(created) && time.Now().Before(deadline) {
		frame := b.next(time.Until(deadline))
		if frame["t"] == syncsrv.TypeResync {
			t.Fatalf("a client resuming from a live version must be caught up incrementally, not told to re-bootstrap: %v", frame)
		}
		if frame["t"] != syncsrv.TypeDelta {
			continue
		}
		for _, ch := range changesIn(t, frame) {
			if id, ok := ch["id"].(string); ok {
				seen[id] = true
			}
		}
	}

	for _, id := range created {
		if !seen[id.String()] {
			t.Errorf("issue %s written while disconnected never reached the resumed client", id)
		}
	}
}

// Acceptance test 6. The mechanism has to be right in M0 even though private teams are M3.
func TestSync_RemovedFromTeamReceivesRevoke(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	// A second member, in the team, with their own socket.
	memberID := h.fixture.NewUser(t, "grace", "member", true)
	memberAccount := accountOf(t, h, memberID)
	h.verifier.accounts["grace"] = memberAccount

	c := h.connect(t, "grace", 0)
	if ready := c.next(5 * time.Second); ready["t"] != syncsrv.TypeReady {
		t.Fatalf("expected ready, got %v", ready)
	}

	admin := principalFor(t, h, h.fixture.AccountID)
	if _, err := h.svc.RemoveTeamMember(ctx, admin, h.fixture.TeamID, memberID); err != nil {
		t.Fatalf("remove team member: %v", err)
	}

	// Without this the removed member keeps a complete, readable, permanently stale copy
	// of the team's issues — and nothing errors, so nobody finds out.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		frame := c.next(time.Until(deadline))
		if frame["t"] != syncsrv.TypeDelta {
			continue
		}
		for _, ch := range changesIn(t, frame) {
			if ch["op"] != "revoke" {
				continue
			}
			if _, hasPayload := ch["payload"]; hasPayload {
				t.Error("a revoke must not carry a payload — it hands the data over on the way out")
			}
			return
		}
	}
	t.Error("no revoke reached the removed member")
}

func TestSync_RejectsAMismatchedClientSchema(t *testing.T) {
	h := newHarness(t)

	url := "ws" + strings.TrimPrefix(h.server.URL, "http")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "") }()

	// A client whose local store predates the current shape must be refused rather than
	// resumed: applying new-shaped deltas onto old-shaped rows corrupts the replica in a
	// way that surfaces days later as random rendering bugs.
	hello, _ := json.Marshal(syncsrv.Hello{
		Type:         syncsrv.TypeHello,
		Token:        "dev",
		Workspace:    h.fixture.WorkspaceID,
		ClientSchema: syncsrv.ClientSchema + 1,
		ClientID:     uuid.New(),
	})
	if err := conn.Write(ctx, websocket.MessageText, hello); err != nil {
		t.Fatalf("write hello: %v", err)
	}

	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var frame map[string]any
	_ = json.Unmarshal(data, &frame)
	if frame["t"] != syncsrv.TypeError {
		t.Fatalf("a schema mismatch must be refused, got %v", frame)
	}
}

func TestSync_RejectsAnUnknownToken(t *testing.T) {
	h := newHarness(t)

	c := h.connect(t, "not-a-real-token", 0)
	frame := c.next(5 * time.Second)
	if frame["t"] != syncsrv.TypeError {
		t.Fatalf("an unauthenticated socket must be refused, got %v", frame)
	}
	if frame["code"] != string(platform.CodeUnauthorized) {
		t.Errorf("expected UNAUTHENTICATED, got %v", frame["code"])
	}
}

func TestSync_PingIsAnswered(t *testing.T) {
	h := newHarness(t)

	c := h.connect(t, "dev", 0)
	if ready := c.next(5 * time.Second); ready["t"] != syncsrv.TypeReady {
		t.Fatalf("expected ready, got %v", ready)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.conn.Write(ctx, websocket.MessageText, []byte(`{"t":"ping"}`)); err != nil {
		t.Fatalf("write ping: %v", err)
	}

	// The heartbeat is not decoration: Cloudflare cuts an idle proxied WebSocket at about
	// 100 seconds, so a quiet connection has to prove it is alive or it silently stops
	// delivering.
	frame := c.next(5 * time.Second)
	if frame["t"] != syncsrv.TypePong {
		t.Fatalf("expected a pong, got %v", frame)
	}
}

// accountOf finds the account behind a workspace user, which the fixture creates but does
// not hand back.
func accountOf(t *testing.T, h *harness, userID uuid.UUID) uuid.UUID {
	t.Helper()

	var accountID uuid.UUID
	err := h.svc.DB().Pool().QueryRow(context.Background(),
		`SELECT account_id FROM "user" WHERE id = $1`, userID).Scan(&accountID)
	if err != nil {
		t.Fatalf("look up account: %v", err)
	}
	return accountID
}

// A client whose cursor is ahead of the server is told to re-bootstrap, not ignored.
//
// This is the shape of a restore from backup: the workspace's version counter goes
// backwards underneath clients that had already seen further. It is not the gap the
// retention floor catches — that one is the client falling behind — and the floor check
// cannot see it, because a cursor above the newest version is not below the oldest one.
//
// Left unhandled the failure is mute, which is what makes it worth a test of its own.
// `catchUp` loops while `cursor < current`, which is already false, so it returns having
// done nothing and logs nothing. The socket stays open, the client believes it is online
// and current, and it shows the workspace as it was before the restore until the server's
// counter climbs back past the cursor — days, on a real one. Every other failure in this
// protocol announces itself.
func TestSync_AClientAheadOfTheServerIsToldToResync(t *testing.T) {
	h := newHarness(t)

	// Far enough ahead that no amount of concurrent test traffic could reach it, so the
	// test is asserting the rewind and not racing the fixture's own writes.
	const ahead = 1_000_000

	c := h.connect(t, "dev", ahead)

	ready := c.next(5 * time.Second)
	if ready["t"] != syncsrv.TypeReady {
		t.Fatalf("expected ready first, so the client has a version to show progress against, got %v", ready)
	}

	// The resync must arrive on its own, without anything being written to provoke it.
	// A client that has to wait for unrelated traffic before being told its replica is
	// wrong is a client that shows stale data for as long as the workspace is quiet.
	frame := c.next(5 * time.Second)
	if frame["t"] != syncsrv.TypeResync {
		t.Fatalf("a client resuming from a version the server has never reached must be told to "+
			"re-bootstrap; got %v", frame)
	}
	if frame["reason"] != syncsrv.ReasonServerRewound {
		t.Errorf("reason was %q, want %q — an operator reading this in a log should be looking "+
			"at what happened to the database, not at how long somebody's laptop was shut",
			frame["reason"], syncsrv.ReasonServerRewound)
	}
}

// A team set resolved once, at connect, is a leak with a clock on it.
//
// The person in this test is looking at a workspace when an admin makes a team private. They
// are not in that team. Their socket's filter is still working from the set it resolved when
// they connected — which contained the team, because at that moment it was public — so every
// issue written into the private team afterwards is judged visible and sent to them: titles,
// descriptions, every subsequent edit, for as long as the tab stays open. Nothing errors, and
// nothing in the interface admits it, because the client has already been told to forget the
// team and simply files the rows away.
func TestSync_PrivatisingATeamStopsItsDeltasReachingAConnectedNonMember(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	h.fixture.SetPlan(t, entitlement.PlanPro)

	admin := principalFor(t, h, h.fixture.AccountID)
	team, _, err := h.svc.CreateTeam(ctx, admin, domain.CreateTeamInput{Key: "OPS", Name: "Operations"})
	if err != nil {
		t.Fatalf("create team: %v", err)
	}

	// A workspace member who is not in OPS, watching from their own socket.
	outsiderID := h.fixture.NewUser(t, "grace", "member", true)
	h.verifier.accounts["grace"] = accountOf(t, h, outsiderID)
	c := h.connect(t, "grace", 0)
	if ready := c.next(5 * time.Second); ready["t"] != syncsrv.TypeReady {
		t.Fatalf("expected ready, got %v", ready)
	}

	// While it is public they are entitled to it, and the test is worth nothing unless
	// they really do receive it.
	if _, _, err := h.svc.CreateIssue(ctx, admin, domain.CreateIssueInput{
		TeamID: team.ID, Title: "Visible while the team is public",
	}); err != nil {
		t.Fatalf("public issue: %v", err)
	}
	if !awaitTitle(t, c, "Visible while the team is public", 10*time.Second) {
		t.Fatal("the non-member never saw the public team's issue, so this test proves nothing")
	}

	if _, _, err := h.svc.UpdateTeam(ctx, admin, domain.UpdateTeamInput{
		ID: team.ID, Private: boolPtr(true),
	}); err != nil {
		t.Fatalf("privatize: %v", err)
	}
	if _, _, err := h.svc.CreateIssue(ctx, admin, domain.CreateIssueInput{
		TeamID: team.ID, Title: "Written after the team went private",
	}); err != nil {
		t.Fatalf("private issue: %v", err)
	}
	// A write they ARE entitled to, emitted last, so "nothing arrived" cannot be mistaken
	// for "the leak was fixed".
	if _, _, err := h.svc.CreateIssue(ctx, admin, domain.CreateIssueInput{
		TeamID: h.fixture.TeamID, Title: "A public marker they may see",
	}); err != nil {
		t.Fatalf("marker issue: %v", err)
	}

	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		frame := c.next(time.Until(deadline))
		if frame["t"] != syncsrv.TypeDelta {
			continue
		}
		for _, ch := range changesIn(t, frame) {
			payload, _ := ch["payload"].(map[string]any)
			switch payload["title"] {
			case "Written after the team went private":
				t.Fatal("an issue from a private team reached a non-member's live socket")
			case "A public marker they may see":
				return
			}
		}
	}
	t.Fatal("the marker never arrived; the socket stopped delivering anything")
}

// awaitTitle reads deltas until one carries an entity with this title.
func awaitTitle(t *testing.T, c *client, title string, timeout time.Duration) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		frame := c.next(time.Until(deadline))
		if frame["t"] != syncsrv.TypeDelta {
			continue
		}
		for _, ch := range changesIn(t, frame) {
			if payload, ok := ch["payload"].(map[string]any); ok && payload["title"] == title {
				return true
			}
		}
	}
	return false
}

func boolPtr(b bool) *bool { return &b }
