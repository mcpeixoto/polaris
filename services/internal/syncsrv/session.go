package syncsrv

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
)

// Session is one WebSocket connection: one user, one workspace, one cursor into the
// change stream.
//
// The cursor is the whole state. Everything else — which teams the user can see, which
// entities were shared with them — is resolved at connect time, and is re-resolved when
// something happens in the workspace that could have changed it. Never mid-batch: the
// swap happens between batches, so no delta batch is ever judged half under the old rules
// and half under the new.
//
// It has to be re-resolved rather than left alone. A team set frozen for the life of a
// socket means a person who was looking at a team when an admin made it private keeps
// receiving that team's issues — titles, descriptions, every subsequent edit — for as long
// as the tab stays open, because the filter still believes they are entitled to it. It
// fails the other way too: a team created, un-privatised, or joined while the socket is up
// stays invisible until the tab is reloaded.
type Session struct {
	conn *websocket.Conn
	// principal is swapped, not mutated, so a reader always sees one coherent set.
	// AccountID, UserID and WorkspaceID are the same in every value it ever holds.
	principal atomic.Pointer[authz.Principal]
	clientID  uuid.UUID
	log       *slog.Logger

	startedAt time.Time

	// cursor is the highest version this client is known to hold.
	cursor atomic.Int64

	outbound chan []byte
	// queuedBytes is what outbound is actually holding. Frames are bounded in count by
	// MaxOutboundFrames, but a frame is not a fixed size: 500 documents with their full
	// text is megabytes, and thirty-two of those per session is a heap problem multiplied
	// by the session count.
	queuedBytes atomic.Int64

	// control carries pongs and other frames that must not be starved by a delta burst,
	// and must never be able to turn into a resync. It is drained with priority in
	// writePump, and a full control queue drops the frame instead of escalating.
	control chan []byte

	closeOnce sync.Once
	closed    chan struct{}

	// resyncAt/resyncCursor gate repeat resyncs without wedging the session. See
	// requestResync.
	resyncAt     atomic.Int64
	resyncCursor atomic.Int64

	// excluded records that dispatch has already dropped this session from the read
	// window for being too far behind. See markExcluded.
	excluded atomic.Bool
}

func newSession(conn *websocket.Conn, p *authz.Principal, clientID uuid.UUID, resume int64, log *slog.Logger) *Session {
	s := &Session{
		conn:      conn,
		clientID:  clientID,
		log:       log,
		startedAt: time.Now(),
		outbound:  make(chan []byte, MaxOutboundFrames),
		control:   make(chan []byte, maxControlFrames),
		closed:    make(chan struct{}),
	}
	s.principal.Store(p)
	s.cursor.Store(resume)
	return s
}

func (s *Session) Cursor() int64 { return s.cursor.Load() }

// advanceCursor moves the cursor forward over versions this session will never be sent.
//
// The rows behind them could not be read at all — an unparseable scope — so there is
// nothing to deliver and nothing to wait for. Stepping over them is what stops one bad
// row producing a permanent, workspace-wide bootstrap storm.
func (s *Session) advanceCursor(to int64) {
	for {
		cur := s.cursor.Load()
		if to <= cur {
			return
		}
		if s.cursor.CompareAndSwap(cur, to) {
			return
		}
	}
}

// Principal is the caller as most recently resolved.
func (s *Session) Principal() *authz.Principal { return s.principal.Load() }

// adoptPrincipal installs a freshly resolved principal. Called only from the room's
// dispatch goroutine, and only between batches.
func (s *Session) adoptPrincipal(p *authz.Principal) { s.principal.Store(p) }

// offer filters a shared batch of changes through this session's visibility set and
// queues whatever survives.
//
// The filtering is the security boundary. It uses authz.Visible — the same predicate the
// GraphQL resolvers use — because a second implementation here is exactly how a private
// team ends up in somebody else's replica.
func (s *Session) offer(changes []domain.SyncChange) {
	// Guarded rather than assumed: every caller checks today, and the indexing below
	// would panic on the first one that forgets. A panic here takes the room's goroutine
	// with it, and with it every socket on the workspace.
	if len(changes) == 0 {
		return
	}

	from := s.Cursor()
	// Read once, so every row in this batch is judged by the same permission set even if
	// the batch after this one is judged by a newer one.
	principal := s.Principal()

	visible := make([]Change, 0, len(changes))
	for _, c := range changes {
		if c.Version <= from {
			continue
		}
		if !c.Visible(principal) {
			continue
		}
		visible = append(visible, Change{
			Version:    c.Version,
			EntityType: c.EntityType,
			EntityID:   c.EntityID,
			Op:         c.Op,
			Actor:      Actor{Type: c.ActorType, ID: c.ActorID},
			Payload:    c.Payload,
		})
	}

	// The cursor advances past changes this session may not see. It has not missed
	// anything — those rows were never its to receive — and holding the cursor back would
	// make one invisible change look like an unbounded backlog forever after.
	last := changes[len(changes)-1].Version
	if last <= from {
		return
	}

	if len(visible) == 0 {
		s.cursor.Store(last)
		return
	}

	// Split on bytes as well as on count. 500 rows is a small frame for issues and a
	// multi-megabyte one for documents carrying their full text, and the number that
	// stalls a client's main thread on parse is the byte count, not the row count.
	for start := 0; start < len(visible); {
		end := start
		budget := 0
		for end < len(visible) && end-start < MaxDeltaBatch {
			budget += len(visible[end].Payload) + changeOverheadBytes
			end++
			if budget >= MaxDeltaBytes {
				break
			}
		}
		batch := visible[start:end]
		start = end

		frame, err := json.Marshal(Delta{
			Type:    TypeDelta,
			From:    from,
			To:      batch[len(batch)-1].Version,
			Changes: batch,
		})
		if err != nil {
			s.log.Error("marshal delta", "error", err)
			return
		}
		if !s.send(frame) {
			return // queue full; a resync is already on its way
		}
		from = batch[len(batch)-1].Version
	}

	s.cursor.Store(last)
}

