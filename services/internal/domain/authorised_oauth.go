package domain

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// AuthorisedOauthApp is one third-party application this person has granted tokens to
// in this workspace, as a listing may hold it.
//
// Several live tokens for the same app collapse into one row. The tokens themselves are
// not here: only their hashes are stored, and even those stay in the database.
type AuthorisedOauthApp struct {
	ID         uuid.UUID
	Name       string
	ClientID   string
	ImageURL   *string
	Developer  *string
	Scopes     []string
	LastUsedAt *time.Time
	CreatedAt  time.Time
}

// ListAuthorisedOauthApps returns the caller's own live authorisations in this
// workspace, and only ever those.
//
// Client-credentials tokens are not here: those authenticate as the application, not as
// a person who pressed Allow. Guests can list their own, the same way they can list
// sessions — a stolen integration still has to be killable by the person who granted it.
func (s *Service) ListAuthorisedOauthApps(ctx context.Context, p *authz.Principal) ([]AuthorisedOauthApp, error) {
	if p == nil || p.UserID == uuid.Nil {
		return nil, platform.Unauthorized("")
	}

	rows, err := s.db.Queries().ListLiveOauthTokensForUser(ctx, store.ListLiveOauthTokensForUserParams{
		WorkspaceID: p.WorkspaceID,
		UserID:      &p.UserID,
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	return groupAuthorisedOauthApps(rows), nil
}

// RevokeAuthorisedOauthApp retires every live token this person granted to one
// application in this workspace.
//
// A foreign id answers not-found rather than forbidden, so probing with a colleague's
// authorisation does not confirm it exists. Already-revoked is the same answer: as far
// as this person is concerned the grant is gone.
func (s *Service) RevokeAuthorisedOauthApp(ctx context.Context, p *authz.Principal, applicationID uuid.UUID) (uuid.UUID, int64, error) {
	if p == nil || p.UserID == uuid.Nil {
		return uuid.Nil, 0, platform.Unauthorized("")
	}

	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		n, err := q.RevokeOauthTokensForUserApplication(ctx, store.RevokeOauthTokensForUserApplicationParams{
			WorkspaceID:   p.WorkspaceID,
			ApplicationID: applicationID,
			UserID:        &p.UserID,
		})
		if err != nil {
			return platform.Internal(err)
		}
		if n == 0 {
			return platform.NotFound("authorisation")
		}
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	if err != nil {
		return uuid.Nil, 0, err
	}
	return applicationID, version, nil
}

func groupAuthorisedOauthApps(rows []store.ListLiveOauthTokensForUserRow) []AuthorisedOauthApp {
	type bucket struct {
		app    AuthorisedOauthApp
		scopes map[string]struct{}
	}
	order := make([]uuid.UUID, 0)
	byID := map[uuid.UUID]*bucket{}
	for _, row := range rows {
		held, ok := byID[row.ApplicationID]
		if !ok {
			held = &bucket{
				app: AuthorisedOauthApp{
					ID:        row.ApplicationID,
					Name:      row.Name,
					ClientID:  row.ClientID,
					ImageURL:  row.ImageUrl,
					Developer: row.Developer,
					CreatedAt: row.CreatedAt,
				},
				scopes: map[string]struct{}{},
			}
			byID[row.ApplicationID] = held
			order = append(order, row.ApplicationID)
		}
		if row.CreatedAt.Before(held.app.CreatedAt) {
			held.app.CreatedAt = row.CreatedAt
		}
		if row.LastUsedAt != nil && (held.app.LastUsedAt == nil || row.LastUsedAt.After(*held.app.LastUsedAt)) {
			held.app.LastUsedAt = row.LastUsedAt
		}
		for _, scope := range row.Scopes {
			held.scopes[scope] = struct{}{}
		}
	}

	out := make([]AuthorisedOauthApp, 0, len(order))
	for _, id := range order {
		held := byID[id]
		scopes := make([]string, 0, len(held.scopes))
		for scope := range held.scopes {
			scopes = append(scopes, scope)
		}
		sort.Strings(scopes)
		held.app.Scopes = scopes
		out = append(out, held.app)
	}
	return out
}
