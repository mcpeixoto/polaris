package syncsrv

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

// TokenVerifier turns an access token into the account that presented it. Defined here
// as an interface so the hub does not depend on the signing scheme, and so tests can
// drive a session without minting real JWTs.
type TokenVerifier interface {
	VerifyAccessToken(token string) (accountID uuid.UUID, err error)
}

// Server upgrades HTTP requests to sync sessions.
type Server struct {
	hub      *Hub
	svc      *domain.Service
	verifier TokenVerifier
	log      *slog.Logger

	// AllowedOrigins is checked on the WebSocket handshake. Browsers do not apply CORS
	// to WebSocket upgrades, so without this check any page on the internet could open a
	// socket that carries the visitor's cookies — the classic cross-site WebSocket
	// hijacking hole.
	AllowedOrigins []string
}

func NewServer(hub *Hub, svc *domain.Service, verifier TokenVerifier, log *slog.Logger, origins []string) *Server {
	return &Server{hub: hub, svc: svc, verifier: verifier, log: log, AllowedOrigins: origins}
}

// helloTimeout bounds how long an unauthenticated socket may sit open. Without it, an
// attacker holds file descriptors open for free by connecting and never speaking.
const helloTimeout = 10 * time.Second

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: s.AllowedOrigins,
	})
	if err != nil {
		s.log.Debug("websocket upgrade refused", "error", err)
		return
	}
	conn.SetReadLimit(64 * 1024)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	session, err := s.handshake(ctx, conn)
	if err != nil {
		writeFatal(ctx, conn, err)
		_ = conn.Close(websocket.StatusPolicyViolation, "handshake failed")
		return
	}

	if err := s.hub.Register(session); err != nil {
		writeFatal(ctx, conn, err)
		_ = conn.Close(websocket.StatusTryAgainLater, "too many connections")
		return
	}
	defer s.hub.Unregister(session)

	go session.writePump(ctx)

	// A client that reconnects after a gap must be caught up before it is told it is
	// ready, or it will render a stale list and only correct itself on the next write to
	// the workspace — which on a quiet Sunday could be a day later.
	if err := s.catchUp(ctx, session); err != nil {
		s.log.Error("initial catch-up failed", "error", err)
	}

	session.readPump(ctx)
	<-session.closed
	_ = conn.Close(websocket.StatusNormalClosure, "")
}

// handshake reads the hello frame, authenticates it and resolves the caller's visibility.
func (s *Server) handshake(ctx context.Context, conn *websocket.Conn) (*Session, error) {
	readCtx, cancel := context.WithTimeout(ctx, helloTimeout)
	defer cancel()

	_, data, err := conn.Read(readCtx)
	if err != nil {
		return nil, platform.Unauthorized("no hello frame")
	}

	var hello Hello
	if err := json.Unmarshal(data, &hello); err != nil || hello.Type != TypeHello {
		return nil, platform.Unauthorized("expected a hello frame")
	}

	// A client whose local store predates the current shape must throw it away. Letting
	// it resume would apply new-shaped deltas onto old-shaped rows, which produces
	// corruption that looks like random rendering bugs days later.
	if hello.ClientSchema != ClientSchema {
		return nil, platform.Conflict("client schema " + itoa(hello.ClientSchema) +
			" does not match server schema " + itoa(ClientSchema))
	}

	accountID, err := s.verifier.VerifyAccessToken(hello.Token)
	if err != nil {
		return nil, platform.Unauthorized("invalid or expired token")
	}

	// Resolved once, here. Nothing below this point re-reads permissions.
	principal, err := s.svc.ResolvePrincipal(ctx, accountID, hello.Workspace)
	if err != nil {
		return nil, err
	}

	resume := hello.Resume
	if resume > 0 {
		oldest, err := s.svc.OldestRetainedVersion(ctx, hello.Workspace)
		if err != nil {
			return nil, err
		}
		// Below the retention floor the client's missing deltas have been pruned. It
		// cannot be caught up incrementally, and pretending otherwise would leave it
		// permanently, silently stale.
		if oldest > 0 && resume < oldest-1 {
			resume = 0
		}
	}

	session := newSession(conn, principal, hello.ClientID, resume, s.log.With(
		"workspace", hello.Workspace, "user", principal.UserID))

	current, err := s.svc.WorkspaceVersion(ctx, hello.Workspace)
	if err != nil {
		return nil, err
	}
	ready, err := json.Marshal(Ready{
		Type:       TypeReady,
		Version:    current,
		ServerTime: time.Now().UTC(),
		Heartbeat:  int(HeartbeatInterval.Seconds()),
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	if err := conn.Write(ctx, websocket.MessageText, ready); err != nil {
		return nil, platform.Internal(err)
	}

	// Told to resync only after ready, so the client has a version to show progress
	// against rather than a bare spinner.
	if hello.Resume > 0 && resume == 0 {
		session.requestResync(ReasonGapTooLarge)
	}

	// A cursor ahead of the server is not a gap, it is a rewind: the workspace's version
	// counter has gone backwards underneath a client that had already seen further. A
	// restore from backup does it, and so does a failover to a replica that was behind.
	//
	// Checked because the floor check above cannot see it. Without this the client is not
	// refused and not caught up — it is silently ignored: catchUp's loop condition is
	// `cursor < current`, which is already false, so it returns having done nothing and
	// says nothing. The socket stays open, the client reports itself online, and it shows
	// the state it had before the restore until the server's counter climbs back past it,
	// which after a real restore can be days. Every other failure in this protocol is loud;
	// this one was mute.
	//
	// Resync rather than an error: the client's replica is genuinely wrong now and a
	// bootstrap is the only thing that fixes it. The operator's other half of this is in
	// the restore runbook — bump the version counter past any cursor a client could be
	// holding — which turns this from a per-client repair into one that happens once.
	if hello.Resume > current {
		session.requestResync(ReasonServerRewound)
	}

	return session, nil
}

// catchUp delivers everything committed while the client was away.
func (s *Server) catchUp(ctx context.Context, session *Session) error {
	current, err := s.svc.WorkspaceVersion(ctx, session.Principal().WorkspaceID)
	if err != nil {
		return err
	}

	for session.Cursor() < current {
		cursor := session.Cursor()
		if current-cursor > MaxSessionBacklog {
			session.requestResync(ReasonGapTooLarge)
			return nil
		}
		changes, err := s.svc.ReadChanges(ctx, session.Principal().WorkspaceID, cursor, current, changeFetchPageSize)
		if err != nil {
			return err
		}
		if len(changes) == 0 {
			// The watermark is ahead of anything readable: those rows were pruned.
			session.requestResync(ReasonGapTooLarge)
			return nil
		}
		session.offer(changes)

		// offer advances the cursor; if it did not, we would spin.
		if session.Cursor() <= cursor {
			return nil
		}
	}
	return nil
}

func writeFatal(ctx context.Context, conn *websocket.Conn, err error) {
	code := platform.CodeOf(err)
	msg := "connection refused"
	var pe *platform.Error
	if errors.As(err, &pe) {
		msg = pe.Message
	}
	frame, mErr := json.Marshal(Error{Type: TypeError, Code: string(code), Message: msg})
	if mErr != nil {
		return
	}
	writeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	_ = conn.Write(writeCtx, websocket.MessageText, frame)
}

// small local helpers, kept here so the package has no dependency on fmt/strconv for two
// call sites on a hot path.

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
