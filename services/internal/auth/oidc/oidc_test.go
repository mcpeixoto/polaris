package oidc

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// A fake issuer: an RSA key, a JWKS endpoint, and a token minter. Everything the real
// providers do that this package cares about, and nothing else.
type issuer struct {
	t        *testing.T
	key      *rsa.PrivateKey
	kid      string
	server   *httptest.Server
	fetches  int
	rotateTo *rsa.PrivateKey
}

func newIssuer(t *testing.T) *issuer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	iss := &issuer{t: t, key: key, kid: "key-1"}
	iss.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		iss.fetches++
		public := iss.key
		kid := iss.kid
		if iss.rotateTo != nil {
			public, kid = iss.rotateTo, "key-2"
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"keys":[%s]}`, jwk(kid, &public.PublicKey))
	}))
	t.Cleanup(iss.server.Close)
	return iss
}

func jwk(kid string, pub *rsa.PublicKey) string {
	e := make([]byte, 8)
	binary.BigEndian.PutUint64(e, uint64(pub.E))
	trimmed := 0
	for trimmed < len(e)-1 && e[trimmed] == 0 {
		trimmed++
	}
	return fmt.Sprintf(`{"kty":"RSA","use":"sig","alg":"RS256","kid":%q,"n":%q,"e":%q}`,
		kid,
		base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
		base64.RawURLEncoding.EncodeToString(e[trimmed:]))
}

func (i *issuer) provider(audiences ...string) Provider {
	return Provider{
		Name: "test", Issuer: "https://issuer.example", JWKSURL: i.server.URL, Audiences: audiences,
	}
}

type claimSet map[string]any

func (i *issuer) mint(t *testing.T, claims claimSet, over ...func(header map[string]any)) string {
	t.Helper()
	header := map[string]any{"alg": "RS256", "kid": i.kid, "typ": "JWT"}
	for _, fn := range over {
		fn(header)
	}
	encode := func(v any) string {
		raw, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return base64.RawURLEncoding.EncodeToString(raw)
	}
	signing := encode(header) + "." + encode(claims)
	if header["alg"] == "none" {
		return signing + "."
	}
	digest := sha256.Sum256([]byte(signing))
	signature, err := rsa.SignPKCS1v15(rand.Reader, i.key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return signing + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func valid(iss *issuer) claimSet {
	return claimSet{
		"iss": "https://issuer.example", "sub": "user-123", "aud": "client-a",
		"exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(),
		"email": "Ada@Example.com", "email_verified": true, "name": "Ada Lovelace",
	}
}

func TestVerifyAcceptsAWellFormedToken(t *testing.T) {
	iss := newIssuer(t)
	v := NewVerifier(iss.server.Client(), nil)

	got, err := v.Verify(context.Background(), iss.provider("client-a"), iss.mint(t, valid(iss)), "")
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if got.Subject != "user-123" || !got.EmailVerified || got.Name != "Ada Lovelace" {
		t.Fatalf("claims = %+v", got)
	}
	// Lower-cased, because the account lookup is by address and the issuer's casing is not
	// a fact about the person.
	if got.Email != "ada@example.com" {
		t.Fatalf("email = %q, want it normalised", got.Email)
	}
}

// The whole point of the audience check: a token minted for a different app, signed by the
// same issuer with the same key, must not sign in here.
func TestVerifyRefusesAnotherApplicationsToken(t *testing.T) {
	iss := newIssuer(t)
	v := NewVerifier(iss.server.Client(), nil)

	claims := valid(iss)
	claims["aud"] = "somebody-elses-client"
	if _, err := v.Verify(context.Background(), iss.provider("client-a"), iss.mint(t, claims), ""); err == nil {
		t.Fatal("a token for another audience was accepted")
	}
}

func TestVerifyAcceptsAnyConfiguredAudience(t *testing.T) {
	iss := newIssuer(t)
	v := NewVerifier(iss.server.Client(), nil)

	// Apple's iOS bundle id and web Services ID are different strings for one deployment.
	claims := valid(iss)
	claims["aud"] = []string{"com.example.ios"}
	_, err := v.Verify(context.Background(), iss.provider("web-services-id", "com.example.ios"),
		iss.mint(t, claims), "")
	if err != nil {
		t.Fatalf("an array audience naming a configured client was refused: %v", err)
	}
}

func TestVerifyRejections(t *testing.T) {
	iss := newIssuer(t)
	other, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}

	cases := map[string]func() string{
		"expired": func() string {
			c := valid(iss)
			c["exp"] = time.Now().Add(-time.Hour).Unix()
			return iss.mint(t, c)
		},
		"issued in the future": func() string {
			c := valid(iss)
			c["iat"] = time.Now().Add(time.Hour).Unix()
			return iss.mint(t, c)
		},
		"wrong issuer": func() string {
			c := valid(iss)
			c["iss"] = "https://evil.example"
			return iss.mint(t, c)
		},
		"no subject": func() string {
			c := valid(iss)
			delete(c, "sub")
			return iss.mint(t, c)
		},
		// alg: none is the classic forgery. Nothing is verified, so it must be refused on
		// the header alone.
		"alg none": func() string {
			return iss.mint(t, valid(iss), func(h map[string]any) { h["alg"] = "none" })
		},
		// alg confusion: naming HMAC would have the public key — which anyone can fetch —
		// used as the shared secret.
		"alg HS256": func() string {
			return iss.mint(t, valid(iss), func(h map[string]any) { h["alg"] = "HS256" })
		},
		"unknown key id": func() string {
			return iss.mint(t, valid(iss), func(h map[string]any) { h["kid"] = "not-a-key" })
		},
		"not a jwt": func() string { return "garbage" },
		"payload edited after signing": func() string {
			token := iss.mint(t, valid(iss))
			parts := strings.Split(token, ".")
			tampered := valid(iss)
			tampered["sub"] = "somebody-else"
			raw, _ := json.Marshal(tampered)
			parts[1] = base64.RawURLEncoding.EncodeToString(raw)
			return strings.Join(parts, ".")
		},
	}

	v := NewVerifier(iss.server.Client(), nil)
	for name, build := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := v.Verify(context.Background(), iss.provider("client-a"), build(), ""); err == nil {
				t.Fatal("accepted a token it should have refused")
			} else if !errors.Is(err, ErrToken) {
				t.Fatalf("error does not wrap ErrToken: %v", err)
			}
		})
	}

	// Signed by a key the issuer never published.
	t.Run("signed by a stranger", func(t *testing.T) {
		imposter := &issuer{t: t, key: other, kid: iss.kid, server: iss.server}
		if _, err := v.Verify(context.Background(), iss.provider("client-a"),
			imposter.mint(t, valid(iss)), ""); err == nil {
			t.Fatal("a token signed by an unpublished key was accepted")
		}
	})
}

func TestVerifyChecksTheNonceWhenOneIsExpected(t *testing.T) {
	iss := newIssuer(t)
	v := NewVerifier(iss.server.Client(), nil)

	claims := valid(iss)
	claims["nonce"] = "n-abc"
	provider := iss.provider("client-a")

	if _, err := v.Verify(context.Background(), provider, iss.mint(t, claims), "n-abc"); err != nil {
		t.Fatalf("a matching nonce was refused: %v", err)
	}
	if _, err := v.Verify(context.Background(), provider, iss.mint(t, claims), "n-different"); err == nil {
		t.Fatal("a replayed token with the wrong nonce was accepted")
	}
}

// Apple sends email_verified as the string "true". Reading it strictly as a bool would make
// every Apple address look unverified, and unverified addresses are never linked.
func TestVerifyReadsEmailVerifiedAsBoolOrString(t *testing.T) {
	iss := newIssuer(t)
	v := NewVerifier(iss.server.Client(), nil)
	provider := iss.provider("client-a")

	for _, form := range []any{true, "true"} {
		claims := valid(iss)
		claims["email_verified"] = form
		got, err := v.Verify(context.Background(), provider, iss.mint(t, claims), "")
		if err != nil {
			t.Fatalf("Verify(%v): %v", form, err)
		}
		if !got.EmailVerified {
			t.Fatalf("email_verified %#v read as false", form)
		}
	}
	for _, form := range []any{false, "false"} {
		claims := valid(iss)
		claims["email_verified"] = form
		got, err := v.Verify(context.Background(), provider, iss.mint(t, claims), "")
		if err != nil {
			t.Fatalf("Verify(%v): %v", form, err)
		}
		if got.EmailVerified {
			t.Fatalf("email_verified %#v read as true", form)
		}
	}
}

// The keys are cached, and a kid the cache does not hold forces exactly one refetch — which
// is what a rotation looks like from here.
func TestKeysAreCachedAndRefetchedOnRotation(t *testing.T) {
	iss := newIssuer(t)
	v := NewVerifier(iss.server.Client(), nil)
	provider := iss.provider("client-a")

	for range 3 {
		if _, err := v.Verify(context.Background(), provider, iss.mint(t, valid(iss)), ""); err != nil {
			t.Fatal(err)
		}
	}
	if iss.fetches != 1 {
		t.Fatalf("fetched the key set %d times for three verifications", iss.fetches)
	}

	rotated, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	iss.rotateTo = rotated
	iss.key = rotated
	iss.kid = "key-2"

	if _, err := v.Verify(context.Background(), provider, iss.mint(t, valid(iss)), ""); err != nil {
		t.Fatalf("a token signed by the rotated key was refused: %v", err)
	}
	if iss.fetches != 2 {
		t.Fatalf("rotation cost %d fetches, want 2", iss.fetches)
	}
}

// An unreachable issuer is not a bad token. Reporting it as one sends the user to fix a
// sign-in that is not broken.
func TestUnreachableIssuerIsNotATokenError(t *testing.T) {
	iss := newIssuer(t)
	v := NewVerifier(iss.server.Client(), nil)
	provider := iss.provider("client-a")
	token := iss.mint(t, valid(iss))
	iss.server.Close()

	_, err := v.Verify(context.Background(), provider, token, "")
	if err == nil {
		t.Fatal("a token verified against an issuer that is not answering")
	}
	if errors.Is(err, ErrToken) {
		t.Fatalf("an outage was reported as a rejected token: %v", err)
	}
}

// A provider with no client id configured cannot verify anything; it must say so rather
// than accept a token whose audience it has no opinion about.
func TestUnconfiguredProviderRefusesEverything(t *testing.T) {
	iss := newIssuer(t)
	v := NewVerifier(iss.server.Client(), nil)
	if Google(nil).Configured() || Apple([]string{}).Configured() {
		t.Fatal("a provider with no audience reported itself configured")
	}
	if _, err := v.Verify(context.Background(), iss.provider(), iss.mint(t, valid(iss)), ""); err == nil {
		t.Fatal("an unconfigured provider accepted a token")
	}
}

func TestProviderConstants(t *testing.T) {
	google := Google([]string{"g"})
	apple := Apple([]string{"a"})
	if google.Issuer != "https://accounts.google.com" || apple.Issuer != "https://appleid.apple.com" {
		t.Fatalf("issuers = %q / %q", google.Issuer, apple.Issuer)
	}
	if !strings.HasPrefix(google.JWKSURL, "https://") || !strings.HasPrefix(apple.JWKSURL, "https://") {
		t.Fatal("a key set would be fetched over plaintext")
	}
}
