package domain

import (
	"context"
	"net/netip"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/auth"
	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// AccountSession is one live login, as a listing may hold it.
//
// The refresh token is not here. Only its hash is stored, and even that stays in the
// database: a settings screen that could show a token would be a settings screen that
// could steal one.
type AccountSession struct {
	ID         uuid.UUID
	Label      string
	UserAgent  *string
	IP         *string
	Country    *string
	Current    bool
	LastSeenAt time.Time
	CreatedAt  time.Time
	ExpiresAt  time.Time
}

// ListAccountSessions returns the caller's own live sessions, and only ever those.
//
// currentTokenHash is the SHA-256 of this request's refresh cookie, or nil when the
// caller authenticated some other way. It is what marks Current: comparing ids would
// require the access token to name a session, and it does not — access tokens are
// short-lived JWTs that survive a refresh rotation, while the cookie is the session.
func (s *Service) ListAccountSessions(ctx context.Context, p *authz.Principal, currentTokenHash []byte) ([]AccountSession, error) {
	if p == nil || p.AccountID == uuid.Nil {
		return nil, platform.Unauthorized("")
	}

	rows, err := s.db.Queries().ListSessionsForAccount(ctx, p.AccountID)
	if err != nil {
		return nil, platform.Internal(err)
	}

	var currentID uuid.UUID
	if len(currentTokenHash) > 0 {
		for _, row := range rows {
			if auth.ConstantTimeEqualHash(row.TokenHash, currentTokenHash) {
				currentID = row.ID
				break
			}
		}
	}

	out := make([]AccountSession, 0, len(rows))
	for _, row := range rows {
		out = append(out, toListedSession(row, row.ID == currentID))
	}
	return out, nil
}

// RevokeAccountSession retires one of the caller's own sessions.
//
// No role check: a guest who signed in from a stolen laptop still has to be able to
// kill that login. A foreign id answers not-found rather than forbidden, so probing
// with a colleague's session id does not confirm it exists.
func (s *Service) RevokeAccountSession(ctx context.Context, p *authz.Principal, id uuid.UUID) (uuid.UUID, int64, error) {
	if p == nil || p.AccountID == uuid.Nil {
		return uuid.Nil, 0, platform.Unauthorized("")
	}

	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		n, err := q.RevokeSessionForAccount(ctx, store.RevokeSessionForAccountParams{
			ID:        id,
			AccountID: p.AccountID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		if n == 0 {
			return platform.NotFound("session")
		}
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	if err != nil {
		return uuid.Nil, 0, err
	}
	return id, version, nil
}

// RevokeOtherSessions retires every live session except the one making this request.
//
// The keep-this-one id comes from the refresh cookie, not from an argument: an argument
// would let a caller name any of their sessions as the survivor, which is a way to keep
// a stolen laptop signed in while killing the browser they still have. No cookie means
// this is not a session (an API key, an OAuth app) and there is no "this device" to keep.
func (s *Service) RevokeOtherSessions(ctx context.Context, p *authz.Principal, currentTokenHash []byte) (uuid.UUID, int64, error) {
	if p == nil || p.AccountID == uuid.Nil {
		return uuid.Nil, 0, platform.Unauthorized("")
	}
	if len(currentTokenHash) == 0 {
		return uuid.Nil, 0, platform.Unauthorized("this request is not a session")
	}

	var (
		kept    uuid.UUID
		version int64
	)
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		current, err := q.GetSessionByTokenHash(ctx, currentTokenHash)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.Unauthorized("this request is not a session")
			}
			return platform.Internal(err)
		}
		if current.AccountID != p.AccountID {
			// The cookie and the bearer named different people. Fail closed rather than
			// revoke under the bearer's account while keeping a session that is not theirs.
			return platform.Unauthorized("this request is not a session")
		}
		kept = current.ID

		if _, err := q.RevokeOtherSessionsForAccount(ctx, store.RevokeOtherSessionsForAccountParams{
			AccountID: p.AccountID,
			ID:        current.ID,
		}); err != nil {
			return platform.Internal(err)
		}
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	if err != nil {
		return uuid.Nil, 0, err
	}
	return kept, version, nil
}

func toListedSession(row store.AccountSession, current bool) AccountSession {
	ua := row.UserAgent
	label := sessionLabel("")
	if ua != nil {
		label = sessionLabel(*ua)
	}
	var ip *string
	if row.Ip != nil {
		s := formatSessionIP(*row.Ip)
		ip = &s
	}
	return AccountSession{
		ID:         row.ID,
		Label:      label,
		UserAgent:  ua,
		IP:         ip,
		Country:    row.Country,
		Current:    current,
		LastSeenAt: row.LastSeenAt,
		CreatedAt:  row.CreatedAt,
		ExpiresAt:  row.ExpiresAt,
	}
}

func formatSessionIP(addr netip.Addr) string {
	return addr.String()
}

// sessionLabel turns a user-agent into the sentence the settings table shows: "Chrome on
// macOS". Unknown tokens fall back rather than inventing a product name; a wrong label
// next to a revoke button is worse than a vague one.
func sessionLabel(userAgent string) string {
	ua := strings.TrimSpace(userAgent)
	if ua == "" {
		return "Unknown device"
	}
	browser := sessionBrowser(ua)
	os := sessionOS(ua)
	if os == "" {
		return browser
	}
	return browser + " on " + os
}

func sessionBrowser(ua string) string {
	switch {
	case strings.Contains(ua, "Edg/"):
		return "Edge"
	case strings.Contains(ua, "OPR/") || strings.Contains(ua, "Opera"):
		return "Opera"
	case strings.Contains(ua, "Firefox/"):
		return "Firefox"
	case strings.Contains(ua, "Electron/"):
		return "Polaris"
	case strings.Contains(ua, "Chrome/") && !strings.Contains(ua, "Chromium"):
		return "Chrome"
	case strings.Contains(ua, "Safari/") && !strings.Contains(ua, "Chrome/"):
		return "Safari"
	default:
		return "Browser"
	}
}

func sessionOS(ua string) string {
	switch {
	case strings.Contains(ua, "iPhone") || strings.Contains(ua, "iPad"):
		return "iOS"
	case strings.Contains(ua, "Android"):
		return "Android"
	case strings.Contains(ua, "Macintosh") || strings.Contains(ua, "Mac OS X"):
		return "macOS"
	case strings.Contains(ua, "Windows"):
		return "Windows"
	case strings.Contains(ua, "CrOS"):
		return "ChromeOS"
	case strings.Contains(ua, "Linux"):
		return "Linux"
	default:
		return ""
	}
}
