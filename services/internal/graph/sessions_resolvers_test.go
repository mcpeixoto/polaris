package graph

import (
	"context"
	"net/netip"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/auth"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestAccountSessions_ListsTheCallerAndMarksTheCookie(t *testing.T) {
	h := newHarness(t)
	_, hash := mintGraphSession(t, h.f, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0")
	ctx := auth.WithRefreshTokenHash(h.ctx, hash)

	rows, err := h.Query().AccountSessions(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("got %d sessions, want the one just minted", len(rows))
	}
	if !rows[0].Current {
		t.Fatal("the cookie's session must be marked current")
	}
	if rows[0].Label != "Chrome on macOS" {
		t.Errorf("label %q, want Chrome on macOS", rows[0].Label)
	}
}

func TestRevokeAccountSession_AForeignIdIsNotFound(t *testing.T) {
	h := newHarness(t)
	bob := testutil.NewFixture(t, h.f.DB)
	stolen, _ := mintGraphSession(t, bob, "Mozilla/5.0 Chrome/120.0.0.0")

	_, err := h.Mutation().RevokeAccountSession(h.ctx, stolen.ID)
	if errorCode(t, err) != string(platform.CodeNotFound) {
		t.Fatalf("code = %s, want NOT_FOUND", errorCode(t, err))
	}
}

func TestRevokeOtherSessions_WithoutACookieIsUnauthenticated(t *testing.T) {
	h := newHarness(t)
	mintGraphSession(t, h.f, "Mozilla/5.0 Chrome/120.0.0.0")

	_, err := h.Mutation().RevokeOtherSessions(h.ctx)
	if errorCode(t, err) != string(platform.CodeUnauthorized) {
		t.Fatalf("code = %s, want UNAUTHENTICATED", errorCode(t, err))
	}
}

func TestRevokeOtherSessions_KeepsTheCookie(t *testing.T) {
	h := newHarness(t)
	keep, keepHash := mintGraphSession(t, h.f, "Mozilla/5.0 Chrome/120.0.0.0")
	mintGraphSession(t, h.f, "Mozilla/5.0 Firefox/121.0")
	ctx := auth.WithRefreshTokenHash(h.ctx, keepHash)

	payload, err := h.Mutation().RevokeOtherSessions(ctx)
	if err != nil {
		t.Fatalf("revoke others: %v", err)
	}
	if payload.ID != keep.ID {
		t.Fatalf("kept %s, want this device %s", payload.ID, keep.ID)
	}

	rows, err := h.Query().AccountSessions(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 1 || rows[0].ID != keep.ID {
		t.Fatalf("got %+v, want only the current device", rows)
	}
}

func mintGraphSession(t *testing.T, f *testutil.Fixture, ua string) (store.AccountSession, []byte) {
	t.Helper()
	_, hash, err := auth.NewOpaqueToken()
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	ip := netip.MustParseAddr("203.0.113.10")
	row, err := f.DB.Queries().CreateSession(context.Background(), store.CreateSessionParams{
		ID:        uuid.Must(uuid.NewV7()),
		AccountID: f.AccountID,
		TokenHash: hash,
		UserAgent: &ua,
		Ip:        &ip,
		ExpiresAt: time.Now().Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	return row, hash
}