// send queues a frame, or gives up on incremental delivery if the client is not draining.
//
// Blocking here would stall the whole room's dispatch goroutine behind one wedged socket,
// so a full queue is treated as "this client cannot keep up" and converted into a resync.
func (s *Session) send(frame []byte) bool {
	if s.queuedBytes.Load()+int64(len(frame)) > MaxOutboundBytes {
		// The frame count is still under its cap but the heap is not. Same verdict:
		// this client is not draining, and buffering more for it costs everybody else.
		s.requestResync(ReasonBufferOverflow)
		return false
	}
	select {
	case s.outbound <- frame:
		s.queuedBytes.Add(int64(len(frame)))
		return true
	case <-s.closed:
		return false
	default:
		s.requestResync(ReasonBufferOverflow)
		return false
	}
}

// sendControl queues a heartbeat-class frame, and drops it if the control queue is full.
//
// Dropping is the point. A pong that went through send would turn a momentarily slow
// client — a background tab, a throttled renderer — into "throw your replica away and
// download it all again", which is a wildly disproportionate answer to a late heartbeat.
// A dropped pong costs nothing: the client pings again on the next interval.
func (s *Session) sendControl(frame []byte) {
	select {
	case s.control <- frame:
	default:
	}
}

// Resync delays. See requestResync and requestPermissionsResync for why they differ.
const (
	fleetResyncJitter       = time.Minute
	permissionsResyncJitter = 2 * time.Second

	// resyncCooldown is how long a resync stays "in flight" for a session whose cursor
	// has not moved. Long enough that a wedged client cannot be told to bootstrap on
	// every commit, short enough that a session is never permanently unrecoverable.
	resyncCooldown = 30 * time.Second
)

// requestResync tells the client to throw its replica away and bootstrap again.
//
// The jitter is not decoration. A bad deploy that changes clientSchema makes every
// connected client resync at the same instant; spreading them over a minute is the
// difference between a slow minute and Postgres falling over — which would then look
// like a database problem rather than a deploy problem.
func (s *Session) requestResync(reason string) {
	// At most one resync in flight, re-armed once the cursor moves or the cooldown
	// expires. A plain sync.Once here is what turned a second gap into silence: dispatch
	// excludes a session past MaxSessionBacklog from the read window, so a session that
	// had spent its only resync stayed connected, kept reporting itself ready, and never
	// received another delta for the life of the socket.
	cursor := s.cursor.Load()
	if last := s.resyncAt.Load(); last != 0 &&
		s.resyncCursor.Load() == cursor &&
		time.Since(time.Unix(0, last)) < resyncCooldown {
		return
	}
	s.resyncAt.Store(time.Now().UnixNano())
	s.resyncCursor.Store(cursor)
	s.sendResync(reason, fleetResyncJitter)
}

// markExcluded records that dispatch has dropped this session from the read window for
// being too far behind, and reports whether that has now happened twice running.
//
// Twice means the resync did not take: the client is still holding a cursor nobody can
// serve incrementally, and no delta will ever reach it again on this socket. Closing is
// the cheap, clean recovery — the client reconnects, and the handshake's retention-floor
// check gives it a bootstrap with a fresh cursor.
func (s *Session) markExcluded() (again bool) { return s.excluded.Swap(true) }

// clearExcluded is called whenever dispatch serves this session normally.
func (s *Session) clearExcluded() { s.excluded.Store(false) }

// requestPermissionsResync tells the client its access changed and it must bootstrap.
//
// Deliberately outside the requestResync gate. That gate is there so that one wedged
// socket or one retention gap cannot produce a stream of resyncs, but a permission change
// is not a
// symptom of the connection — it is news, and a second one on the same socket is as real as
// the first. Being told once and then silently missing the team somebody added you to an
// hour later is the failure the gate would cause.
//
// The delay is short where the other reasons take a minute. That minute exists to stop a
// fleet-wide event — a deploy that bumps the client schema — from arriving at Postgres as
// one spike. A permission change is not fleet-wide: it reaches the sessions of one
// workspace, bounded by its seat count. Spreading those over a minute would only mean a
// person sits looking at a sidebar that is missing the team somebody just added them to,
// with nothing to click, for up to a minute.
func (s *Session) requestPermissionsResync() {
	s.sendResync(ReasonPermissionsChanged, permissionsResyncJitter)
}

