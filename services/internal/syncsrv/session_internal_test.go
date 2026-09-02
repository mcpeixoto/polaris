package syncsrv

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// These are the failure modes that only appear in the plumbing: a wedged session, a
// starved heartbeat, a panicking goroutine, a frame nobody bounded. None of them needs a
// database, and none of them was catchable from the outside — a wedged session looks
// exactly like a quiet workspace on the wire.

func testLogger() *slog.Logger {
	return platform.NewLogger(platform.Config{Env: "test", LogLevel: "error"})
}

func testPrincipal() *authz.Principal {
	return &authz.Principal{
		AccountID:   uuid.New(),
		UserID:      uuid.New(),
		WorkspaceID: uuid.New(),
		Role:        authz.RoleMember,
		Teams:       authz.NewTeamSet(),
	}
}

// newOfflineSession is a session with no socket behind it. Everything up to the write
// pump — cursors, queueing, resync gating — works without one.
func newOfflineSession(t *testing.T, cursor int64) *Session {
	t.Helper()
	return newSession(nil, testPrincipal(), uuid.New(), cursor, testLogger())
}

func drain(s *Session) []map[string]any {
	var out []map[string]any
	for {
		select {
		case frame := <-s.outbound:
			var m map[string]any
			_ = json.Unmarshal(frame, &m)
			out = append(out, m)
		default:
			return out
		}
	}
}

// A2. The old sync.Once meant a session that had already been told to resync could never
// be told again — and dispatch excludes such a session from every read window, so the
// socket stayed open, said "ready", and never received another delta.
func TestRequestResyncIsRearmedWhenTheCursorMoves(t *testing.T) {
	s := newOfflineSession(t, 100)

	s.requestResync(ReasonGapTooLarge)
	if got := len(drain(s)); got != 1 {
		t.Fatalf("first resync: queued %d frames, want 1", got)
	}

	// Same cursor, inside the cooldown: one resync is already in flight.
	s.requestResync(ReasonGapTooLarge)
	if got := len(drain(s)); got != 0 {
		t.Fatalf("second resync at the same cursor: queued %d frames, want 0", got)
	}

	// The cursor moved, so the earlier resync is spent and a new gap is real news.
	s.advanceCursor(200)
	s.requestResync(ReasonGapTooLarge)
	frames := drain(s)
	if len(frames) != 1 {
		t.Fatalf("resync after the cursor advanced: queued %d frames, want 1", len(frames))
	}
	if frames[0]["t"] != TypeResync {
		t.Fatalf("frame type %v, want %s", frames[0]["t"], TypeResync)
	}
}

// A2, second half: a session excluded from the read window twice running is closed rather
// than left connected and permanently unservable.
func TestMarkExcludedReportsARepeat(t *testing.T) {
	s := newOfflineSession(t, 0)

	if s.markExcluded() {
		t.Fatal("the first exclusion reported itself as a repeat")
	}
	if !s.markExcluded() {
		t.Fatal("the second exclusion did not report itself as a repeat")
	}
	s.clearExcluded()
	if s.markExcluded() {
		t.Fatal("an exclusion after a normal dispatch reported itself as a repeat")
	}
}

