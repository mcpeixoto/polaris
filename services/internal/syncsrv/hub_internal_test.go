package syncsrv

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// A6. room.run is started with `go`, outside net/http's per-request recover. A panic in
// it used to take the process down and every socket for every workspace with it. A nil
// service is the cheapest way to make the dispatch it drives panic for real.
func TestRoomRunRecoversFromAPanic(t *testing.T) {
	h := NewHub(nil, testLogger())
	r := newRoom(h, uuid.New())
	if err := r.add(newOfflineSession(t, 0)); err != nil {
		t.Fatalf("add session: %v", err)
	}

	go r.run()
	r.notify(0)

	select {
	case <-r.done:
	case <-time.After(5 * time.Second):
		t.Fatal("the room neither panicked out nor stopped; the recover did not run")
	}
}

// A10. Hub.Register creates the room and starts its goroutine before add can refuse. The
// refusal path is a connection flood, so leaking a room and a goroutine on every attempt
// is the worst possible time to do it.
func TestRegisterDoesNotLeakARoomWhenAddFails(t *testing.T) {
	h := NewHub(nil, testLogger())
	h.sessionCap = 0 // every add refuses, so the failure path is the only path

	s := newOfflineSession(t, 0)
	err := h.Register(s)
	if err == nil {
		t.Fatal("Register accepted a session past the workspace cap")
	}
	if code := platform.CodeOf(err); code != platform.CodeRateLimited {
		t.Fatalf("Register refused with %s, want %s", code, platform.CodeRateLimited)
	}

	h.mu.RLock()
	rooms := len(h.rooms)
	h.mu.RUnlock()
	if rooms != 0 {
		t.Fatalf("a refused Register left %d room(s) behind", rooms)
	}
}

// A1. One change_log row with an unparseable scope used to make every session in the
// workspace re-bootstrap on every subsequent write, forever: the row is inside the
// retention window so it is never pruned, and an empty page read as "pruned" is a
// permanent bootstrap storm that presents as "the app keeps reloading".
func TestCatchUpStepsOverUnreadableRows(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// Scopes that will not decode into an authz.Scope at all, which is the case that
	// makes a page come back empty while the rows are still there.
	appendChange(t, db, f.WorkspaceID, 1, `"nonsense"`)
	appendChange(t, db, f.WorkspaceID, 2, `123`)
	appendChange(t, db, f.WorkspaceID, 3, `[1,2]`)
	setWorkspaceVersion(t, db, f.WorkspaceID, 3)

	srv := NewServer(NewHub(svc, testLogger()), svc, nil, testLogger(), nil)
	session := newSession(nil, f.Principal(), uuid.New(), 0, testLogger())

	if err := srv.catchUp(ctx, session); err != nil {
		t.Fatalf("catch up: %v", err)
	}

	if got := session.Cursor(); got != 3 {
		t.Fatalf("cursor is %d after catching up over an unreadable row, want 3", got)
	}
	for _, frame := range drain(session) {
		if frame["t"] == TypeResync {
			t.Fatal("an unreadable change_log row was reported to the client as a retention gap")
		}
	}
}

// A1, the other half: nothing readable AND nothing scanned really is a retention gap, and
// still has to produce a resync.
func TestCatchUpResyncsWhenTheRowsAreGone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	// A watermark with no rows underneath it: exactly what pruning leaves behind.
	setWorkspaceVersion(t, db, f.WorkspaceID, 9)

	srv := NewServer(NewHub(svc, testLogger()), svc, nil, testLogger(), nil)
	session := newSession(nil, f.Principal(), uuid.New(), 0, testLogger())

	if err := srv.catchUp(context.Background(), session); err != nil {
		t.Fatalf("catch up: %v", err)
	}
	if !hasResync(drain(session)) {
		t.Fatal("a real retention gap did not produce a resync")
	}
}

// A5. `ready` has already gone out by the time catch-up runs, so a failure that is only
// logged leaves the client saying it is online and current while holding a cursor nobody
// checked — stale until the next write to the workspace, which on a quiet Sunday is a day.
func TestCatchUpFailureAsksTheClientToBootstrap(t *testing.T) {
	db := testutil.NewDB(t)
	svc := domain.NewService(db)

	srv := NewServer(NewHub(svc, testLogger()), svc, nil, testLogger(), nil)
	// A workspace that does not exist: WorkspaceVersion fails, which is the same shape as
	// any other database failure during catch-up.
	p := &authz.Principal{
		AccountID:   uuid.New(),
		UserID:      uuid.New(),
		WorkspaceID: uuid.New(),
		Role:        authz.RoleMember,
		Teams:       authz.NewTeamSet(),
	}
	session := newSession(nil, p, uuid.New(), 0, testLogger())

	if err := srv.catchUp(context.Background(), session); err == nil {
		t.Fatal("catch-up against a missing workspace returned no error")
	}
	if !hasResync(drain(session)) {
		t.Fatal("a failed catch-up left the session marked ready with an unchecked cursor")
	}
}

