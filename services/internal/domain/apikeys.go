package domain

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/auth"
	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Personal API keys.
//
// One rule decides everything in this file, and it is the rule migration 000016 states: a
// key acts as its owner and never more. It has no role, no team and no workspace of its
// own — AuthenticateApiKey builds the principal from the key's *user*, exactly as a session
// would, and the key's scopes then narrow it. A key that could widen anything would be a
// privilege-escalation path that no later role change closes, because nobody reviews a
// credential they cannot see.
//
// The plaintext token exists in the response to CreateApiKey and nowhere else. Only its
// SHA-256 is stored, model.APIKey deliberately has no token field, nothing here reaches the
// change stream, and nothing in this package logs one. A leaked database, a leaked replica
// and a leaked log line therefore all yield metadata rather than working credentials.

const (
	// apiKeyTokenPrefix marks a Polaris key wherever it turns up: a commit, a CI log, a
	// pasted support message. It is what makes automated secret scanning possible at all —
	// no scanner can match "forty-three characters of base64", and a leaked key nobody can
	// recognise is a leaked key nobody revokes.
	apiKeyTokenPrefix = "plk_"

	// 256 bits, the same as a session token: guessing one is not a strategy.
	apiKeyEntropyBytes = 32

	// The stored prefix is that marker plus the first eight characters of the secret, which
	// is enough for a listing to say which key is which. It reveals 48 of the 256 bits and
	// leaves 208 — a prefix is a label, not a shortcut to the token.
	apiKeyPrefixLength = len(apiKeyTokenPrefix) + 8

	// Long enough for "CI — deploy bot (staging)", short enough that the column is not a
	// place to store a document.
	maxAPIKeyNameLength = 128
)

// API key scopes.
//
// Coarse on purpose, for the reason authz gives for its actions: one per thing somebody
// would recognise when answering "what can this integration do", not one per resolver. A
// vocabulary fine enough to need a reference page is one nobody sets correctly, and a scope
// set wrongly is either a broken integration or a key with more reach than intended.
//
// There is deliberately no scope that grants anything its owner does not already have.
const (
	// APIKeyScopeRead permits every read its owner could perform.
	APIKeyScopeRead = "read"
	// APIKeyScopeWrite permits the mutations too. It implies APIKeyScopeRead, expanded at
	// creation rather than interpreted at check time, so the listing shows exactly what the
	// key can do and no future check has to remember the implication.
	APIKeyScopeWrite = "write"
	// APIKeyScopeAdmin is an unrestricted key — the same reach as its owner's session and
	// nothing beyond it. authz.Principal.HasScope already treats it as the wildcard.
	APIKeyScopeAdmin = "admin"
)

var apiKeyScopes = map[string]bool{
	APIKeyScopeRead:  true,
	APIKeyScopeWrite: true,
	APIKeyScopeAdmin: true,
}

type CreateApiKeyInput struct {
	Name string

	// Scopes narrow the key. Empty means everything its owner can do, which is what
	// authz.Principal.HasScope answers for an empty set.
	Scopes []string

	// ExpiresAt is optional. A key that never expires is a credential nobody revisits, but
	// forcing an expiry on every key would break the unattended integrations keys exist
	// for, so the choice stays with the person making it.
	ExpiresAt *time.Time
}