// A4. A pong must never be able to cost a client its replica: send() turns a full queue
// into a resync, so heartbeats go through the control path instead.
func TestPongOnAFullQueueDoesNotResync(t *testing.T) {
	s := newOfflineSession(t, 0)
	for i := 0; i < MaxOutboundFrames; i++ {
		s.outbound <- []byte(`{"t":"delta"}`)
	}

	pong, err := json.Marshal(Pong{Type: TypePong, ServerTime: time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
	s.sendControl(pong)

	if s.resyncAt.Load() != 0 {
		t.Fatal("a heartbeat on a full outbound queue asked the client to re-bootstrap")
	}
	if len(s.control) != 1 {
		t.Fatalf("control queue holds %d frames, want 1", len(s.control))
	}

	// And the control queue itself drops rather than escalating when it is full.
	for i := 0; i < maxControlFrames*2; i++ {
		s.sendControl(pong)
	}
	if len(s.control) != maxControlFrames {
		t.Fatalf("control queue holds %d frames, want it capped at %d", len(s.control), maxControlFrames)
	}
	if s.resyncAt.Load() != 0 {
		t.Fatal("a full control queue escalated to a resync")
	}
}

// A4. Control frames are drained ahead of a backlog of deltas, so a delta burst cannot
// starve the heartbeat and make the client's watchdog close a healthy socket.
func TestWritePumpDrainsControlFramesFirst(t *testing.T) {
	s, client := newSocketPair(t)

	for i := 0; i < 4; i++ {
		s.outbound <- []byte(`{"t":"delta","from":0,"to":0,"changes":[]}`)
	}
	s.control <- []byte(`{"t":"pong"}`)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.writePump(ctx)

	first := readFrame(t, client)
	if first["t"] != TypePong {
		t.Fatalf("first frame was %v, want the queued %s", first["t"], TypePong)
	}
}

// A3. lastSeen is written by readPump and read by the watchdog. It was a plain time.Time
// shared across two goroutines; this test drives both at once so -race has something to
// see, and asserts the watchdog still fires.
func TestHeartbeatWatchdogSharesLastSeenSafely(t *testing.T) {
	s := newOfflineSession(t, 0)

	var lastSeen atomic.Int64
	lastSeen.Store(time.Now().UnixNano())

	stop := make(chan struct{})
	go func() {
		tick := time.NewTicker(2 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-stop:
				return
			case <-tick.C:
				lastSeen.Store(time.Now().UnixNano())
			}
		}
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.watchHeartbeat(ctx, &lastSeen, 100*time.Millisecond)

	time.Sleep(400 * time.Millisecond)
	select {
	case <-s.closed:
		t.Fatal("the watchdog closed a session that was being read from continuously")
	default:
	}

	// Stop touching it: two intervals later the session must be closed.
	close(stop)
	select {
	case <-s.closed:
	case <-time.After(2 * time.Second):
		t.Fatal("the watchdog never closed a session that went silent")
	}
}

// A6. offer indexes changes[len-1]; every caller checks the length today, and the first
// one that forgets would take the room's goroutine — and every socket on the box — with it.
func TestOfferIgnoresAnEmptyBatch(t *testing.T) {
	s := newOfflineSession(t, 7)
	s.offer(nil)
	s.offer([]domain.SyncChange{})
	if s.Cursor() != 7 {
		t.Fatalf("cursor moved to %d on an empty batch", s.Cursor())
	}
	if got := len(drain(s)); got != 0 {
		t.Fatalf("an empty batch queued %d frames", got)
	}
}

// A6. writePump runs outside net/http's per-request recover: a panic there took the whole
// process, and with it every socket for every workspace.
func TestWritePumpRecoversFromAPanic(t *testing.T) {
	s := newOfflineSession(t, 0) // no connection: conn.Write panics
	s.outbound <- []byte(`{"t":"delta"}`)

	done := make(chan struct{})
	go func() {
		defer close(done)
		s.writePump(context.Background())
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("writePump did not return after the write panicked")
	}
	select {
	case <-s.closed:
	default:
		t.Fatal("writePump recovered but left the session open")
	}
}

// A11. The documented budget is 500 changes OR 1 MB. Only the count was enforced, so 500
// documents carrying their full text was one multi-megabyte frame.
func TestOfferSplitsFramesOnTheByteBudget(t *testing.T) {
	s := newOfflineSession(t, 0)

	const payloadBytes = 300 * 1024
	blob := `"` + strings.Repeat("x", payloadBytes) + `"`

	changes := make([]domain.SyncChange, 0, 8)
	for i := 0; i < 8; i++ {
		changes = append(changes, domain.SyncChange{
			Version:    int64(i + 1),
			EntityType: "document",
			EntityID:   uuid.New(),
			Op:         "upsert",
			Scope:      authz.WorkspaceScope(),
			ActorType:  "user",
			Payload:    json.RawMessage(blob),
		})
	}

	s.offer(changes)

	frames := 0
	for {
		select {
		case frame := <-s.outbound:
			frames++
			// One overshoot of the budget is allowed: a change is never split in half,
			// so the last one added to a batch may cross the line.
			if len(frame) > MaxDeltaBytes+payloadBytes*2 {
				t.Fatalf("frame of %d bytes exceeds the %d byte budget", len(frame), MaxDeltaBytes)
			}
		default:
			if frames < 2 {
				t.Fatalf("2.4 MB of changes went out as %d frame(s); the byte budget did not split them", frames)
			}
			if s.Cursor() != 8 {
				t.Fatalf("cursor is %d after delivering everything, want 8", s.Cursor())
			}
			return
		}
	}
}

// A11. Frames are capped in count, but a frame is not a fixed size: the heap limit has to
// be measured in bytes or 32 large frames per session is what runs the box out of memory.
func TestSendRefusesBeyondTheOutboundByteBudget(t *testing.T) {
	s := newOfflineSession(t, 0)

	frame := make([]byte, MaxOutboundBytes/4)
	for i := 0; i < 4; i++ {
		if !s.send(frame) {
			t.Fatalf("send refused frame %d while under the byte budget", i)
		}
	}
	if s.send(frame) {
		t.Fatal("send accepted a frame past the outbound byte budget")
	}
	if s.resyncAt.Load() == 0 {
		t.Fatal("a session over its byte budget was not asked to re-bootstrap")
	}
}

// newSocketPair wires a Session to a real WebSocket with no database behind it.
func newSocketPair(t *testing.T) (*Session, *websocket.Conn) {
	t.Helper()

	sessions := make(chan *Session, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"*"}})
		if err != nil {
			return
		}
		s := newSession(conn, testPrincipal(), uuid.New(), 0, testLogger())
		sessions <- s
		<-s.closed
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}))
	t.Cleanup(srv.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	select {
	case s := <-sessions:
		t.Cleanup(func() {
			s.close()
			_ = client.Close(websocket.StatusNormalClosure, "")
		})
		return s, client
	case <-time.After(5 * time.Second):
		t.Fatal("the server never produced a session")
		return nil, nil
	}
}

func readFrame(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read frame: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("decode frame %q: %v", data, err)
	}
	return m
}
