// Package oidc verifies the ID tokens Apple and Google hand a client after a sign-in.
//
// Hand-rolled rather than an SDK, for the reason the Stripe client gives next door: this is
// one signature check and five claim comparisons against two issuers whose formats are
// specified, and a library here would pin its own JWT parser, its own key cache and its own
// upgrade schedule inside the one code path where a mistake is somebody else's account.
//
// The security properties, stated so they can be checked against the code:
//
//   - The signature is verified against a key fetched from the issuer's own JWKS endpoint
//     over TLS, keyed by the token's `kid`. An unknown kid forces one refetch, because that
//     is what key rotation looks like from here; a second miss is a refusal.
//   - `alg` comes from an allowlist and never from the token. A token saying `alg: none`, or
//     naming HMAC so that the public key would be used as a shared secret, is refused before
//     anything is parsed.
//   - `iss` must equal the provider's issuer exactly, and `aud` must be one this deployment
//     configured. Skipping the audience check is what lets a token minted for somebody
//     else's app sign in to this one.
//   - `exp` and `iat` are checked with a small skew, and a nonce is compared when the caller
//     supplied one.
//
// What it deliberately does not do: fetch the issuer's discovery document. The two endpoints
// are constants below, they have not moved in a decade, and reading them from a URL under an
// attacker's influence would make the issuer configurable by whoever set the config.
package oidc

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Skew is how far apart this server's clock and the issuer's may be.
const Skew = 2 * time.Minute

// jwksTTL is how long a key set is reused before being refetched.
//
// Both issuers rotate on the order of days and serve cache headers saying so. An hour keeps
// the endpoint off the sign-in path without holding a rotated-out key long enough to matter:
// an unknown kid refetches immediately regardless, which is the case rotation actually
// produces.
const jwksTTL = time.Hour

// Provider is one issuer this deployment accepts tokens from.
type Provider struct {
	// Name is what the route and the credential row call it: "google", "apple".
	Name string
	// Issuer must equal the token's `iss` exactly.
	Issuer string
	// JWKSURL serves the issuer's public keys.
	JWKSURL string
	// Audiences are the client ids this deployment owns. A token is accepted when its `aud`
	// is one of them — plural because the same Apple account serves an iOS bundle id and a
	// web Services ID, and they are different strings.
	Audiences []string
}

// Google's ID tokens. `accounts.google.com` also appears as an issuer historically; the
// modern one is the https form and it is the only one accepted here.
func Google(audiences []string) Provider {
	return Provider{
		Name:      "google",
		Issuer:    "https://accounts.google.com",
		JWKSURL:   "https://www.googleapis.com/oauth2/v3/certs",
		Audiences: audiences,
	}
}

// Apple's ID tokens, from Sign in with Apple.
func Apple(audiences []string) Provider {
	return Provider{
		Name:      "apple",
		Issuer:    "https://appleid.apple.com",
		JWKSURL:   "https://appleid.apple.com/auth/keys",
		Audiences: audiences,
	}
}

// Configured reports whether this provider can verify anything at all.
//
// A provider with no audience is not "permissive", it is unusable: every token would fail
// the audience check. Callers use this to leave the route off entirely rather than serving
// an endpoint that refuses everything for a reason nobody can see.
func (p Provider) Configured() bool { return len(p.Audiences) > 0 }

// Claims is what a verified token says about the person signing in.
type Claims struct {
	// Subject is the issuer's stable identifier. This, not the email, is the identity: an
	// address can be reassigned inside a company and Apple's relay addresses change.
	Subject string
	Email   string
	// EmailVerified is the issuer's word for it. An unverified address must never be used to
	// find an existing account — that is account takeover by signing up with somebody's
	// address at a provider that does not check.
	EmailVerified bool
	Name          string
}

// Verifier checks tokens and caches issuer keys. Safe for concurrent use.
type Verifier struct {
	http *http.Client
	now  func() time.Time

	mu    sync.Mutex
	cache map[string]cachedKeys
}

