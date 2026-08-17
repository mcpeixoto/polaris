package domain_test

import (
	"context"
	"encoding/json"
	"strings"
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

// API keys are the one credential the product hands out deliberately, so the tests below
// are about what a key may not do rather than about it working: acting as more than its
// owner, outliving its owner's access, or leaving the plaintext token anywhere a second
// person could read it.

func TestApiKey_ACreatedKeyAuthenticatesAsItsOwner(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	key, token, _, err := svc.CreateApiKey(ctx, f.Principal(), domain.CreateApiKeyInput{
		Name: "CI deploy bot",
	})
	if err != nil {
		t.Fatalf("create key: %v", err)
	}

	p, err := svc.AuthenticateApiKey(ctx, token)
	if err != nil {
		t.Fatalf("authenticate: %v", err)
	}

	if p.UserID != f.UserID {
		t.Errorf("principal user = %s, want the key's owner %s", p.UserID, f.UserID)
	}
	if p.WorkspaceID != f.WorkspaceID {
		t.Errorf("principal workspace = %s, want %s", p.WorkspaceID, f.WorkspaceID)
	}
	// The role comes from the owner's row, not from anything the key carries.
	if !p.Role.IsAdmin() {
		t.Errorf("role = %s, want the owner's admin role", p.Role)
	}
	if !p.Teams.Has(f.TeamID) {
		t.Error("a key must reach the teams its owner reaches, or an integration sees an empty workspace")
	}
	// An unscoped key is exactly its owner: HasScope answers yes to everything.
	if !p.HasScope("write") {
		t.Error("an unscoped key must carry everything its owner can do")
	}

	// The prefix is what lets somebody recognise which key is which in the listing, so it
	// has to actually be this token's prefix.
	if key.Prefix == "" || !strings.HasPrefix(token, key.Prefix) {
		t.Errorf("prefix %q is not a prefix of the token", key.Prefix)
	}

	// last_used_at is written by the authentication path, because "is this key still in use
	// before I revoke it" is the question the column exists to answer.
	listed, err := svc.ListApiKeys(ctx, f.Principal())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 || listed[0].LastUsedAt == nil {
		t.Errorf("authenticating a key must record last_used_at; got %+v", listed)
	}
}

func TestApiKey_TheTokenExistsInTheCreateResponseAndNowhereElse(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	key, token, version, err := svc.CreateApiKey(ctx, f.Principal(), domain.CreateApiKeyInput{
		Name: "webhook relay",
	})
	if err != nil {
		t.Fatalf("create key: %v", err)
	}

	// The model is what becomes the API response and what would become a sync payload if
	// keys were ever replicated. A token field here would be one careless serialisation
	// away from permanent.
	blob, err := json.Marshal(key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	if strings.Contains(string(blob), token) {
		t.Fatalf("the plaintext token is in the serialised model: %s", blob)
	}

	listed, err := svc.ListApiKeys(ctx, f.Principal())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	listedBlob, err := json.Marshal(listed)
	if err != nil {
		t.Fatalf("marshal listing: %v", err)
	}
	if strings.Contains(string(listedBlob), token) {
		t.Fatalf("the plaintext token is in the listing: %s", listedBlob)
	}

	// And nothing reached the change stream at all — which is the strongest form of "not in
	// the payload": there is no payload. api_key is deliberately not a replicated entity.
	rows, err := db.Queries().ReadChangesSince(ctx, store.ReadChangesSinceParams{
		WorkspaceID: f.WorkspaceID, AfterVersion: 0, ThroughVersion: 1 << 40, PageSize: 100,
	})
	if err != nil {
		t.Fatalf("read changes: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("creating a key emitted %d change rows; keys are not replicated to clients", len(rows))
	}
	// The payload still carries a version, and it is the untouched watermark rather than a
	// freshly minted one — a version nothing can be delivered for would make every client
	// wait for a delta that never comes.
	if version != 0 {
		t.Errorf("version = %d, want the workspace's unchanged watermark 0", version)
	}
}

func TestApiKey_ARevokedKeyStopsAuthenticating(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	key, token, _, err := svc.CreateApiKey(ctx, f.Principal(), domain.CreateApiKeyInput{Name: "old laptop"})
	if err != nil {
		t.Fatalf("create key: %v", err)
	}
	if _, err := svc.AuthenticateApiKey(ctx, token); err != nil {
		t.Fatalf("the key must work before it is revoked: %v", err)
	}

	if _, _, err := svc.RevokeApiKey(ctx, f.Principal(), key.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	_, err = svc.AuthenticateApiKey(ctx, token)
	if err == nil {
		t.Fatal("a revoked key must not authenticate")
	}
	if code := platform.CodeOf(err); code != platform.CodeUnauthorized {
		t.Errorf("code = %s, want %s — a revoked key is indistinguishable from one that never existed",
			code, platform.CodeUnauthorized)
	}

	// And it leaves the listing, so the settings screen shows live credentials only.
	listed, err := svc.ListApiKeys(ctx, f.Principal())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 0 {
		t.Errorf("a revoked key is still listed: %+v", listed)
	}
}

func TestApiKey_AnExpiredKeyStopsAuthenticating(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// Written through the store rather than the service on purpose: CreateApiKey refuses an
	// expiry in the past, and the case worth testing is the key that was minted a year ago
	// and has since lapsed.
	token := "plk_" + uuid.Must(uuid.NewV7()).String()
	expired := time.Now().Add(-time.Hour)
	err := db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		_, err := q.CreateAPIKey(ctx, store.CreateAPIKeyParams{
			ID:          uuid.Must(uuid.NewV7()),
			WorkspaceID: f.WorkspaceID,
			UserID:      f.UserID,
			Name:        "last year's key",
			TokenHash:   auth.HashToken(token),
			Prefix:      token[:12],
			Scopes:      []string{},
			ExpiresAt:   &expired,
		})
		return err
	})
	if err != nil {
		t.Fatalf("seed expired key: %v", err)
	}

	if _, err := svc.AuthenticateApiKey(ctx, token); err == nil {
		t.Fatal("an expired key must not authenticate")
	} else if code := platform.CodeOf(err); code != platform.CodeUnauthorized {
		t.Errorf("code = %s, want %s", code, platform.CodeUnauthorized)
	}
}

func TestCreateApiKey_RefusesAnExpiryInThePast(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	past := time.Now().Add(-time.Minute)
	_, token, _, err := svc.CreateApiKey(ctx, f.Principal(), domain.CreateApiKeyInput{
		Name: "born dead", ExpiresAt: &past,
	})
	if code := platform.CodeOf(err); code != platform.CodeValidation {
		t.Fatalf("code = %s, want %s — a key that can never work looks fine in the listing",
			code, platform.CodeValidation)
	}
	if token != "" {
		t.Error("a failed creation must not hand back a token")
	}
}

func TestApiKey_AKeyBelongingToASuspendedUserFailsClosed(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	bob := f.NewUser(t, "bob", "member", true)
	pBob := f.PrincipalFor(bob, authz.RoleMember, f.TeamID)

	_, token, _, err := svc.CreateApiKey(ctx, pBob, domain.CreateApiKeyInput{Name: "bob's scripts"})
	if err != nil {
		t.Fatalf("create key: %v", err)
	}
	if _, err := svc.AuthenticateApiKey(ctx, token); err != nil {
		t.Fatalf("the key must work while its owner is active: %v", err)
	}

	if _, _, err := svc.SuspendUser(ctx, f.Principal(), bob, true); err != nil {
		t.Fatalf("suspend: %v", err)
	}

	// Suspending somebody who cannot then be locked out through their own key is a
	// suspension that does nothing anybody asked for.
	if _, err := svc.AuthenticateApiKey(ctx, token); err == nil {
		t.Fatal("a suspended user's key must not authenticate")
	} else if code := platform.CodeOf(err); code != platform.CodeUnauthorized {
		t.Errorf("code = %s, want %s", code, platform.CodeUnauthorized)
	}
}

func TestApiKey_ScopesNarrowAndNeverWiden(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// A private team the member is not in. It is the sharpest test of "never widens": no
	// scope may hand a key a team its owner cannot see.
	secret, _, err := svc.CreateTeam(ctx, f.Principal(), domain.CreateTeamInput{
		Key: "SEC", Name: "Security", Private: true,
	})
	if err != nil {
		t.Fatalf("create private team: %v", err)
	}

	bob := f.NewUser(t, "bob", "member", true)
	pBob := f.PrincipalFor(bob, authz.RoleMember, f.TeamID)

	_, readToken, _, err := svc.CreateApiKey(ctx, pBob, domain.CreateApiKeyInput{
		Name: "reporting", Scopes: []string{domain.APIKeyScopeRead},
	})
	if err != nil {
		t.Fatalf("create read key: %v", err)
	}
	readKey, err := svc.AuthenticateApiKey(ctx, readToken)
	if err != nil {
		t.Fatalf("authenticate read key: %v", err)
	}
	if !readKey.HasScope(domain.APIKeyScopeRead) {
		t.Error("a read-scoped key must carry read")
	}
	if readKey.HasScope(domain.APIKeyScopeWrite) {
		t.Error("a read-scoped key must not carry write — that is the whole point of a scope")
	}

	// write implies read, expanded at creation so the listing shows what the key can do.
	_, writeToken, _, err := svc.CreateApiKey(ctx, pBob, domain.CreateApiKeyInput{
		Name: "importer", Scopes: []string{domain.APIKeyScopeWrite},
	})
	if err != nil {
		t.Fatalf("create write key: %v", err)
	}
	writeKey, err := svc.AuthenticateApiKey(ctx, writeToken)
	if err != nil {
		t.Fatalf("authenticate write key: %v", err)
	}
	if !writeKey.HasScope(domain.APIKeyScopeRead) || !writeKey.HasScope(domain.APIKeyScopeWrite) {
		t.Errorf("a write key must carry read as well; scopes = %v", writeKey.Scopes)
	}

	// The unrestricted scope is the interesting one: it is a wildcard over scopes, and it
	// still may not add a role, an action or a team.
	_, adminToken, _, err := svc.CreateApiKey(ctx, pBob, domain.CreateApiKeyInput{
		Name: "everything", Scopes: []string{domain.APIKeyScopeAdmin},
	})
	if err != nil {
		t.Fatalf("create admin-scoped key: %v", err)
	}
	adminKey, err := svc.AuthenticateApiKey(ctx, adminToken)
	if err != nil {
		t.Fatalf("authenticate admin-scoped key: %v", err)
	}
	if adminKey.Role != authz.RoleMember {
		t.Errorf("role = %s, want member — a scope must not promote its owner", adminKey.Role)
	}
	if authz.Can(adminKey, authz.ActionMemberInvite) {
		t.Error("an admin-scoped key held by a member must not gain admin actions")
	}
	if adminKey.Teams.Has(secret.ID) {
		t.Error("no scope may hand a key a private team its owner is not a member of")
	}

	if _, _, _, err := svc.CreateApiKey(ctx, pBob, domain.CreateApiKeyInput{
		Name: "typo", Scopes: []string{"issues:writ"},
	}); platform.CodeOf(err) != platform.CodeValidation {
		t.Errorf("an unknown scope must be refused, not silently dropped into a key that does nothing; got %v", err)
	}
}

func TestListApiKeys_ReturnsTheCallersKeysAndNobodyElses(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	bob := f.NewUser(t, "bob", "member", true)
	pBob := f.PrincipalFor(bob, authz.RoleMember, f.TeamID)
	if _, _, _, err := svc.CreateApiKey(ctx, pBob, domain.CreateApiKeyInput{Name: "bob's key"}); err != nil {
		t.Fatalf("create bob's key: %v", err)
	}

	// The admin is the strongest caller in the workspace, and there is still no argument
	// they could pass to see somebody else's keys — a workspace-wide listing would be an
	// inventory of every long-lived credential in the organisation.
	adminList, err := svc.ListApiKeys(ctx, f.Principal())
	if err != nil {
		t.Fatalf("list as admin: %v", err)
	}
	if len(adminList) != 0 {
		t.Errorf("an admin listing keys sees %d of somebody else's", len(adminList))
	}

	bobList, err := svc.ListApiKeys(ctx, pBob)
	if err != nil {
		t.Fatalf("list as bob: %v", err)
	}
	if len(bobList) != 1 || bobList[0].UserID != bob {
		t.Errorf("bob must see his own key; got %+v", bobList)
	}
}

func TestRevokeApiKey_CannotRetireSomebodyElsesKey(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	bob := f.NewUser(t, "bob", "member", true)
	pBob := f.PrincipalFor(bob, authz.RoleMember, f.TeamID)
	key, token, _, err := svc.CreateApiKey(ctx, pBob, domain.CreateApiKeyInput{Name: "bob's key"})
	if err != nil {
		t.Fatalf("create key: %v", err)
	}

	mallory := f.NewUser(t, "mallory", "member", true)
	pMallory := f.PrincipalFor(mallory, authz.RoleMember, f.TeamID)

	_, _, err = svc.RevokeApiKey(ctx, pMallory, key.ID)
	// Not-found rather than forbidden: "you may not touch that" confirms the key exists,
	// which turns a guessed id into an inventory of who holds credentials.
	if code := platform.CodeOf(err); code != platform.CodeNotFound {
		t.Fatalf("code = %s, want %s", code, platform.CodeNotFound)
	}
	if _, err := svc.AuthenticateApiKey(ctx, token); err != nil {
		t.Errorf("the key must still work after a stranger's revoke attempt: %v", err)
	}
}

func TestCreateApiKey_GuestsCannotMintKeys(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	guest := f.NewUser(t, "contractor", "guest", true)
	pGuest := f.PrincipalFor(guest, authz.RoleGuest, f.TeamID)

	// A key acts as its owner and outlives the session, which is the opposite of what a
	// guest's access is meant to be.
	_, _, _, err := svc.CreateApiKey(ctx, pGuest, domain.CreateApiKeyInput{Name: "contractor key"})
	if code := platform.CodeOf(err); code != platform.CodeForbidden {
		t.Fatalf("code = %s, want %s", code, platform.CodeForbidden)
	}
}

func TestAuthenticateApiKey_RejectsGarbageWithoutTouchingAnything(t *testing.T) {
	db := testutil.NewDB(t)
	testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	for _, token := range []string{"", "plk_", "not-a-token", "plk_" + strings.Repeat("A", 43)} {
		if _, err := svc.AuthenticateApiKey(ctx, token); err == nil {
			t.Errorf("token %q authenticated", token)
		} else if code := platform.CodeOf(err); code != platform.CodeUnauthorized {
			t.Errorf("token %q gave %s, want %s — every failure must look the same",
				token, code, platform.CodeUnauthorized)
		}
	}
}
