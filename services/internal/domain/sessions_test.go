package domain_test

import (
	"context"
	"net/netip"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/auth"
	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestListAccountSessions_MarksTheCookieAndHidesTheToken(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	laptop, laptopHash := mintSession(t, db, f.AccountID, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0")
	phone, _ := mintSession(t, db, f.AccountID, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")

	listed, err := svc.ListAccountSessions(ctx, f.Principal(), laptopHash)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 2 {
		t.Fatalf("got %d sessions, want the two just minted", len(listed))
	}

	byID := map[uuid.UUID]domain.AccountSession{}
	for _, row := range listed {
		byID[row.ID] = row
	}
	this := byID[laptop.ID]
	if !this.Current {
		t.Fatal("the cookie's session must be marked current — otherwise revoke-others has nothing to keep")
	}
	if this.Label != "Chrome on macOS" {
		t.Errorf("laptop label %q, want Chrome on macOS", this.Label)
	}
	other := byID[phone.ID]
	if other.Current {
		t.Fatal("the phone is not this request and must not be marked current")
	}
	if other.Label != "Safari on iOS" {
		t.Errorf("phone label %q, want Safari on iOS", other.Label)
	}
}

func TestListAccountSessions_DoesNotShowSomebodyElses(t *testing.T) {
	db := testutil.NewDB(t)
	alice := testutil.NewFixture(t, db)
	bob := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	mintSession(t, db, alice.AccountID, "Mozilla/5.0 Chrome/120.0.0.0")
	mintSession(t, db, bob.AccountID, "Mozilla/5.0 Firefox/121.0")

	listed, err := svc.ListAccountSessions(ctx, alice.Principal(), nil)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("alice saw %d sessions, want only her own", len(listed))
	}
}

func TestRevokeAccountSession_StopsThatLoginAndLeavesTheOthers(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	keep, keepHash := mintSession(t, db, f.AccountID, "Mozilla/5.0 Chrome/120.0.0.0")
	drop, dropHash := mintSession(t, db, f.AccountID, "Mozilla/5.0 Firefox/121.0")

	if _, _, err := svc.RevokeAccountSession(ctx, f.Principal(), drop.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	if _, err := db.Queries().GetSessionByTokenHash(ctx, dropHash); err == nil {
		t.Fatal("the revoked session still authenticates")
	}
	if _, err := db.Queries().GetSessionByTokenHash(ctx, keepHash); err != nil {
		t.Fatalf("the other session should still authenticate: %v", err)
	}
	listed, err := svc.ListAccountSessions(ctx, f.Principal(), keepHash)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != keep.ID {
		t.Fatalf("listing after revoke = %+v, want only the kept session", listed)
	}
}

func TestRevokeAccountSession_AForeignIdIsNotFoundNotForbidden(t *testing.T) {
	db := testutil.NewDB(t)
	alice := testutil.NewFixture(t, db)
	bob := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	stolen, _ := mintSession(t, db, bob.AccountID, "Mozilla/5.0 Chrome/120.0.0.0")

	_, _, err := svc.RevokeAccountSession(ctx, alice.Principal(), stolen.ID)
	if err == nil {
		t.Fatal("revoking a colleague's session must fail")
	}
	if platform.CodeOf(err) != platform.CodeNotFound {
		t.Fatalf("error classified %q, want NOT_FOUND so the id does not confirm the row exists", platform.CodeOf(err))
	}
	listed, err := svc.ListAccountSessions(ctx, bob.Principal(), nil)
	if err != nil {
		t.Fatalf("bob list: %v", err)
	}
	if len(listed) != 1 {
		t.Fatal("bob's session was revoked by alice")
	}
}

func TestRevokeOtherSessions_KeepsTheCookieAndKillsTheRest(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	keep, keepHash := mintSession(t, db, f.AccountID, "Mozilla/5.0 Chrome/120.0.0.0")
	_, dropHash := mintSession(t, db, f.AccountID, "Mozilla/5.0 Firefox/121.0")
	mintSession(t, db, f.AccountID, "Mozilla/5.0 Safari/17.0")

	if kept, _, err := svc.RevokeOtherSessions(ctx, f.Principal(), keepHash); err != nil {
		t.Fatalf("revoke others: %v", err)
	} else if kept != keep.ID {
		t.Fatalf("kept %s, want this device %s", kept, keep.ID)
	}

	if _, err := db.Queries().GetSessionByTokenHash(ctx, keepHash); err != nil {
		t.Fatalf("this device must still authenticate: %v", err)
	}
	if _, err := db.Queries().GetSessionByTokenHash(ctx, dropHash); err == nil {
		t.Fatal("a session that was not this device still authenticates")
	}
	listed, err := svc.ListAccountSessions(ctx, f.Principal(), keepHash)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != keep.ID || !listed[0].Current {
		t.Fatalf("after revoke-others got %+v, want only the current device", listed)
	}
}

func TestRevokeOtherSessions_RefusesARequestThatIsNotASession(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	mintSession(t, db, f.AccountID, "Mozilla/5.0 Chrome/120.0.0.0")

	_, _, err := svc.RevokeOtherSessions(context.Background(), f.Principal(), nil)
	if err == nil {
		t.Fatal("an API key must not be able to pick a survivor by omitting the cookie")
	}
	if platform.CodeOf(err) != platform.CodeUnauthorized {
		t.Fatalf("error classified %q, want UNAUTHENTICATED", platform.CodeOf(err))
	}
}

func TestListAccountSessions_AnAccountlessPrincipalIsRefused(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	p := f.PrincipalFor(f.UserID, authz.RoleMember, f.TeamID)
	_, err := svc.ListAccountSessions(context.Background(), p, nil)
	if err == nil {
		t.Fatal("an OAuth app user with no account must not list sessions")
	}
}

func mintSession(t *testing.T, db *store.DB, accountID uuid.UUID, ua string) (store.AccountSession, []byte) {
	t.Helper()
	_, hash, err := auth.NewOpaqueToken()
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	ip := netip.MustParseAddr("203.0.113.10")
	row, err := db.Queries().CreateSession(context.Background(), store.CreateSessionParams{
		ID:        uuid.Must(uuid.NewV7()),
		AccountID: accountID,
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

// A refresh must not change which session a device is.
//
// It used to: the old row was revoked and a new one inserted, so an id the Sessions screen
// had just drawn a Revoke button for stopped existing the moment that device refreshed. The
// consequence was the one failure that screen cannot have — pressing Revoke on a live device
// answered "session not found" and left it signed in.
func TestRefreshSession_KeepsTheSessionIdentityStable(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0"
	first := mintSessionWithToken(t, db, f.AccountID, ua)

	listedBefore, err := svc.ListAccountSessions(ctx, f.Principal(), auth.HashToken(first.RefreshToken))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var before domain.AccountSession
	for _, row := range listedBefore {
		if row.ID == first.SessionID {
			before = row
		}
	}
	if before.ID == uuid.Nil {
		t.Fatal("the session just minted is not in the listing")
	}

	_, rotated, err := svc.RefreshSession(ctx, first.RefreshToken)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if rotated.SessionID != first.SessionID {
		t.Fatalf("refresh moved the session from %s to %s — the Revoke button on the sessions "+
			"screen names the old id and would answer not-found", first.SessionID, rotated.SessionID)
	}
	if rotated.RefreshToken == first.RefreshToken {
		t.Fatal("the refresh token must change on every use — one that survives its own use is a replay")
	}

	// The old token is dead, exactly as it was when rotation revoked the row.
	if _, _, err := svc.RefreshSession(ctx, first.RefreshToken); err == nil {
		t.Fatal("the previous refresh token still works after rotation")
	}

	// And the id the screen is holding still revokes.
	if _, _, err := svc.RevokeAccountSession(ctx, f.Principal(), before.ID); err != nil {
		t.Fatalf("revoking the id the listing showed: %v", err)
	}
	if _, _, err := svc.RefreshSession(ctx, rotated.RefreshToken); err == nil {
		t.Fatal("the revoked device can still refresh — revoking it did nothing")
	}
}

// created_at is the moment somebody signed in, not the moment their browser last refreshed.
func TestRefreshSession_PreservesTheSignInFacts(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
	first := mintSessionWithToken(t, db, f.AccountID, ua)
	before, err := svc.ListAccountSessions(ctx, f.Principal(), auth.HashToken(first.RefreshToken))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	_, rotated, err := svc.RefreshSession(ctx, first.RefreshToken)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	after, err := svc.ListAccountSessions(ctx, f.Principal(), auth.HashToken(rotated.RefreshToken))
	if err != nil {
		t.Fatalf("list after: %v", err)
	}
	if len(after) != len(before) {
		t.Fatalf("refreshing turned %d sessions into %d — a live device must stay one row",
			len(before), len(after))
	}
	if !after[0].CreatedAt.Equal(before[0].CreatedAt) {
		t.Errorf("created_at moved from %s to %s — the Signed in column would show the last "+
			"refresh rather than the sign-in", before[0].CreatedAt, after[0].CreatedAt)
	}
	if after[0].Label != before[0].Label {
		t.Errorf("device label changed across a refresh: %q then %q", before[0].Label, after[0].Label)
	}
	if !after[0].Current {
		t.Error("the rotated cookie must still mark its own row current")
	}
}

// Revoking a session must stop it refreshing, and must not be undone by a race with one.
func TestRefreshSession_RefusesARevokedSession(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	first := mintSessionWithToken(t, db, f.AccountID, "probe")
	if _, _, err := svc.RevokeAccountSession(ctx, f.Principal(), first.SessionID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	_, _, err := svc.RefreshSession(ctx, first.RefreshToken)
	if err == nil {
		t.Fatal("a revoked session refreshed itself back to life")
	}
	if platform.CodeOf(err) != platform.CodeUnauthorized {
		t.Errorf("code %v, want unauthorized", platform.CodeOf(err))
	}
}

// mintSessionWithToken is mintSession plus the plaintext, which the refresh path needs and
// the listing path never does.
func mintSessionWithToken(t *testing.T, db *store.DB, accountID uuid.UUID, ua string) domain.Session {
	t.Helper()
	plain, hash, err := auth.NewOpaqueToken()
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	ip := netip.MustParseAddr("203.0.113.10")
	row, err := db.Queries().CreateSession(context.Background(), store.CreateSessionParams{
		ID:        uuid.Must(uuid.NewV7()),
		AccountID: accountID,
		TokenHash: hash,
		UserAgent: &ua,
		Ip:        &ip,
		ExpiresAt: time.Now().Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	return domain.Session{
		SessionID:    row.ID,
		AccountID:    row.AccountID,
		RefreshToken: plain,
		ExpiresAt:    row.ExpiresAt,
	}
}
