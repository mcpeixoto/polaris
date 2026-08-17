package syncsrv

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Limits. Every one of these exists because the alternative is a failure mode that only
// appears under load, in production, at the worst possible moment.
const (
	// MaxDeltaBatch bounds one frame. A client that has been asleep for an hour gets
	// several frames rather than one enormous one that stalls its main thread on parse.
	MaxDeltaBatch = 500

	// MaxSessionBacklog is how many changes a slow session may fall behind before it is
	// cheaper to make it re-bootstrap than to keep buffering for it. A tab throttled in
	// a background window is the common case and must not be allowed to grow the
	// server's heap without bound.
	MaxSessionBacklog = 5000

	// MaxOutboundFrames is the write queue depth per session. Small on purpose: when a
	// socket stops draining, the useful signal is "this connection is broken", and
	// discovering it after four frames is better than after four hundred.
	MaxOutboundFrames = 32

	// MaxSessionsPerUser caps tabs and devices. The oldest is closed rather than the
	// newest rejected, because the newest is the window the person is actually looking at.
	MaxSessionsPerUser = 8

	// MaxSessionsPerWorkspace is a blast-radius limit: one runaway workspace must not be
	// able to exhaust the file descriptors of the whole box.
	MaxSessionsPerWorkspace = 2000

	// HeartbeatInterval is what clients are told to ping at; two missed pings closes the
	// socket. Cloudflare cuts an idle proxied WebSocket at around 100 seconds, so the
	// interval must comfortably beat that whether or not anything is happening.
	HeartbeatInterval = 30 * time.Second
	HeartbeatTimeout  = 2 * HeartbeatInterval

	// changeFetchPageSize bounds one read of change_log while catching a room up.
	changeFetchPageSize = 1000
)

// Hub owns every live session and fans committed changes out to them.
//
// One goroutine per room does the database read, not one per session: twenty people
// looking at the same workspace produce one query per commit, not twenty. Sessions then
// filter that shared slice through their own visibility set, which is pure CPU.
type Hub struct {
	svc *domain.Service
	log *slog.Logger

	mu    sync.RWMutex
	rooms map[uuid.UUID]*room
}

func NewHub(svc *domain.Service, log *slog.Logger) *Hub {
	return &Hub{
		svc:   svc,
		log:   log,
		rooms: make(map[uuid.UUID]*room),
	}
}

// Run subscribes to committed mutations and pumps them into rooms until ctx is cancelled.
//
// It reconnects on failure with backoff rather than exiting: losing the listener means
// clients silently stop receiving updates while the app keeps serving queries perfectly,
// which is the most confusing possible outage. Reconnecting also self-heals, because a
// room catches up from its own cursor on the next notice regardless of what it missed.
func (h *Hub) Run(ctx context.Context) {
	backoff := time.Second
	for ctx.Err() == nil {
		err := h.svc.ListenForChanges(ctx, h.onNotice)
		if ctx.Err() != nil {
			return
		}
		h.log.Error("sync listener stopped, reconnecting", "error", err, "retry_in", backoff)

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 30*time.Second)

		// A reconnected listener has missed everything that happened while it was down.
		// Nudging every room makes each one read from its own cursor, which recovers the
		// gap without anybody re-bootstrapping.
		h.nudgeAllRooms()
	}
}

func (h *Hub) onNotice(n domain.SyncNotice) {
	h.mu.RLock()
	r := h.rooms[n.WorkspaceID]
	h.mu.RUnlock()
	if r == nil {
		return
	}
	r.notify(n.Version)
}

func (h *Hub) nudgeAllRooms() {
	h.mu.RLock()
	rooms := make([]*room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.RUnlock()

	for _, r := range rooms {
		// Version 0 means "read from your cursor to whatever is current".
		r.notify(0)
	}
}

// Register adds a session to its workspace's room, creating the room if needed.
func (h *Hub) Register(s *Session) error {
	h.mu.Lock()
	r, ok := h.rooms[s.principal.WorkspaceID]
	if !ok {
		r = newRoom(h, s.principal.WorkspaceID)
		h.rooms[s.principal.WorkspaceID] = r
		go r.run()
	}
	h.mu.Unlock()

	return r.add(s)
}

// Unregister removes a session and tears the room down when the last one leaves, so an
// idle workspace costs nothing.
func (h *Hub) Unregister(s *Session) {
	h.mu.RLock()
	r := h.rooms[s.principal.WorkspaceID]
	h.mu.RUnlock()
	if r == nil {
		return
	}

	if empty := r.remove(s); empty {
		h.mu.Lock()
		// Re-check under the write lock: somebody may have joined in the gap.
		if cur, ok := h.rooms[s.principal.WorkspaceID]; ok && cur == r && cur.isEmpty() {
			delete(h.rooms, s.principal.WorkspaceID)
			cur.stop()
		}
		h.mu.Unlock()
	}
}

// SessionCount reports live sessions, for /metrics and for the load tests.
func (h *Hub) SessionCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	n := 0
	for _, r := range h.rooms {
		n += r.count()
	}
	return n
}