func (s *Session) sendResync(reason string, jitter time.Duration) {
	frame, err := json.Marshal(Resync{
		Type:         TypeResync,
		Reason:       reason,
		RetryAfterMS: rand.IntN(int(jitter.Milliseconds())),
	})
	if err != nil {
		return
	}
	select {
	case s.outbound <- frame:
		s.queuedBytes.Add(int64(len(frame)))
	case <-s.closed:
	default:
		// Even the resync will not fit. Close, and let the client's reconnect logic
		// take it from there.
		s.close()
	}
}

func (s *Session) closeWith(msgType, code, message string) {
	frame, err := json.Marshal(Error{Type: msgType, Code: code, Message: message})
	if err == nil {
		select {
		case s.outbound <- frame:
			s.queuedBytes.Add(int64(len(frame)))
		default:
		}
	}
	s.close()
}

func (s *Session) close() {
	s.closeOnce.Do(func() { close(s.closed) })
}

// writePump is the only goroutine that writes to the socket. Concurrent writes to a
// WebSocket are a protocol violation, so funnelling them through one channel is not a
// style choice.
//
// It runs outside net/http's per-request handler, so nothing above it recovers: a panic
// here would take the whole sync process down and every socket on the box with it. The
// socket this goroutine owns is closed on the way out, which the client sees as a
// disconnect and recovers from by reconnecting.
func (s *Session) writePump(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			s.log.Error("panic in session writePump", "panic", r)
			s.close()
		}
	}()

	for {
		// Control frames first, unconditionally. A delta burst must not be able to
		// starve a pong: the client's watchdog would then close a healthy socket, and
		// the reconnect storm that follows looks like a server fault.
		select {
		case frame := <-s.control:
			if !s.write(ctx, frame, 0) {
				return
			}
			continue
		default:
		}

		select {
		case <-ctx.Done():
			return
		case <-s.closed:
			return
		case frame := <-s.control:
			if !s.write(ctx, frame, 0) {
				return
			}
		case frame := <-s.outbound:
			if !s.write(ctx, frame, int64(len(frame))) {
				return
			}
		}
	}
}

// write puts one frame on the wire, releasing queued bytes back to the session's budget.
func (s *Session) write(ctx context.Context, frame []byte, queued int64) bool {
	writeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	err := s.conn.Write(writeCtx, websocket.MessageText, frame)
	cancel()
	if queued > 0 {
		s.queuedBytes.Add(-queued)
	}
	if err != nil {
		s.close()
		return false
	}
	return true
}

// watchHeartbeat closes the session when two ping intervals pass with nothing read.
//
// A separate timer rather than a read deadline: the read deadline would also fire on a
// healthy but quiet connection, and quiet is the normal state of this socket.
//
// lastSeen is an atomic because it is written by readPump on every frame and read here on
// every tick — two goroutines, no lock.
func (s *Session) watchHeartbeat(ctx context.Context, lastSeen *atomic.Int64, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.closed:
			return
		case <-ticker.C:
			if time.Since(time.Unix(0, lastSeen.Load())) > 2*interval {
				s.close()
				return
			}
		}
	}
}

// readPump handles pings and subscriptions. Mutations never arrive here — they go over
// POST /graphql, so that the write path, its authorisation and its rate limiting exist
// exactly once.
func (s *Session) readPump(ctx context.Context) {
	// Atomic because the watchdog goroutine reads it while this one writes it.
	var lastSeen atomic.Int64
	lastSeen.Store(time.Now().UnixNano())
	go s.watchHeartbeat(ctx, &lastSeen, HeartbeatInterval)

	for {
		_, data, err := s.conn.Read(ctx)
		if err != nil {
			if !errors.Is(err, context.Canceled) &&
				websocket.CloseStatus(err) == -1 {
				s.log.Debug("socket read ended", "error", err)
			}
			s.close()
			return
		}
		lastSeen.Store(time.Now().UnixNano())

		var env envelope
		if err := json.Unmarshal(data, &env); err != nil {
			s.closeWith(TypeError, "BAD_FRAME", "could not parse that frame")
			return
		}

		switch env.Type {
		case TypePing:
			frame, err := json.Marshal(Pong{Type: TypePong, ServerTime: time.Now().UTC()})
			if err == nil {
				s.sendControl(frame)
			}

		case TypeSubscribe:
			// Presence channels are ephemeral and carry no persisted data. Accepted and
			// ignored until presence ships, so that a newer client talking to an older
			// server degrades rather than disconnects.

		case TypeHello:
			// Re-authenticating on a live socket would mean a different identity behind a
			// stream that is already in flight. Reconnect instead.
			s.closeWith(TypeError, "ALREADY_CONNECTED", "open a new connection to change identity")
			return

		default:
			s.closeWith(TypeError, "UNKNOWN_FRAME", "unrecognised frame type "+env.Type)
			return
		}
	}
}