type cachedKeys struct {
	keys    map[string]*rsa.PublicKey
	fetched time.Time
}

// NewVerifier returns a verifier. `now` may be nil, and is a seam for tests only.
func NewVerifier(client *http.Client, now func() time.Time) *Verifier {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	if now == nil {
		now = time.Now
	}
	return &Verifier{http: client, now: now, cache: map[string]cachedKeys{}}
}

// ErrToken is what every rejection wraps.
//
// One error kind for every cause on purpose: the caller turns this into a single 401, and a
// handler that could tell "wrong audience" from "expired" from "bad signature" would sooner
// or later say which, to somebody holding a token they should not have.
var ErrToken = errors.New("oidc: the token was not accepted")

func reject(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrToken, fmt.Sprintf(format, args...))
}

// Verify checks a raw ID token and returns what it says.
//
// nonce is compared when non-empty. The web flows bind one; the native Apple flow binds the
// SHA-256 of one, which is the caller's business — this compares the string it is given.
func (v *Verifier) Verify(ctx context.Context, p Provider, raw, nonce string) (Claims, error) {
	if !p.Configured() {
		return Claims{}, reject("provider %s is not configured", p.Name)
	}

	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return Claims{}, reject("not a three-part JWT")
	}

	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := decodeSegment(parts[0], &header); err != nil {
		return Claims{}, reject("unreadable header")
	}
	// The allowlist is the whole defence against alg confusion. Both issuers sign RS256;
	// accepting `none` would make any token valid, and accepting HS256 would verify it with
	// the public key as the shared secret — a key the attacker can also fetch.
	if header.Alg != "RS256" {
		return Claims{}, reject("unsupported alg %q", header.Alg)
	}
	if header.Kid == "" {
		return Claims{}, reject("no key id")
	}

	key, err := v.key(ctx, p, header.Kid, false)
	if err != nil {
		return Claims{}, err
	}

	signed := parts[0] + "." + parts[1]
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Claims{}, reject("unreadable signature")
	}
	digest := sha256.Sum256([]byte(signed))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature); err != nil {
		return Claims{}, reject("signature does not verify")
	}

	var body struct {
		Issuer   string          `json:"iss"`
		Subject  string          `json:"sub"`
		Audience json.RawMessage `json:"aud"`
		Expiry   int64           `json:"exp"`
		IssuedAt int64           `json:"iat"`
		Nonce    string          `json:"nonce"`
		Email    string          `json:"email"`
		// Both issuers have sent this as a bool and as the string "true" at different
		// times, and Apple still does the latter. A strict bool would silently read a
		// verified address as unverified, which fails closed but locks out every Apple user.
		EmailVerified json.RawMessage `json:"email_verified"`
		Name          string          `json:"name"`
	}
	if err := decodeSegment(parts[1], &body); err != nil {
		return Claims{}, reject("unreadable payload")
	}

	if body.Issuer != p.Issuer {
		return Claims{}, reject("issuer %q is not %q", body.Issuer, p.Issuer)
	}
	if body.Subject == "" {
		return Claims{}, reject("no subject")
	}
	audiences, err := audienceList(body.Audience)
	if err != nil {
		return Claims{}, reject("unreadable audience")
	}
	if !anyOf(audiences, p.Audiences) {
		return Claims{}, reject("audience is not this deployment's")
	}

	now := v.now()
	if body.Expiry == 0 || now.After(time.Unix(body.Expiry, 0).Add(Skew)) {
		return Claims{}, reject("expired")
	}
	// A token from the future is either a clock problem or a forgery attempt against an
	// endpoint that only checks expiry.
	if body.IssuedAt != 0 && time.Unix(body.IssuedAt, 0).After(now.Add(Skew)) {
		return Claims{}, reject("issued in the future")
	}
	if nonce != "" && body.Nonce != nonce {
		return Claims{}, reject("nonce does not match")
	}

	return Claims{
		Subject:       body.Subject,
		Email:         strings.ToLower(strings.TrimSpace(body.Email)),
		EmailVerified: truthy(body.EmailVerified),
		Name:          strings.TrimSpace(body.Name),
	}, nil
}

