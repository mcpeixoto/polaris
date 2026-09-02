package syncsrv

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
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

	// MaxDeltaBytes bounds one frame in bytes as MaxDeltaBatch bounds it in rows. 500
	// rows is small for issues and multi-megabyte for documents carrying their full text,
	// and what stalls a client's main thread on parse is the byte count.
	MaxDeltaBytes = 1 << 20 // 1 MB

	// changeOverheadBytes is a rough per-change cost for everything around the payload —
	// the version, ids, op and actor. Approximate on purpose: the budget only has to stop
	// a frame being an order of magnitude too big, not be exact.
	changeOverheadBytes = 256

	// MaxOutboundFrames is the write queue depth per session. Small on purpose: when a
	// socket stops draining, the useful signal is "this connection is broken", and
	// discovering it after four frames is better than after four hundred.
	MaxOutboundFrames = 32

	// MaxOutboundBytes is the same limit measured in heap rather than in frames, because
	// frames are not a fixed size and 32 large ones per session is what actually runs the
	// box out of memory.
	MaxOutboundBytes = 4 << 20 // 4 MB

	// maxControlFrames is the depth of the priority queue that carries pongs. Tiny: a
	// control frame that cannot be delivered promptly has no value, and dropping one is
	// cheaper than queueing it behind anything.
	maxControlFrames = 8

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

	// dispatchTimeout bounds one wake of a room. Without it a single stuck connection
	// freezes a workspace's deltas indefinitely, with every socket still open and every
	// client still reporting itself online — the one failure mode neither side can see.
	dispatchTimeout = 10 * time.Second
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

	// sessionCap is MaxSessionsPerWorkspace, held as a field so a test can reach the cap
	// without opening two thousand sockets to observe what happens at it.
	sessionCap int
}

func NewHub(svc *domain.Service, log *slog.Logger) *Hub {
	return &Hub{
		svc:   svc,
		log:   log,
		rooms: make(map[uuid.UUID]*room),

		sessionCap: MaxSessionsPerWorkspace,
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
	r, ok := h.rooms[s.Principal().WorkspaceID]
	if !ok {
		r = newRoom(h, s.Principal().WorkspaceID)
		h.rooms[s.Principal().WorkspaceID] = r
		go r.run()
	}
	h.mu.Unlock()

	if err := r.add(s); err != nil {
		// The room was created above and its goroutine started before add could refuse.
		// Without this the failure path — which is precisely a connection flood — leaves
		// an empty room and a live goroutine behind on every attempt, forever.
		h.discardIfEmpty(r)
		return err
	}
	return nil
}

// discardIfEmpty tears down a room that no longer has any sessions.
func (h *Hub) discardIfEmpty(r *room) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if cur, ok := h.rooms[r.workspaceID]; ok && cur == r && cur.isEmpty() {
		delete(h.rooms, r.workspaceID)
		cur.stop()
	}
}