// room is all the sessions on one workspace, plus the single goroutine that reads
// change_log on their behalf.
type room struct {
	hub         *Hub
	workspaceID uuid.UUID

	mu       sync.RWMutex
	sessions map[*Session]struct{}

	// wake is depth-1 and non-blocking: notices coalesce, because a room that is behind
	// only needs to know that it is behind, not how many times it was told.
	wake chan struct{}
	done chan struct{}
	once sync.Once
}

func newRoom(h *Hub, workspaceID uuid.UUID) *room {
	return &room{
		hub:         h,
		workspaceID: workspaceID,
		sessions:    make(map[*Session]struct{}),
		wake:        make(chan struct{}, 1),
		done:        make(chan struct{}),
	}
}

func (r *room) notify(int64) {
	select {
	case r.wake <- struct{}{}:
	default: // already pending; nothing to add
	}
}

func (r *room) add(s *Session) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if len(r.sessions) >= MaxSessionsPerWorkspace {
		return platform.RateLimited("too many live connections for this workspace")
	}

	// Enforce the per-user cap by closing the oldest, not by refusing the newest: the
	// newest is the window the person is looking at right now.
	var mine []*Session
	for existing := range r.sessions {
		if existing.principal.UserID == s.principal.UserID {
			mine = append(mine, existing)
		}
	}
	for len(mine) >= MaxSessionsPerUser {
		oldest := mine[0]
		for _, c := range mine[1:] {
			if c.startedAt.Before(oldest.startedAt) {
				oldest = c
			}
		}
		oldest.closeWith(TypeError, "TOO_MANY_CONNECTIONS", "another tab took this connection slot")
		delete(r.sessions, oldest)
		for i, c := range mine {
			if c == oldest {
				mine = append(mine[:i], mine[i+1:]...)
				break
			}
		}
	}

	r.sessions[s] = struct{}{}
	return nil
}

func (r *room) remove(s *Session) (empty bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.sessions, s)
	return len(r.sessions) == 0
}

func (r *room) isEmpty() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.sessions) == 0
}

func (r *room) count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.sessions)
}

func (r *room) stop() { r.once.Do(func() { close(r.done) }) }

func (r *room) run() {
	ctx := context.Background()
	for {
		select {
		case <-r.done:
			return
		case <-r.wake:
			r.dispatch(ctx)
		}
	}
}

// dispatch reads everything past the slowest session's cursor and offers it to each one.
func (r *room) dispatch(ctx context.Context) {
	r.mu.RLock()
	sessions := make([]*Session, 0, len(r.sessions))
	for s := range r.sessions {
		sessions = append(sessions, s)
	}
	r.mu.RUnlock()
	if len(sessions) == 0 {
		return
	}

	current, err := r.hub.svc.WorkspaceVersion(ctx, r.workspaceID)
	if err != nil {
		r.hub.log.Error("read workspace version", "workspace", r.workspaceID, "error", err)
		return
	}

	// One read serves everybody, starting from whoever is furthest behind.
	lowest := current
	for _, s := range sessions {
		if c := s.Cursor(); c < lowest {
			lowest = c
		}
	}
	if lowest >= current {
		return
	}

	// A session so far behind that catching it up would cost more than a fresh snapshot
	// is told to re-bootstrap instead, and is excluded from the read window.
	behind := make([]*Session, 0, len(sessions))
	for _, s := range sessions {
		if current-s.Cursor() > MaxSessionBacklog {
			s.requestResync(ReasonGapTooLarge)
			continue
		}
		behind = append(behind, s)
	}
	if len(behind) == 0 {
		return
	}
	lowest = current
	for _, s := range behind {
		if c := s.Cursor(); c < lowest {
			lowest = c
		}
	}

	for lowest < current {
		changes, err := r.hub.svc.ReadChanges(ctx, r.workspaceID, lowest, current, changeFetchPageSize)
		if err != nil {
			r.hub.log.Error("read changes", "workspace", r.workspaceID, "error", err)
			return
		}
		if len(changes) == 0 {
			// The watermark moved but no rows are readable — retention pruned them out
			// from under us. Nobody can be caught up incrementally, so everybody resyncs.
			for _, s := range behind {
				if s.Cursor() < current {
					s.requestResync(ReasonGapTooLarge)
				}
			}
			return
		}

		for _, s := range behind {
			s.offer(changes)
		}

		lowest = changes[len(changes)-1].Version
	}
}