// key returns the issuer's public key for kid, refetching once when it is unknown.
func (v *Verifier) key(ctx context.Context, p Provider, kid string, refreshed bool) (*rsa.PublicKey, error) {
	v.mu.Lock()
	entry, ok := v.cache[p.JWKSURL]
	fresh := ok && v.now().Sub(entry.fetched) < jwksTTL
	v.mu.Unlock()

	if fresh && !refreshed {
		if key, found := entry.keys[kid]; found {
			return key, nil
		}
		// A kid the cache does not hold is what rotation looks like: the issuer published a
		// new key and this process has a stale set. One refetch, then a refusal — otherwise
		// a stream of forged kids becomes a stream of requests to the issuer.
		return v.key(ctx, p, kid, true)
	}

	keys, err := v.fetch(ctx, p.JWKSURL)
	if err != nil {
		return nil, err
	}
	v.mu.Lock()
	v.cache[p.JWKSURL] = cachedKeys{keys: keys, fetched: v.now()}
	v.mu.Unlock()

	key, found := keys[kid]
	if !found {
		return nil, reject("no key %q at %s", kid, p.Name)
	}
	return key, nil
}

// maxJWKS caps the key document. Both issuers serve a few kilobytes.
const maxJWKS = 1 << 20

func (v *Verifier) fetch(ctx context.Context, url string) (map[string]*rsa.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := v.http.Do(req)
	if err != nil {
		// Not an ErrToken: the token may be perfectly good and the issuer unreachable, and
		// a caller turning that into "your sign-in is invalid" sends the user to fix
		// something that is not broken.
		return nil, fmt.Errorf("oidc: fetching %s: %w", url, err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oidc: fetching %s: %d", url, res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxJWKS))
	if err != nil {
		return nil, fmt.Errorf("oidc: reading %s: %w", url, err)
	}

	var doc struct {
		Keys []struct {
			Kty string `json:"kty"`
			Kid string `json:"kid"`
			Use string `json:"use"`
			Alg string `json:"alg"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, fmt.Errorf("oidc: decoding %s: %w", url, err)
	}

	keys := map[string]*rsa.PublicKey{}
	for _, k := range doc.Keys {
		// Signing keys only. A set that also carries encryption keys must not offer one of
		// them as something to check a signature against.
		if k.Kty != "RSA" || k.Kid == "" || (k.Use != "" && k.Use != "sig") {
			continue
		}
		n, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil {
			continue
		}
		e, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil || len(e) == 0 || len(e) > 8 {
			continue
		}
		padded := make([]byte, 8)
		copy(padded[8-len(e):], e)
		exponent := binary.BigEndian.Uint64(padded)
		if exponent == 0 || exponent > 1<<31 {
			continue
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(exponent)}
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("oidc: %s served no usable signing keys", url)
	}
	return keys, nil
}

func decodeSegment(segment string, into any) error {
	raw, err := base64.RawURLEncoding.DecodeString(segment)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, into)
}

// audienceList reads `aud`, which the spec allows to be a string or an array of them.
func audienceList(raw json.RawMessage) ([]string, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var one string
	if err := json.Unmarshal(raw, &one); err == nil {
		return []string{one}, nil
	}
	var many []string
	if err := json.Unmarshal(raw, &many); err != nil {
		return nil, err
	}
	return many, nil
}

func anyOf(got, want []string) bool {
	for _, g := range got {
		for _, w := range want {
			if g != "" && g == w {
				return true
			}
		}
	}
	return false
}

// truthy reads a claim that is sometimes a bool and sometimes the string "true".
func truthy(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var b bool
	if err := json.Unmarshal(raw, &b); err == nil {
		return b
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return strings.EqualFold(s, "true")
	}
	return false
}
