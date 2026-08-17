package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Issuer is stamped into every access token and demanded back on every parse. It costs
// nothing and it means a token minted by some other service that happens to share a secret
// — a staging environment, a sibling product, a copied config — is not a Polaris session.
const Issuer = "polaris"

// opaqueTokenBytes is 256 bits of entropy: enough that guessing a live session is not a
// strategy, and short enough to sit in a cookie without complaint.
const opaqueTokenBytes = 32

// NewOpaqueToken mints a refresh/session token, returning the plaintext to hand to the
// caller and the SHA-256 digest to store.
//
// Only the digest is ever persisted. A session token is a bearer credential, so a leaked
// `account_session` table — a stray backup, a read-only replica, a log line, a SQL
// injection on an unrelated query — would otherwise be a pile of live logins that survive a
// password reset. Storing the digest means the leak yields nothing usable, and the
// plaintext exists exactly once: in the response that created it.
//
// The digest is a plain SHA-256 rather than a password hash on purpose. These tokens are
// full-entropy random, not guessable, so there is nothing for a slow KDF to defend against
// — and a session lookup runs on every request, where 64 MiB of Argon2 would be a
// self-inflicted denial of service.
func NewOpaqueToken() (plain string, hash []byte, err error) {
	buf := make([]byte, opaqueTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", nil, platform.Internal(err)
	}
	// base64url unpadded: safe in a URL, a cookie and a header without further escaping,
	// and free of the '=' that trips up naive splitting.
	plain = base64.RawURLEncoding.EncodeToString(buf)
	return plain, HashToken(plain), nil
}

// HashToken digests a token plaintext the same way NewOpaqueToken did, so a presented
// token can be looked up by digest. It hashes the encoded string rather than the raw bytes
// because that is what the caller actually holds.
func HashToken(plain string) []byte {
	sum := sha256.Sum256([]byte(plain))
	return sum[:]
}

// ConstantTimeEqualHash compares two token digests without leaking, through timing, how
// long a matching prefix the caller managed to produce. Use it wherever a presented token's
// digest is checked against a stored one; the database lookup that found the row is not
// itself a proof of equality if the query was by prefix or the row came from elsewhere.
func ConstantTimeEqualHash(a, b []byte) bool {
	return subtle.ConstantTimeCompare(a, b) == 1
}

// Claims is the identity a request carries. AccountID is the auth identity and UserID is
// its profile inside one workspace; both are present because milestone 0 fixed one account
// to many workspace users, and a token is scoped to exactly one of them. A session that
// switches workspace gets a new access token, not a mutated one.
type Claims struct {
	AccountID   uuid.UUID
	UserID      uuid.UUID
	WorkspaceID uuid.UUID
	Role        string
	ExpiresAt   time.Time
	IssuedAt    time.Time
}

// accessClaims is the wire shape. Short JSON names keep the token small enough to stay
// comfortably inside a header on every request, and the registered claims are used where
// one exists — validation of exp, iat and iss is then the library's job rather than ours.
type accessClaims struct {
	UserID      string `json:"uid"`
	WorkspaceID string `json:"wid"`
	Role        string `json:"role"`
	jwt.RegisteredClaims
}

// IssueAccessToken signs c with HMAC-SHA256 and an expiry of ttl from its issue time.
//
// ttl is authoritative over any ExpiresAt already on c: the lifetime of an access token is
// a policy decision belonging to the issuing endpoint, not something a caller assembling a
// Claims value should be able to extend by filling in a field.
func IssueAccessToken(secret []byte, c Claims, ttl time.Duration) (string, error) {
	// An empty secret would produce tokens anyone can forge. It is a misconfigured
	// deployment rather than bad user input, so it fails loudly and says nothing to the
	// caller beyond "internal".
	if len(secret) == 0 {
		return "", platform.Internal(errors.New("auth: access token secret is empty"))
	}

	issued := c.IssuedAt
	if issued.IsZero() {
		issued = time.Now()
	}

	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims{
		UserID:      c.UserID.String(),
		WorkspaceID: c.WorkspaceID.String(),
		Role:        c.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Subject:   c.AccountID.String(),
			IssuedAt:  jwt.NewNumericDate(issued),
			ExpiresAt: jwt.NewNumericDate(issued.Add(ttl)),
		},
	})

	signed, err := tok.SignedString(secret)
	if err != nil {
		return "", platform.Internal(err)
	}
	return signed, nil
}

// ParseAccessToken verifies tok and returns its claims, or an unauthenticated error.
//
// Every failure — bad signature, wrong algorithm, expired, wrong issuer, unparseable id —
// comes back as platform.Unauthorized with nothing distinguishing it. Telling a caller
// which part of their token was wrong is a free oracle for someone assembling one.
func ParseAccessToken(secret []byte, tok string) (Claims, error) {
	if len(secret) == 0 {
		return Claims{}, platform.Internal(errors.New("auth: access token secret is empty"))
	}

	parsed, err := jwt.ParseWithClaims(tok, &accessClaims{},
		func(t *jwt.Token) (any, error) {
			// The algorithm-confusion check, and the reason it is written out rather than
			// left to the library's defaults. A JWT names its own algorithm in an
			// unauthenticated header, so a parser that trusts that header lets the attacker
			// choose how their token is verified: "none" makes the signature optional, and
			// asking for HS256 on a service that expects RS256 makes the public key — which
			// is public — the HMAC secret. Pinning the family here, and the exact algorithm
			// via WithValidMethods below, means the header is only ever consulted after we
			// have already decided what we will accept.
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("auth: unexpected signing method %v", t.Header["alg"])
			}
			return secret, nil
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(Issuer),
		// A token without an exp would never expire. Requiring it turns a claims-forging
		// omission into a rejection instead of an immortal session.
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return Claims{}, platform.Unauthorized("invalid or expired access token")
	}

	claims, ok := parsed.Claims.(*accessClaims)
	if !ok || !parsed.Valid {
		return Claims{}, platform.Unauthorized("invalid or expired access token")
	}
	if claims.ExpiresAt == nil || claims.IssuedAt == nil {
		return Claims{}, platform.Unauthorized("invalid or expired access token")
	}

	accountID, err := uuid.Parse(claims.Subject)
	if err != nil {
		return Claims{}, platform.Unauthorized("invalid or expired access token")
	}
	userID, err := uuid.Parse(claims.UserID)
	if err != nil {
		return Claims{}, platform.Unauthorized("invalid or expired access token")
	}
	workspaceID, err := uuid.Parse(claims.WorkspaceID)
	if err != nil {
		return Claims{}, platform.Unauthorized("invalid or expired access token")
	}

	return Claims{
		AccountID:   accountID,
		UserID:      userID,
		WorkspaceID: workspaceID,
		Role:        claims.Role,
		ExpiresAt:   claims.ExpiresAt.Time,
		IssuedAt:    claims.IssuedAt.Time,
	}, nil
}
