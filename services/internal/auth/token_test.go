package auth

import (
	"encoding/base64"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

var testSecret = []byte("a signing secret long enough to be one")

func sampleClaims() Claims {
	return Claims{
		AccountID:   uuid.New(),
		UserID:      uuid.New(),
		WorkspaceID: uuid.New(),
		Role:        "admin",
		// Truncated to the second because that is the resolution a JWT numeric date has.
		// Comparing against an untruncated time would be testing the format, not the code.
		IssuedAt: time.Now().Truncate(time.Second),
	}
}

func TestAccessToken_EveryClaimSurvivesTheRoundTrip(t *testing.T) {
	want := sampleClaims()
	const ttl = time.Hour

	tok, err := IssueAccessToken(testSecret, want, ttl)
	if err != nil {
		t.Fatalf("issuing a well-formed token must succeed: %v", err)
	}

	got, err := ParseAccessToken(testSecret, tok)
	if err != nil {
		t.Fatalf("a token this package just issued must parse: %v", err)
	}

	if got.AccountID != want.AccountID {
		t.Errorf("AccountID = %s, want %s: the auth identity is what a session is revoked by", got.AccountID, want.AccountID)
	}
	if got.UserID != want.UserID {
		t.Errorf("UserID = %s, want %s: the workspace profile is what every authorship and permission check keys on", got.UserID, want.UserID)
	}
	if got.WorkspaceID != want.WorkspaceID {
		t.Errorf("WorkspaceID = %s, want %s: a token scoped to the wrong workspace is a cross-tenant read", got.WorkspaceID, want.WorkspaceID)
	}
	if got.Role != want.Role {
		t.Errorf("Role = %q, want %q: the role gates every mutation", got.Role, want.Role)
	}
	if !got.IssuedAt.Equal(want.IssuedAt) {
		t.Errorf("IssuedAt = %s, want %s", got.IssuedAt, want.IssuedAt)
	}
	if !got.ExpiresAt.Equal(want.IssuedAt.Add(ttl)) {
		t.Errorf("ExpiresAt = %s, want %s: the ttl argument must decide the lifetime", got.ExpiresAt, want.IssuedAt.Add(ttl))
	}
}

func TestIssueAccessToken_TTLOverridesTheClaimsExpiry(t *testing.T) {
	c := sampleClaims()
	// A caller filling in a decade-long expiry must not get one: the lifetime belongs to the
	// endpoint that issues the token, not to whoever assembled the struct.
	c.ExpiresAt = c.IssuedAt.Add(10 * 365 * 24 * time.Hour)

	tok, err := IssueAccessToken(testSecret, c, 15*time.Minute)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	got, err := ParseAccessToken(testSecret, tok)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !got.ExpiresAt.Equal(c.IssuedAt.Add(15 * time.Minute)) {
		t.Errorf("ExpiresAt = %s, want %s: ttl must win over the ExpiresAt field", got.ExpiresAt, c.IssuedAt.Add(15*time.Minute))
	}
}

func TestParseAccessToken_RejectsForgedAndStaleTokens(t *testing.T) {
	valid := sampleClaims()

	expired, err := IssueAccessToken(testSecret, valid, -time.Minute)
	if err != nil {
		t.Fatalf("issuing an already-expired token must still succeed, expiry is the parser's business: %v", err)
	}

	otherSecret, err := IssueAccessToken([]byte("a completely different secret"), valid, time.Hour)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	// The classic algorithm-confusion attack: the token names its own algorithm, so an
	// attacker who can persuade the parser to honour that header can drop the signature
	// entirely. This token is well-formed and carries the right issuer and a future expiry;
	// the only thing wrong with it is that nobody signed it.
	noneToken, err := jwt.NewWithClaims(jwt.SigningMethodNone, accessClaims{
		UserID:      valid.UserID.String(),
		WorkspaceID: valid.WorkspaceID.String(),
		Role:        "owner",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Subject:   valid.AccountID.String(),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("setup: forging an alg:none token: %v", err)
	}

	// HS512 is a real HMAC, correctly signed with our real secret. It is still rejected,
	// because the set of algorithms we accept is ours to choose and is not negotiable by
	// the token.
	hs512, err := jwt.NewWithClaims(jwt.SigningMethodHS512, accessClaims{
		UserID:      valid.UserID.String(),
		WorkspaceID: valid.WorkspaceID.String(),
		Role:        valid.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Subject:   valid.AccountID.String(),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}).SignedString(testSecret)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	foreignIssuer, err := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims{
		UserID:      valid.UserID.String(),
		WorkspaceID: valid.WorkspaceID.String(),
		Role:        valid.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "some-other-service",
			Subject:   valid.AccountID.String(),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}).SignedString(testSecret)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	noExpiry, err := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims{
		UserID:      valid.UserID.String(),
		WorkspaceID: valid.WorkspaceID.String(),
		Role:        valid.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:   Issuer,
			Subject:  valid.AccountID.String(),
			IssuedAt: jwt.NewNumericDate(time.Now()),
		},
	}).SignedString(testSecret)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	notAUUID, err := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims{
		UserID:      "not-a-uuid",
		WorkspaceID: valid.WorkspaceID.String(),
		Role:        valid.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Subject:   valid.AccountID.String(),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}).SignedString(testSecret)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	tests := []struct {
		name string
		tok  string
		why  string
	}{
		{"expired", expired, "an expired token must be refused, or a stolen one is a permanent login"},
		{"signed with another secret", otherSecret, "a token signed with a secret we do not hold is somebody else's, whatever it claims"},
		{"alg none", noneToken, "accepting the token's own alg header lets an attacker drop the signature and mint themselves any claims they like"},
		{"alg HS512", hs512, "only the algorithm we issue is accepted; the acceptable set is not the token's to widen"},
		{"foreign issuer", foreignIssuer, "a token from another service that shares our secret is not a Polaris session"},
		{"no expiry", noExpiry, "a token without exp would never expire, so its absence must be a rejection rather than a default"},
		{"unparseable user id", notAUUID, "a claim that is not a uuid must fail here, not in whatever query first interpolates it"},
		{"empty", "", "an absent Authorization header must not authenticate anyone"},
		{"garbage", "not.a.token", "arbitrary rubbish must error, never panic"},
		{"header only", "eyJhbGciOiJIUzI1NiJ9", "a truncated token must error, never panic"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseAccessToken(testSecret, tt.tok)
			if err == nil {
				t.Fatal(tt.why)
			}
			if code := platform.CodeOf(err); code != platform.CodeUnauthorized {
				t.Errorf("got code %s, want %s: a bad token is an authentication failure and must map to 401", code, platform.CodeUnauthorized)
			}
			if got != (Claims{}) {
				t.Error("a rejected token must yield zero claims, so a caller that ignores the error cannot act on an attacker's identity")
			}
		})
	}
}