// Unregister removes a session and tears the room down when the last one leaves, so an
// idle workspace costs nothing.
func (h *Hub) Unregister(s *Session) {
	h.mu.RLock()
	r := h.rooms[s.Principal().WorkspaceID]
	h.mu.RUnlock()
	if r == nil {
		return
	}

	if empty := r.remove(s); empty {
		// Re-checked under the write lock inside: somebody may have joined in the gap.
		h.discardIfEmpty(r)
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
	// refresh is the same shape for principal re-resolution, which happens on its own
	// goroutine so a workspace's deltas are not blocked behind N account lookups.
	refresh chan struct{}
	done    chan struct{}
	once    sync.Once
}

func newRoom(h *Hub, workspaceID uuid.UUID) *room {
	return &room{
		hub:         h,
		workspaceID: workspaceID,
		sessions:    make(map[*Session]struct{}),
		wake:        make(chan struct{}, 1),
		refresh:     make(chan struct{}, 1),
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

	if len(r.sessions) >= r.hub.sessionCap {
		return platform.RateLimited("too many live connections for this workspace")
	}

	// Enforce the per-user cap by closing the oldest, not by refusing the newest: the
	// newest is the window the person is looking at right now.
	var mine []*Session
	for existing := range r.sessions {
		if existing.Principal().UserID == s.Principal().UserID {
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

// run is the room's single reader goroutine.
//
// It runs outside net/http's per-request handler, where nothing recovers on its behalf: a
// panic in here would take the process down and with it every socket for every workspace
// on the box. Recovering and stopping the room costs the workspace its live updates until
// its sessions reconnect, which is a small fraction of that.
func (r *room) run() {
	defer func() {
		if req := recover(); req != nil {
			r.hub.log.Error("panic in sync room", "workspace", r.workspaceID, "panic", req)
			r.stop()
		}
	}()

	// Tied to r.done so a dispatch in flight is cancelled when the room is torn down
	// rather than holding a database connection for a workspace nobody is watching.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		<-r.done
		cancel()
	}()

	go r.refreshLoop(ctx)

	for {
		select {
		case <-r.done:
			return
		case <-r.wake:
			// Bounded, because a single stuck query would otherwise freeze this
			// workspace's deltas indefinitely with every socket still open and every
			// client still reporting itself online.
			dctx, dcancel := context.WithTimeout(ctx, dispatchTimeout)
			r.dispatch(dctx)
			dcancel()
		}
	}
}

// refreshLoop re-resolves principals off the dispatch goroutine.
//
// It is its own goroutine because the work is one database round trip per distinct
// account: a workspace at the session cap where an admin toggles one team membership
// would otherwise block every delta on that workspace behind hundreds of serial queries.
func (r *room) refreshLoop(ctx context.Context) {
	defer func() {
		if req := recover(); req != nil {
			r.hub.log.Error("panic in sync room refresh", "workspace", r.workspaceID, "panic", req)
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case <-r.done:
			return
		case <-r.refresh:
			rctx, cancel := context.WithTimeout(ctx, dispatchTimeout)
			r.refreshPrincipals(rctx, r.snapshot())
			cancel()
		}
	}
}

// snapshot is the live session list, copied so callers can iterate without the lock.
func (r *room) snapshot() []*Session {
	r.mu.RLock()
	defer r.mu.RUnlock()
	sessions := make([]*Session, 0, len(r.sessions))
	for s := range r.sessions {
		sessions = append(sessions, s)
	}
	return sessions
}

// dispatch reads everything past the slowest session's cursor and offers it to each one.
func (r *room) dispatch(ctx context.Context) {
	sessions := r.snapshot()
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
			// Twice running means the resync did not take: this session is excluded from
			// every read window from here on, so no delta will ever reach it again while
			// the socket stays open and the client keeps calling itself ready. A close is
			// the honest answer — the client reconnects and bootstraps.
			if s.markExcluded() {
				s.closeWith(TypeError, "RESYNC_REQUIRED", "reconnect to bootstrap; this session is too far behind")
				continue
			}
			s.requestResync(ReasonGapTooLarge)
			continue
		}
		s.clearExcluded()
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

	// Whether anything in this dispatch could have changed who may see what. Teams and
	// team memberships are the only two things a principal's team set is built from.
	accessChanged := false

	for lowest < current {
		changes, scannedThrough, err := r.hub.svc.ReadChangesScanned(ctx, r.workspaceID, lowest, current, changeFetchPageSize)
		if err != nil {
			r.hub.log.Error("read changes", "workspace", r.workspaceID, "error", err)
			return
		}
		if len(changes) == 0 {
			if scannedThrough > lowest {
				// Rows exist, they just could not be read — an unparseable scope, which
				// ReadChangesScanned has already logged. Stepping the cursor over them is the
				// only correct move: reading this as a retention gap would resync every
				// session in the workspace on every subsequent commit, forever, because
				// the offending row is inside the retention window and never gets pruned.
				for _, s := range behind {
					s.advanceCursor(scannedThrough)
				}
				lowest = scannedThrough
				continue
			}
			// Nothing at all between the cursor and the watermark: retention pruned
			// those rows out from under us. Nobody can be caught up incrementally.
			for _, s := range behind {
				if s.Cursor() < current {
					s.requestResync(ReasonGapTooLarge)
				}
			}
			return
		}

		for _, c := range changes {
			if c.EntityType == "team" || c.EntityType == "teamMembership" {
				accessChanged = true
				break
			}
		}

		for _, s := range behind {
			s.offer(changes)
		}

		lowest = changes[len(changes)-1].Version
	}

	if accessChanged {
		// Handed to the refresh goroutine rather than run here: it is one query per
		// distinct account, and doing that inline blocks every delta on this workspace.
		select {
		case r.refresh <- struct{}{}:
		default: // one is already queued, and it will see the same result
		}
	}
}

// refreshPrincipals re-resolves each session's team set after something touched the
// workspace's teams, and tells anybody whose set grew to bootstrap.
//
// After the batch, not before. The rows that tell a client to forget a team it has just
// lost are in that batch, and a principal refreshed first would filter them out — leaving
// the reader with a permanently stale, readable copy of a team they can no longer reach.
//
// Only a set that GREW needs a resync. Access that was taken away is already carried by the
// revokes in the batch, and the new principal stops anything further from being sent; a
// bootstrap on top of that would be a full re-download for no change in what the client
// holds. Access that was GAINED cannot be delivered incrementally — the rows that would
// have granted it were emitted while the reader still could not see them — so the only
// honest answer is a fresh snapshot.
func (r *room) refreshPrincipals(ctx context.Context, sessions []*Session) {
	// One lookup per distinct account, not per session. Tabs and devices share an
	// account, and a workspace at the session cap would otherwise do thousands of
	// sequential round trips for a handful of distinct answers.
	type resolved struct {
		p   *authz.Principal
		err error
	}
	byAccount := make(map[uuid.UUID]resolved, len(sessions))

	for _, s := range sessions {
		old := s.Principal()
		got, ok := byAccount[old.AccountID]
		if !ok {
			got.p, got.err = r.hub.svc.ResolvePrincipal(ctx, old.AccountID, old.WorkspaceID)
			byAccount[old.AccountID] = got
		}
		fresh, err := got.p, got.err
		if err != nil {
			// Suspended, or removed from the workspace outright. Either way this socket
			// must stop being served; the client's reconnect will get the real refusal.
			r.hub.log.Info("principal no longer resolvable, closing session",
				"workspace", old.WorkspaceID, "user", old.UserID, "error", err)
			s.closeWith(TypeError, "PERMISSIONS_CHANGED", "your access to this workspace changed")
			continue
		}
		// A copy per session, because one resolved value now serves every tab on the
		// account and the fields below are the socket's, not the account's.
		perSession := *fresh
		fresh = &perSession

		// Carried over rather than re-read: neither is derived from the team graph, and
		// ResolvePrincipal does not know about the token this socket was opened with.
		fresh.Scopes = old.Scopes
		fresh.ActorType = old.ActorType
		fresh.ApplicationID = old.ApplicationID
		fresh.SharedEntities = old.SharedEntities

		added, removed := teamSetDiff(old.Teams, fresh.Teams)
		if !added && !removed {
			continue
		}
		s.adoptPrincipal(fresh)
		if added {
			s.requestPermissionsResync()
		}
	}
}

// teamSetDiff reports whether after has teams before did not, and vice versa.
func teamSetDiff(before, after authz.TeamSet) (added, removed bool) {
	for id := range after {
		if !before.Has(id) {
			added = true
			break
		}
	}
	for id := range before {
		if !after.Has(id) {
			removed = true
			break
		}
	}
	return added, removed
}