// CreateApiKey mints a key and returns its plaintext token exactly once.
//
// The token is the second return value rather than a field on the model, and that placement
// is the design: model.APIKey is written into API responses and would be written into the
// change stream if keys were ever replicated, so a token field there would be one careless
// serialisation away from being permanent.
func (s *Service) CreateApiKey(
	ctx context.Context, p *authz.Principal, in CreateApiKeyInput,
) (model.APIKey, string, int64, error) {
	// Guests are excluded by authz: a key acts as its owner and outlives the session, which
	// is the opposite of what a guest's access is meant to be.
	if !authz.Can(p, authz.ActionAPIKeyManage) {
		return model.APIKey{}, "", 0, platform.Forbidden("guests cannot create API keys")
	}

	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		// api_key_name_not_blank would catch this too, but a CHECK violation reaches the
		// user as an internal error. The database is the backstop; the message is ours.
		return model.APIKey{}, "", 0, platform.Validation("name",
			"a key needs a name — this is the list you will be reading in a year deciding what to revoke")
	}
	if len(in.Name) > maxAPIKeyNameLength {
		return model.APIKey{}, "", 0, platform.Validation("name", "name is too long")
	}

	scopes, err := normaliseAPIKeyScopes(in.Scopes)
	if err != nil {
		return model.APIKey{}, "", 0, err
	}
	if in.ExpiresAt != nil && !in.ExpiresAt.After(time.Now()) {
		// A key born expired authenticates nothing and looks fine in the listing, which is
		// an hour of somebody's afternoon.
		return model.APIKey{}, "", 0, platform.Validation("expiresAt", "an expiry date must be in the future")
	}

	token, prefix, hash, err := newAPIKeyToken()
	if err != nil {
		return model.APIKey{}, "", 0, err
	}

	var out model.APIKey
	var version int64
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		ent, err := entitlementSetFor(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}
		// Allow rather than Has: minting a key is a write, so a lapsed plan refuses it while
		// the existing keys keep working and keep being listable.
		if err := ent.Allow(entitlement.FeatureAPIKeys); err != nil {
			return err
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateAPIKey(ctx, store.CreateAPIKeyParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			UserID:      p.UserID,
			Name:        in.Name,
			TokenHash:   hash,
			Prefix:      prefix,
			Scopes:      scopes,
			ExpiresAt:   in.ExpiresAt,
		})
		if err != nil {
			if store.IsCheckViolation(err) {
				// Only api_key_name_not_blank can fire on this insert, and it can only fire
				// on a name Go's Unicode-aware trim kept and Postgres's btrim did not.
				return platform.Validation("name", "a key needs a name")
			}
			return platform.Internal(err)
		}
		out = toAPIKeyCreated(row)

		// Deliberately no Emit, and this is the one file in the domain layer where that is
		// the right answer. Emit exists so clients learn about entities they replicate, and
		// api_key is not replicated (see model.APIKey): keys are read on one settings screen,
		// rarely, so putting a credential's metadata in every device's local store buys
		// nothing. The audit trail for "who minted a key" belongs to the audit log, which is
		// a separate feature with its own storage — it is not a reason to hand every device
		// a copy.
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	if err != nil {
		// No half-created key, and above all no token on an error path: a caller that logged
		// the error would otherwise be logging a live credential.
		return model.APIKey{}, "", 0, err
	}
	return out, token, version, nil
}

// RevokeApiKey retires one of the caller's own keys.
//
// No role check, on purpose. Revocation is only ever of your own key, and somebody demoted
// to guest after minting one must still be able to retire it — refusing would leave a live
// credential its owner cannot reach. Nor is it entitlement-gated: a plan that stopped
// permitting new keys must not also strand the existing ones.
func (s *Service) RevokeApiKey(ctx context.Context, p *authz.Principal, id uuid.UUID) (uuid.UUID, int64, error) {
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		// Scoped to the caller by the query itself, so somebody else's key id answers
		// exactly as an invented one does — not-found rather than forbidden. Otherwise the
		// id of a colleague's key becomes a way to confirm it exists.
		if _, err := q.RevokeAPIKey(ctx, store.RevokeAPIKeyParams{ID: id, UserID: p.UserID}); err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("api key")
			}
			return platform.Internal(err)
		}

		var err error
		version, err = syncWatermark(ctx, q, p.WorkspaceID)
		return err
	})
	if err != nil {
		return uuid.Nil, 0, err
	}
	return id, version, nil
}