func TestAccessToken_EmptySecretIsAConfigurationFailure(t *testing.T) {
	if _, err := IssueAccessToken(nil, sampleClaims(), time.Hour); err == nil {
		t.Error("signing with an empty secret would produce tokens anyone can forge and must not be possible")
	} else if code := platform.CodeOf(err); code != platform.CodeInternal {
		t.Errorf("got code %s, want %s: a missing secret is a deployment fault, not the caller's input", code, platform.CodeInternal)
	}

	if _, err := ParseAccessToken(nil, "anything"); err == nil {
		t.Error("verifying against an empty secret must not be possible")
	} else if code := platform.CodeOf(err); code != platform.CodeInternal {
		t.Errorf("got code %s, want %s", code, platform.CodeInternal)
	}
}

func TestNewOpaqueToken(t *testing.T) {
	plain, hash, err := NewOpaqueToken()
	if err != nil {
		t.Fatalf("minting a token must succeed: %v", err)
	}

	raw, err := base64.RawURLEncoding.DecodeString(plain)
	if err != nil {
		t.Fatalf("the plaintext must be unpadded base64url so it survives a cookie, a header and a URL unescaped: %v", err)
	}
	if len(raw) != opaqueTokenBytes {
		t.Errorf("got %d bytes of entropy, want %d: a session token is only as unguessable as its length", len(raw), opaqueTokenBytes)
	}

	if string(hash) == plain {
		t.Fatal("the returned hash must be a digest, not the plaintext")
	}
	if !ConstantTimeEqualHash(hash, HashToken(plain)) {
		t.Error("the returned hash must be what HashToken produces, or a presented token can never be looked up")
	}
	if len(hash) != 32 {
		t.Errorf("got a %d-byte digest, want 32 (SHA-256)", len(hash))
	}
}

func TestNewOpaqueToken_IsUnpredictable(t *testing.T) {
	const n = 128
	seen := make(map[string]struct{}, n)

	for range n {
		plain, _, err := NewOpaqueToken()
		if err != nil {
			t.Fatalf("mint: %v", err)
		}
		if _, dup := seen[plain]; dup {
			t.Fatal("two mints returned the same token: the source is not random and every session is guessable")
		}
		seen[plain] = struct{}{}
	}
}

func TestConstantTimeEqualHash(t *testing.T) {
	a := HashToken("token-a")
	b := HashToken("token-b")

	tests := []struct {
		name string
		x, y []byte
		want bool
		why  string
	}{
		{"identical", a, HashToken("token-a"), true, "the same token must hash to the same digest or no session ever resumes"},
		{"different", a, b, false, "different tokens must not compare equal"},
		{"differs in the last byte only", a, append(append([]byte{}, a[:31]...), a[31]^0xff), false, "a near-miss must be rejected as firmly as a wild guess"},
		{"different lengths", a, a[:16], false, "a truncated digest must not match its own prefix"},
		{"both empty", nil, nil, true, "the comparison itself is length-blind; guarding against empty digests is the caller's job"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ConstantTimeEqualHash(tt.x, tt.y); got != tt.want {
				t.Errorf("ConstantTimeEqualHash = %v, want %v: %s", got, tt.want, tt.why)
			}
		})
	}
}