// A9. refreshPrincipals used to be one query per session, run inline on the room's only
// goroutine. Tabs share an account, so the lookups are now deduplicated — and each session
// still gets its own principal value, because the token-derived fields are the socket's.
func TestRefreshPrincipalsIsPerAccountAndPerSession(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	h := NewHub(svc, testLogger())
	r := newRoom(h, f.WorkspaceID)

	tabs := make([]*Session, 3)
	for i := range tabs {
		p := f.Principal()
		p.Scopes = []string{"scope-" + string(rune('a'+i))}
		tabs[i] = newSession(nil, p, uuid.New(), 0, testLogger())
		if err := r.add(tabs[i]); err != nil {
			t.Fatalf("add session: %v", err)
		}
	}

	r.refreshPrincipals(context.Background(), r.snapshot())

	seen := map[*authz.Principal]bool{}
	for i, s := range tabs {
		fresh := s.Principal()
		if seen[fresh] {
			t.Fatal("two tabs on one account ended up sharing a principal value")
		}
		seen[fresh] = true
		if len(fresh.Scopes) != 1 || fresh.Scopes[0] != "scope-"+string(rune('a'+i)) {
			t.Fatalf("tab %d lost its own token scopes: %v", i, fresh.Scopes)
		}
		if !fresh.Teams.Has(f.TeamID) {
			t.Fatalf("tab %d lost the team it is a member of", i)
		}
	}
}

// A1, at the other caller. dispatch drives every session in the workspace, so reading an
// unreadable page as a retention gap resyncs all of them — on every commit, forever.
func TestDispatchStepsOverUnreadableRows(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	appendChange(t, db, f.WorkspaceID, 1, `"nonsense"`)
	appendChange(t, db, f.WorkspaceID, 2, `[1,2]`)
	setWorkspaceVersion(t, db, f.WorkspaceID, 2)

	r := newRoom(NewHub(svc, testLogger()), f.WorkspaceID)
	session := newSession(nil, f.Principal(), uuid.New(), 0, testLogger())
	if err := r.add(session); err != nil {
		t.Fatalf("add session: %v", err)
	}

	r.dispatch(context.Background())

	if got := session.Cursor(); got != 2 {
		t.Fatalf("cursor is %d after a dispatch over unreadable rows, want 2", got)
	}
	if hasResync(drain(session)) {
		t.Fatal("unreadable rows made a live session re-bootstrap")
	}
}

// A2. A session excluded from the read window a second time is closed. Left alone it is a
// socket that stays open, keeps reporting itself ready, and never receives another delta.
func TestDispatchClosesASessionItCannotServeTwice(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	// Far enough past the backlog limit that no session can be caught up incrementally.
	setWorkspaceVersion(t, db, f.WorkspaceID, MaxSessionBacklog*2)

	r := newRoom(NewHub(svc, testLogger()), f.WorkspaceID)
	session := newSession(nil, f.Principal(), uuid.New(), 0, testLogger())
	if err := r.add(session); err != nil {
		t.Fatalf("add session: %v", err)
	}

	r.dispatch(context.Background())
	select {
	case <-session.closed:
		t.Fatal("the first unservable dispatch closed the socket instead of asking for a bootstrap")
	default:
	}
	if !hasResync(drain(session)) {
		t.Fatal("a session past the backlog limit was not asked to re-bootstrap")
	}

	r.dispatch(context.Background())
	select {
	case <-session.closed:
	default:
		t.Fatal("a session excluded from the read window twice was left connected and unservable")
	}
}

// A7. The room used to read the database on context.Background(): one stuck query froze
// every session on the workspace indefinitely, sockets open, clients reporting themselves
// online. Dispatch is now bounded, and the room's context dies with the room.
func TestDispatchIsBoundedAndSurvivesAFailedRead(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)

	appendChange(t, db, f.WorkspaceID, 1, `{"kind":"workspace"}`)
	setWorkspaceVersion(t, db, f.WorkspaceID, 1)

	r := newRoom(NewHub(svc, testLogger()), f.WorkspaceID)
	session := newSession(nil, f.Principal(), uuid.New(), 0, testLogger())
	if err := r.add(session); err != nil {
		t.Fatalf("add session: %v", err)
	}

	// A dispatch whose budget is already spent gives up rather than blocking, and leaves
	// the cursor alone: a timed-out read is not evidence that anything was pruned.
	expired, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
	defer cancel()
	r.dispatch(expired)
	if got := session.Cursor(); got != 0 {
		t.Fatalf("a timed-out dispatch moved the cursor to %d", got)
	}
	if hasResync(drain(session)) {
		t.Fatal("a timed-out read was reported to the client as a retention gap")
	}

	// The next wake retries on a live context and delivers.
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		r.run()
	}()
	r.notify(0)

	deadline := time.After(5 * time.Second)
	for session.Cursor() != 1 {
		select {
		case <-deadline:
			t.Fatalf("the room never recovered from the timed-out read; cursor is %d", session.Cursor())
		case <-time.After(10 * time.Millisecond):
		}
	}

	// And the room's goroutine goes away with the room rather than outliving it.
	r.stop()
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("the room goroutine outlived the room")
	}
}

func hasResync(frames []map[string]any) bool {
	for _, f := range frames {
		if f["t"] == TypeResync {
			return true
		}
	}
	return false
}

// appendChange writes one change_log row with a scope the caller chooses, which is the
// only way to produce the malformed row A1 is about.
func appendChange(t *testing.T, db *store.DB, workspaceID uuid.UUID, version int64, scope string) {
	t.Helper()
	_, err := db.Pool().Exec(context.Background(),
		`INSERT INTO change_log (workspace_id, version, entity_type, entity_id, op,
		                         scope, actor_type, payload, changed_fields)
		 VALUES ($1, $2, 'issue', $3, 'upsert', $4::jsonb, 'user', $5::jsonb, '{}'::text[])`,
		workspaceID, version, uuid.New(), scope, json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("insert change_log row: %v", err)
	}
}

func setWorkspaceVersion(t *testing.T, db *store.DB, workspaceID uuid.UUID, version int64) {
	t.Helper()
	_, err := db.Pool().Exec(context.Background(),
		`UPDATE workspace_version SET version = $2 WHERE workspace_id = $1`, workspaceID, version)
	if err != nil {
		t.Fatalf("set workspace version: %v", err)
	}
}