// ListApiKeys returns the caller's own keys, and only ever those.
//
// There is no admin variant and no user argument. A workspace-wide listing of everybody's
// keys is a credential inventory — every long-lived access path in the organisation on one
// screen — and nothing in the product needs one: revoking somebody's access is what
// RemoveUser does, which takes their keys with them without anybody reading the list.
func (s *Service) ListApiKeys(ctx context.Context, p *authz.Principal) ([]model.APIKey, error) {
	rows, err := s.db.Queries().ListAPIKeysForUser(ctx, p.UserID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.APIKey, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAPIKeyListed(r))
	}
	return out, nil
}

// AuthenticateApiKey resolves a bearer token to the principal its owner would have had.
//
// Every failure fails closed and fails identically. A malformed token, an unknown one, a
// revoked one, an expired one, and a key whose owner has been suspended or removed are all
// "invalid API key": distinguishing them tells somebody probing with a stolen key whether
// it is worth trying again on Monday.
// IsAPIKeyToken reports whether a bearer token is a Polaris API key rather than a session
// JWT.
//
// The HTTP layer has to know before it can choose an authenticator, and it must choose
// rather than try both: running Tokens.Parse on a key and then falling through on failure
// would answer "invalid or expired token" to a revoked key — which sends its holder to the
// refresh flow for a credential that has no refresh flow — and would make every malformed
// token cost a database read.
//
// A prefix rather than a length or a shape check, for the reason the prefix exists at all:
// it is what makes a leaked key recognisable to a secret scanner, and reusing it here means
// there is one answer to "is this a key" instead of two that can disagree.
func IsAPIKeyToken(token string) bool {
	return strings.HasPrefix(token, apiKeyTokenPrefix)
}

func (s *Service) AuthenticateApiKey(ctx context.Context, token string) (*authz.Principal, error) {
	invalid := func() error { return platform.Unauthorized("invalid API key") }

	if token == "" {
		return nil, invalid()
	}
	q := s.db.Queries()

	// Looked up BY hash rather than fetched and then compared.
	//
	// api_key_token_hash_key makes this one indexed read, and the comparison happens inside
	// the index over a full-entropy digest — no candidate row ever reaches Go, so there is
	// no byte-by-byte comparison whose duration could reveal how much of a guessed token
	// was right. auth.ConstantTimeEqualHash exists for the paths that must compare a digest
	// they already hold; having nothing to compare is strictly better than comparing
	// carefully.
	//
	// Revocation and expiry are filtered by the query, so neither can be forgotten here or
	// by the next caller that needs to authenticate one of these.
	key, err := q.GetAPIKeyByTokenHash(ctx, auth.HashToken(token))
	if err != nil {
		if store.IsNotFound(err) {
			return nil, invalid()
		}
		return nil, platform.Internal(err)
	}

	user, err := q.GetUser(ctx, key.UserID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, invalid()
		}
		return nil, platform.Internal(err)
	}
	switch {
	case user.WorkspaceID != key.WorkspaceID:
		// Unreachable through this package — the key is written with its owner's workspace —
		// and checked anyway, because the one thing a key must never do is act in a
		// workspace its owner is not in.
		return nil, invalid()
	case user.ArchivedAt != nil:
		// Removed from the workspace. RemoveUser also revokes their keys and suspends them,
		// so this is the third of three doors; a credential outliving the account it belongs
		// to is exactly the failure this file exists to prevent.
		return nil, invalid()
	case user.Status != "active":
		return nil, invalid()
	case user.AccountID == nil:
		// An app user is an integration's identity and has no login at all. A personal key
		// on one could not be resolved to a session's worth of permissions, and inventing
		// them here would be this file's own privilege-escalation path.
		return nil, invalid()
	}

	// The principal comes from the owner, through the one function that builds them.
	// Reimplementing the team resolution here is how an API request ends up seeing a
	// different set of teams from the same person's browser.
	p, err := s.ResolvePrincipal(ctx, *user.AccountID, key.WorkspaceID)
	if err != nil {
		// Everything ResolvePrincipal refuses — suspended, no longer a member of this
		// workspace — is the same 401 as a bad token. An internal failure passes through
		// unchanged: answering "invalid API key" to a database outage sends whoever is
		// holding the pager to the wrong system.
		if platform.CodeOf(err) == platform.CodeInternal {
			return nil, err
		}
		return nil, invalid()
	}

	// Assigned after the principal is built, never used to build it. The key contributes no
	// role, no team and no workspace; everything it may do came from its owner above, and
	// the scopes can only take things away. An empty set takes nothing away, which is what
	// makes an unscoped key exactly its owner and never more.
	p.Scopes = key.Scopes

	// Self-limiting to one write a minute by the query's own predicate, so authenticating a
	// busy key stays a read. The error is dropped on purpose: last_used_at answers "is this
	// key still in use before I revoke it", and failing a request because a convenience
	// column could not be written would be a worse outage than the missing timestamp.
	_ = q.TouchAPIKeyLastUsed(ctx, key.ID)

	return p, nil
}

