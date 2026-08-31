package domain

import (
	"context"
	"net/netip"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/auth/oidc"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Sign in with Apple, and with Google.
//
// The token has already been verified by the time anything here runs — signature, issuer,
// audience, expiry, nonce — so this file is about identity rather than cryptography: which
// account do these claims belong to, and may a new one be created for them.

// SocialSignInInput is one verified assertion from a provider.
type SocialSignInInput struct {
	// Provider is "google" or "apple", as the route named it.
	Provider string
	Claims   oidc.Claims

	// DisplayName is what the client offers for a brand-new account. Apple sends the
	// person's name once, on the very first authorisation and never again, so the client
	// has to pass it through on that one call or it is gone for good.
	DisplayName string

	UserAgent string
	IP        *netip.Addr

	// AllowOpenSignup mirrors RegisterInput: the handler reads POLARIS_REGISTRATION_MODE
	// and the domain does not read config.
	AllowOpenSignup bool
	// InviteToken redeems an invitation on the same call, exactly as Register does.
	InviteToken string
}

// SocialSignInResult says what happened, because the caller renders different things for
// a returning user and a brand-new account.
type SocialSignInResult struct {
	AccountID uuid.UUID
	Session   Session
	// Created is true when this call made the account.
	Created bool
	// Linked is true when an existing password account gained this provider.
	Linked bool
}

// credentialKind is how the provider is spelled in account_credential.kind.
func credentialKind(provider string) (string, error) {
	switch provider {
	case "google":
		return "oauth_google", nil
	case "apple":
		return "oauth_apple", nil
	default:
		return "", platform.Validation("provider", "unknown sign-in provider")
	}
}

// SignInWithSocial resolves a verified assertion to a session, creating or linking an
// account when it has to.
//
// The resolution order is subject, then verified email, then create — and the order is the
// security property rather than a convenience:
//
//  1. **The provider's subject.** This is the identity. It is stable across an address
//     change at the provider, and it is the only field an attacker cannot influence by
//     controlling an inbox.
//
//  2. **A verified email address.** Somebody who signed up with a password and later clicks
//     "Continue with Google" is the same person, and making them two accounts is the kind of
//     thing that reads as data loss. `EmailVerified` is load-bearing: linking on an
//     unverified address would let anyone who can get a provider account claiming
//     ada@corp.com take over Ada's Polaris account without ever seeing her mail.
//
//  3. **A new account**, if registration admits one. No password is set — the column is
//     nullable and this is the case it was nullable for — so the account can only be
//     entered through the provider until its owner sets one.
func (s *Service) SignInWithSocial(
	ctx context.Context, in SocialSignInInput,
) (SocialSignInResult, error) {
	kind, err := credentialKind(in.Provider)
	if err != nil {
		return SocialSignInResult{}, err
	}
	if in.Claims.Subject == "" {
		return SocialSignInResult{}, platform.Unauthorized("that sign-in could not be verified")
	}

	email, emailErr := normaliseEmail(in.Claims.Email)
	// An assertion with no usable address can still sign in an account it is already linked
	// to; it just cannot create or find one. Apple omits the address on every authorisation
	// after the first, which is exactly that case.
	hasEmail := emailErr == nil && in.Claims.EmailVerified

	var out SocialSignInResult
	err = func() error {
		tx, err := s.db.Pool().Begin(ctx)
		if err != nil {
			return platform.Internal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()
		q := store.New(tx)

		// 1. Already linked.
		existing, err := q.GetAccountCredential(ctx, store.GetAccountCredentialParams{
			Kind: kind, ExternalID: in.Claims.Subject,
		})
		switch {
		case err == nil:
			out.AccountID = existing.AccountID
			if err := q.TouchAccountCredential(ctx, existing.ID); err != nil {
				return platform.Internal(err)
			}
		case store.IsNotFound(err):
			accountID, created, err := s.accountForAssertion(ctx, tx, q, in, kind, email, hasEmail)
			if err != nil {
				return err
			}
			out.AccountID = accountID
			out.Created = created
			out.Linked = !created
		default:
			return platform.Internal(err)
		}

		// The account may have been soft-deleted since it was linked. GetAccount filters
		// those out, so this is the check that a credential cannot outlive its account.
		if _, err := q.GetAccount(ctx, out.AccountID); err != nil {
			if store.IsNotFound(err) {
				return platform.Unauthorized("that sign-in could not be verified")
			}
			return platform.Internal(err)
		}
		if err := q.MarkAccountLogin(ctx, out.AccountID); err != nil {
			return platform.Internal(err)
		}

		session, err := s.issueSession(ctx, q, out.AccountID, in.UserAgent, in.IP)
		if err != nil {
			return err
		}
		out.Session = session

		if err := tx.Commit(ctx); err != nil {
			return platform.Internal(err)
		}
		return nil
	}()
	if err != nil {
		return SocialSignInResult{}, err
	}
	return out, nil
}

// accountForAssertion finds the account a first-time assertion belongs to, or makes one,
// and links the credential either way.
func (s *Service) accountForAssertion(
	ctx context.Context, tx store.DBTX, q *store.Queries,
	in SocialSignInInput, kind, email string, hasEmail bool,
) (uuid.UUID, bool, error) {
	if !hasEmail {
		// Nothing to match on and nothing to create an account with. This is a first-time
		// assertion carrying only a subject — which for Apple means the client dropped the
		// address on the one authorisation that had it.
		return uuid.Nil, false, platform.Validation("email",
			"that sign-in did not include a verified email address")
	}

	if account, err := q.GetAccountByEmail(ctx, email); err == nil {
		if err := s.linkCredential(ctx, q, account.ID, kind, in.Claims); err != nil {
			return uuid.Nil, false, err
		}
		// The provider has just proved control of the address, so an account that signed up
		// with a password and never confirmed its mail is confirmed now.
		if err := q.VerifyAccountEmail(ctx, account.ID); err != nil {
			return uuid.Nil, false, platform.Internal(err)
		}
		return account.ID, false, nil
	} else if !store.IsNotFound(err) {
		return uuid.Nil, false, platform.Internal(err)
	}

	// Same admission policy as a password registration, and for the same reasons — an
	// invitation, open signup, or the bootstrap account on an empty install. Social sign-in
	// must not be a way around a server's registration mode.
	inv, err := s.admitRegistration(ctx, tx, email, RegisterInput{
		AllowOpenSignup: in.AllowOpenSignup,
		InviteToken:     in.InviteToken,
		DisplayName:     in.DisplayName,
	}, true)
	if err != nil {
		return uuid.Nil, false, err
	}

	id, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, false, platform.Internal(err)
	}
	now := time.Now()
	account, err := q.CreateAccount(ctx, store.CreateAccountParams{
		ID:    id,
		Email: email,
		// No password. The column is nullable and this is what it is nullable for: an
		// account that exists only behind a provider. Setting a random one would leave a
		// hash nobody can produce and a "forgot password" flow that appears to work.
		PasswordHash: nil,
		// The provider verified the address; recording that here is what stops the product
		// asking for a confirmation it already has.
		EmailVerifiedAt: &now,
	})
	if err != nil {
		if store.IsUniqueViolation(err, "account_email_lower_key") {
			// Lost a race with another sign-up for the same address. The same wording the
			// password path uses, so neither can be used to enumerate addresses.
			return uuid.Nil, false, platform.Validation("email", "that email address cannot be used")
		}
		return uuid.Nil, false, platform.Internal(err)
	}

	if err := s.linkCredential(ctx, q, account.ID, kind, in.Claims); err != nil {
		return uuid.Nil, false, err
	}
	if inv != nil {
		if _, err := s.applyInvite(ctx, q, *inv, account.ID, email, in.DisplayName); err != nil {
			return uuid.Nil, false, err
		}
	}
	return account.ID, true, nil
}

func (s *Service) linkCredential(
	ctx context.Context, q *store.Queries, accountID uuid.UUID, kind string, claims oidc.Claims,
) error {
	id, err := uuid.NewV7()
	if err != nil {
		return platform.Internal(err)
	}
	// The label is what Settings → Sessions shows beside the credential. The address the
	// provider asserted, not the account's, because they can differ — an Apple relay address
	// is the obvious case, and "which Apple account is this" is the question the row answers.
	var label *string
	if trimmed := strings.TrimSpace(claims.Email); trimmed != "" {
		label = &trimmed
	}
	if _, err := q.CreateAccountCredential(ctx, store.CreateAccountCredentialParams{
		ID: id, AccountID: accountID, Kind: kind, ExternalID: claims.Subject, Label: label,
	}); err != nil {
		if store.IsUniqueViolation(err, "account_credential_provider_key") {
			// Two concurrent first sign-ins for the same subject. The other one won and the
			// credential now exists; a retry resolves through the linked path.
			return platform.Conflict("that sign-in is already being linked; try again")
		}
		return platform.Internal(err)
	}
	return nil
}
