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
// entities were shared with them — was resolved once at connect time and does not change
// while the socket is open. When it does change, the connection is torn down and rebuilt
// rather than mutated, because a permission set that shifts mid-stream is a leak waiting
// to happen: half a delta batch judged under the old rules and half under the new.
type Session struct {
	conn      *websocket.Conn
	principal *authz.Principal
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
		principal: p,
		clientID:  clientID,
		log:       log,
		startedAt: time.Now(),
		outbound:  make(chan []byte, MaxOutboundFrames),
		closed:    make(chan struct{}),
	}
	s.cursor.Store(resume)
	return s
}

func (s *Session) Cursor() int64 { return s.cursor.Load() }

// offer filters a shared batch of changes through this session's visibility set and
// queues whatever survives.
//
// The filtering is the security boundary. It uses authz.Visible — the same predicate the
// GraphQL resolvers use — because a second implementation here is exactly how a private
// team ends up in somebody else's replica.
func (s *Session) offer(changes []domain.SyncChange) {
	from := s.Cursor()

	visible := make([]Change, 0, len(changes))
	for _, c := range changes {
		if c.Version <= from {
			continue
		}
		if !c.Visible(s.principal) {
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

// requestResync tells the client to throw its replica away and bootstrap again.
//
// The jitter is not decoration. A bad deploy that changes clientSchema makes every
// connected client resync at the same instant; spreading them over a minute is the
// difference between a slow minute and Postgres falling over — which would then look
// like a database problem rather than a deploy problem.
func (s *Session) requestResync(reason string) {
	s.resyncOnce.Do(func() {
		frame, err := json.Marshal(Resync{
			Type:         TypeResync,
			Reason:       reason,
			RetryAfterMS: rand.IntN(60_000),
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
	})
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
			// Re-authenticating on a live socket would mean the visibility set changes
			// under a stream that is already in flight. Reconnect instead.
			s.closeWith(TypeError, "ALREADY_CONNECTED", "open a new connection to change identity")
			return

		default:
			s.closeWith(TypeError, "UNKNOWN_FRAME", "unrecognised frame type "+env.Type)
			return
		}
	}
}