// newAPIKeyToken mints a token, returning the plaintext, the prefix to store beside it and
// the digest that is all the database ever sees.
func newAPIKeyToken() (token, prefix string, hash []byte, err error) {
	buf := make([]byte, apiKeyEntropyBytes)
	// crypto/rand, never math/rand. math/rand is seeded from a value an attacker can often
	// pin down and its output is reproducible from any observed sample, so a key minted from
	// it is guessable from another key minted seconds earlier — and nothing about the
	// resulting token would look wrong.
	if _, err := rand.Read(buf); err != nil {
		return "", "", nil, platform.Internal(err)
	}
	// base64url unpadded: safe in a header, a URL and a config file without further
	// escaping, and free of the '=' that trips up naive splitting.
	token = apiKeyTokenPrefix + base64.RawURLEncoding.EncodeToString(buf)
	return token, token[:apiKeyPrefixLength], auth.HashToken(token), nil
}

// normaliseAPIKeyScopes validates the requested scopes and expands the implications.
//
// Unknown scopes are rejected rather than dropped. Dropping fails closed — an unrecognised
// scope grants nothing — but it produces a key that mysteriously cannot do the one thing it
// was made for, and the cause is a typo nobody sees again. A nil slice becomes an empty one
// because scopes is NOT NULL and a nil []string encodes as SQL NULL, which is the same trap
// invite.team_ids has.
func normaliseAPIKeyScopes(requested []string) ([]string, error) {
	out := make([]string, 0, len(requested))
	seen := make(map[string]bool, len(requested))

	add := func(scope string) {
		if !seen[scope] {
			seen[scope] = true
			out = append(out, scope)
		}
	}

	for _, raw := range requested {
		scope := strings.TrimSpace(raw)
		if !apiKeyScopes[scope] {
			return nil, platform.Validation("scopes", "unknown scope: use read, write or admin")
		}
		add(scope)
		if scope == APIKeyScopeWrite {
			add(APIKeyScopeRead)
		}
	}
	return out, nil
}

// The store returns a different row struct per query — there is no api_key table struct,
// because token_hash appears in no SELECT list — so the conversion is written once per
// shape. They live here rather than in convert.go because they are query-specific shapes
// that only this file has any business knowing about.

func toAPIKeyCreated(r store.CreateAPIKeyRow) model.APIKey {
	return model.APIKey{
		ID:          r.ID,
		WorkspaceID: r.WorkspaceID,
		UserID:      r.UserID,
		Name:        r.Name,
		Prefix:      r.Prefix,
		Scopes:      r.Scopes,
		LastUsedAt:  r.LastUsedAt,
		ExpiresAt:   r.ExpiresAt,
		RevokedAt:   r.RevokedAt,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}

func toAPIKeyListed(r store.ListAPIKeysForUserRow) model.APIKey {
	return model.APIKey{
		ID:          r.ID,
		WorkspaceID: r.WorkspaceID,
		UserID:      r.UserID,
		Name:        r.Name,
		Prefix:      r.Prefix,
		Scopes:      r.Scopes,
		LastUsedAt:  r.LastUsedAt,
		ExpiresAt:   r.ExpiresAt,
		RevokedAt:   r.RevokedAt,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}
