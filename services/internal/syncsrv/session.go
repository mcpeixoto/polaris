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

	closeOnce sync.Once
	closed    chan struct{}

	resyncOnce sync.Once
}

func newSession(conn *websocket.Conn, p *authz.Principal, clientID uuid.UUID, resume int64, log *slog.Logger) *Session {
	s := &Session{
		conn:      conn,
		clientID:  clientID,
		log:       log,
		startedAt: time.Now(),
		outbound:  make(chan []byte, MaxOutboundFrames),
		closed:    make(chan struct{}),
	}
	s.principal.Store(p)
	s.cursor.Store(resume)
	return s
}

func (s *Session) Cursor() int64 { return s.cursor.Load() }

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

	for start := 0; start < len(visible); start += MaxDeltaBatch {
		end := min(start+MaxDeltaBatch, len(visible))
		batch := visible[start:end]

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
	select {
	case s.outbound <- frame:
		return true
	case <-s.closed:
		return false
	default:
		s.requestResync(ReasonBufferOverflow)
		return false
	}
}

// Resync delays. See requestResync and requestPermissionsResync for why they differ.
const (
	fleetResyncJitter       = time.Minute
	permissionsResyncJitter = 2 * time.Second
)

// requestResync tells the client to throw its replica away and bootstrap again.
//
// The jitter is not decoration. A bad deploy that changes clientSchema makes every
// connected client resync at the same instant; spreading them over a minute is the
// difference between a slow minute and Postgres falling over — which would then look
// like a database problem rather than a deploy problem.
func (s *Session) requestResync(reason string) {
	s.resyncOnce.Do(func() { s.sendResync(reason, fleetResyncJitter) })
}

// requestPermissionsResync tells the client its access changed and it must bootstrap.
//
// Deliberately outside resyncOnce. The once-gate is there so that one wedged socket or one
// retention gap cannot produce a stream of resyncs, but a permission change is not a
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
func (s *Session) writePump(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.closed:
			return
		case frame := <-s.outbound:
			writeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := s.conn.Write(writeCtx, websocket.MessageText, frame)
			cancel()
			if err != nil {
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
	lastSeen := time.Now()

	// A separate timer rather than a read deadline: the read deadline would also fire on
	// a healthy but quiet connection, and quiet is the normal state of this socket.
	ticker := time.NewTicker(HeartbeatInterval)
	defer ticker.Stop()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-s.closed:
				return
			case <-ticker.C:
				if time.Since(lastSeen) > HeartbeatTimeout {
					s.close()
					return
				}
			}
		}
	}()

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
		lastSeen = time.Now()

		var env envelope
		if err := json.Unmarshal(data, &env); err != nil {
			s.closeWith(TypeError, "BAD_FRAME", "could not parse that frame")
			return
		}

		switch env.Type {
		case TypePing:
			frame, err := json.Marshal(Pong{Type: TypePong, ServerTime: time.Now().UTC()})
			if err == nil {
				s.send(frame)
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
