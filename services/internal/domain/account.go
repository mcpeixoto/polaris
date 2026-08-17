package domain

import (
	"context"
	"net/netip"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/auth"
	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Session is a freshly minted login. The refresh token's plaintext appears here and
// nowhere else — only its hash is stored, so a database leak cannot be replayed as a
// live session.
type Session struct {
	SessionID    uuid.UUID
	AccountID    uuid.UUID
	RefreshToken string
	ExpiresAt    time.Time
}

type RegisterInput struct {
	Email     string
	Password  string
	UserAgent string
	IP        *netip.Addr
}

// Register creates an account. It does NOT create a workspace: the caller decides
// whether the new account is starting one or accepting an invitation to an existing one,
// and conflating the two produces an orphan workspace for every invited user.
func (s *Service) Register(ctx context.Context, in RegisterInput) (uuid.UUID, Session, error) {
	email, err := normaliseEmail(in.Email)
	if err != nil {
		return uuid.Nil, Session{}, err
	}
	if err := validatePasswordStrength(in.Password); err != nil {
		return uuid.Nil, Session{}, err
	}

	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		return uuid.Nil, Session{}, err
	}

	var (
		accountID uuid.UUID
		session   Session
	)
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		acct, err := q.CreateAccount(ctx, store.CreateAccountParams{
			ID:           id,
			Email:        email,
			PasswordHash: &hash,
		})
		if err != nil {
			if store.IsUniqueViolation(err, "account_email_lower_key") {
				// Deliberately the same wording the login path uses for a wrong password,
				// so signup cannot be used to enumerate which addresses have accounts.
				return platform.Validation("email", "that email address cannot be used")
			}
			return platform.Internal(err)
		}
		accountID = acct.ID

		session, err = s.issueSession(ctx, q, acct.ID, in.UserAgent, in.IP)
		return err
	})
	return accountID, session, err
}

type LoginInput struct {
	Email     string
	Password  string
	UserAgent string
	IP        *netip.Addr
}

// Login verifies a password and opens a session.
func (s *Service) Login(ctx context.Context, in LoginInput) (uuid.UUID, Session, error) {
	email, err := normaliseEmail(in.Email)
	if err != nil {
		return uuid.Nil, Session{}, platform.Unauthorized("incorrect email or password")
	}

	acct, err := s.db.Queries().GetAccountByEmail(ctx, email)
	if err != nil {
		if store.IsNotFound(err) {
			// Hash anyway. Returning immediately on an unknown address makes the two
			// cases distinguishable by response time, which is a working account
			// enumeration oracle.
			_, _ = auth.HashPassword(in.Password)
			return uuid.Nil, Session{}, platform.Unauthorized("incorrect email or password")
		}
		return uuid.Nil, Session{}, platform.Internal(err)
	}
	if acct.PasswordHash == nil {
		return uuid.Nil, Session{}, platform.Unauthorized("incorrect email or password")
	}

	ok, err := auth.VerifyPassword(*acct.PasswordHash, in.Password)
	if err != nil || !ok {
		return uuid.Nil, Session{}, platform.Unauthorized("incorrect email or password")
	}

	var session Session
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		// A successful login is the only moment the plaintext password is available, so
		// it is the only moment an old hash can be upgraded to current cost parameters
		// without forcing a reset.
		if auth.NeedsRehash(*acct.PasswordHash) {
			if newHash, err := auth.HashPassword(in.Password); err == nil {
				_ = q.SetAccountPassword(ctx, store.SetAccountPasswordParams{
					ID: acct.ID, PasswordHash: &newHash,
				})
			}
		}
		if err := q.MarkAccountLogin(ctx, acct.ID); err != nil {
			return platform.Internal(err)
		}
		session, err = s.issueSession(ctx, q, acct.ID, in.UserAgent, in.IP)
		return err
	})
	return acct.ID, session, err
}

// RefreshSession exchanges a refresh token for a new one and extends the session.
//
// The old token is revoked in the same transaction (rotation). A stolen refresh token is
// therefore usable at most once, and the legitimate client's next refresh fails loudly
// instead of the theft going unnoticed.
func (s *Service) RefreshSession(ctx context.Context, refreshToken string) (uuid.UUID, Session, error) {
	hash := auth.HashToken(refreshToken)

	var (
		accountID uuid.UUID
		session   Session
	)
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetSessionByTokenHash(ctx, hash)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.Unauthorized("session expired, please sign in again")
			}
			return platform.Internal(err)
		}
		accountID = existing.AccountID

		if err := q.RevokeSession(ctx, existing.ID); err != nil {
			return platform.Internal(err)
		}
		var ua string
		if existing.UserAgent != nil {
			ua = *existing.UserAgent
		}
		session, err = s.issueSession(ctx, q, existing.AccountID, ua, existing.Ip)
		return err
	})
	return accountID, session, err
}

func (s *Service) RevokeSession(ctx context.Context, refreshToken string) error {
	hash := auth.HashToken(refreshToken)
	return s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		existing, err := q.GetSessionByTokenHash(ctx, hash)
		if err != nil {
			if store.IsNotFound(err) {
				// Signing out of an already-dead session is a success, not an error.
				return nil
			}
			return platform.Internal(err)
		}
		if err := q.RevokeSession(ctx, existing.ID); err != nil {
			return platform.Internal(err)
		}
		return nil
	})
}

func (s *Service) RevokeAllSessions(ctx context.Context, accountID uuid.UUID) error {
	if err := s.db.Queries().RevokeAllSessionsForAccount(ctx, accountID); err != nil {
		return platform.Internal(err)
	}
	return nil
}

func (s *Service) issueSession(
	ctx context.Context, q *store.Queries, accountID uuid.UUID, userAgent string, ip *netip.Addr,
) (Session, error) {
	plain, hash, err := auth.NewOpaqueToken()
	if err != nil {
		return Session{}, platform.Internal(err)
	}
	id, err := uuid.NewV7()
	if err != nil {
		return Session{}, platform.Internal(err)
	}

	expires := time.Now().Add(s.refreshTTL())
	var ua *string
	if userAgent != "" {
		trimmed := truncate(userAgent, 512)
		ua = &trimmed
	}

	row, err := q.CreateSession(ctx, store.CreateSessionParams{
		ID:        id,
		AccountID: accountID,
		TokenHash: hash,
		UserAgent: ua,
		Ip:        ip,
		ExpiresAt: expires,
	})
	if err != nil {
		return Session{}, platform.Internal(err)
	}

	return Session{
		SessionID:    row.ID,
		AccountID:    accountID,
		RefreshToken: plain,
		ExpiresAt:    row.ExpiresAt,
	}, nil
}

// SessionTTL is how long a refresh token lives. Thirty days matches the longest plausible
// "laptop in a drawer" gap without letting an abandoned session live indefinitely.
const SessionTTL = 30 * 24 * time.Hour

func (s *Service) refreshTTL() time.Duration { return SessionTTL }

// --- invitations ---------------------------------------------------------------

type InviteInput struct {
	Email   string
	Role    string
	TeamIDs []uuid.UUID
}

// CreatedInvite carries the token exactly once, for the email that is about to go out.
type CreatedInvite struct {
	ID    uuid.UUID
	Email string
	Role  string
	Token string
	// URL the recipient follows. Built from the configured public URL by the caller.
	ExpiresAt time.Time
}

const inviteTTL = 14 * 24 * time.Hour

func (s *Service) InviteToWorkspace(ctx context.Context, p *authz.Principal, in InviteInput) (CreatedInvite, error) {
	if !authz.Can(p, authz.ActionMemberInvite) {
		return CreatedInvite{}, platform.Forbidden("only admins can invite people")
	}
	email, err := normaliseEmail(in.Email)
	if err != nil {
		return CreatedInvite{}, err
	}
	if in.Role == "" {
		in.Role = string(authz.RoleMember)
	}
	switch authz.Role(in.Role) {
	case authz.RoleAdmin, authz.RoleMember, authz.RoleGuest:
	default:
		return CreatedInvite{}, platform.Validation("role", "unknown role")
	}
	if authz.Role(in.Role) == authz.RoleGuest && len(in.TeamIDs) == 0 {
		// A guest with no team can see nothing at all — an invitation to an empty room.
		return CreatedInvite{}, platform.Validation("teamIds", "a guest must be invited to at least one team")
	}
	for _, id := range in.TeamIDs {
		if !p.Teams.Has(id) {
			return CreatedInvite{}, platform.Forbidden("you cannot invite people to a team you are not in")
		}
	}

	// A nil slice encodes as SQL NULL, not as an empty array, and invite.team_ids is NOT
	// NULL. Normalising here rather than at the call site means no caller has to know
	// that, and the same trap does not have to be rediscovered for the next array column.
	if in.TeamIDs == nil {
		in.TeamIDs = []uuid.UUID{}
	}

	plain, hash, err := auth.NewOpaqueToken()
	if err != nil {
		return CreatedInvite{}, platform.Internal(err)
	}

	var out CreatedInvite
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		// Re-inviting replaces rather than accumulates, matching the partial unique index.
		if err := q.RevokePendingInvitesForEmail(ctx, store.RevokePendingInvitesForEmailParams{
			WorkspaceID: p.WorkspaceID, Email: email,
		}); err != nil {
			return platform.Internal(err)
		}

		id, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateInvite(ctx, store.CreateInviteParams{
			ID:          id,
			WorkspaceID: p.WorkspaceID,
			Email:       email,
			Role:        in.Role,
			TokenHash:   hash,
			InvitedBy:   &p.UserID,
			TeamIds:     in.TeamIDs,
			ExpiresAt:   time.Now().Add(inviteTTL),
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = CreatedInvite{
			ID: row.ID, Email: row.Email, Role: row.Role,
			Token: plain, ExpiresAt: row.ExpiresAt,
		}
		return nil
	})
	return out, err
}

// AcceptInvite turns an invitation into workspace membership for an existing account.
func (s *Service) AcceptInvite(ctx context.Context, accountID uuid.UUID, token, displayName string) (model.User, uuid.UUID, error) {
	hash := auth.HashToken(token)

	var (
		user        model.User
		workspaceID uuid.UUID
	)
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		inv, err := q.GetInviteByTokenHash(ctx, hash)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.Validation("token", "this invitation is no longer valid")
			}
			return platform.Internal(err)
		}
		workspaceID = inv.WorkspaceID

		acct, err := q.GetAccount(ctx, accountID)
		if err != nil {
			return platform.Internal(err)
		}
		// The invitation is to a specific address. Letting any signed-in account redeem a
		// leaked link would make a forwarded email a workspace entry point.
		if !strings.EqualFold(acct.Email, inv.Email) {
			return platform.Forbidden("this invitation was sent to a different email address")
		}

		// Already a member: accept idempotently rather than erroring, because the common
		// cause is somebody clicking the link twice.
		if existing, err := q.GetUserByAccountAndWorkspace(ctx, store.GetUserByAccountAndWorkspaceParams{
			AccountID: &accountID, WorkspaceID: inv.WorkspaceID,
		}); err == nil {
			user = toUser(existing)
			return q.AcceptInvite(ctx, store.AcceptInviteParams{ID: inv.ID, AcceptedBy: &existing.ID})
		} else if !store.IsNotFound(err) {
			return platform.Internal(err)
		}

		if displayName == "" {
			displayName = strings.SplitN(acct.Email, "@", 2)[0]
		}
		userID, err := uuid.NewV7()
		if err != nil {
			return platform.Internal(err)
		}
		row, err := q.CreateUser(ctx, store.CreateUserParams{
			ID:          userID,
			WorkspaceID: inv.WorkspaceID,
			AccountID:   &accountID,
			Name:        displayName,
			DisplayName: displayName,
			Timezone:    "UTC",
			Role:        inv.Role,
			Kind:        "human",
		})
		if err != nil {
			return platform.Internal(err)
		}
		user = toUser(row)

		changes := []Change{{
			EntityType: "user", EntityID: userID, Op: OpUpsert,
			Scope: authz.WorkspaceScope(), Payload: user,
		}}
		for _, teamID := range inv.TeamIds {
			team, err := q.GetTeam(ctx, teamID)
			if err != nil {
				// A team deleted between invitation and acceptance is not a reason to
				// refuse the invitation.
				if store.IsNotFound(err) {
					continue
				}
				return platform.Internal(err)
			}
			m, err := s.addMember(ctx, q, inv.WorkspaceID, teamID, userID, "member")
			if err != nil {
				return err
			}
			changes = append(changes, Change{
				EntityType: "teamMembership", EntityID: m.ID, Op: OpUpsert, TeamID: &teamID,
				Scope: authz.TeamScope(teamID, team.Private), Payload: m,
			})
		}

		if err := q.AcceptInvite(ctx, store.AcceptInviteParams{ID: inv.ID, AcceptedBy: &userID}); err != nil {
			return platform.Internal(err)
		}

		_, err = s.em.Emit(ctx, q, inv.WorkspaceID, authz.UserActor(userID), changes...)
		return err
	})
	return user, workspaceID, err
}

// RevokeInvite and ListInvites live in admin.go, beside the other operations an admin
// performs on somebody else's access.

// --- helpers -------------------------------------------------------------------

func normaliseEmail(raw string) (string, error) {
	email := strings.TrimSpace(raw)
	if email == "" {
		return "", platform.Validation("email", "email is required")
	}
	if len(email) > 254 {
		return "", platform.Validation("email", "email is too long")
	}
	at := strings.LastIndex(email, "@")
	// Deliberately not a full RFC 5322 check. Every regex that tries either rejects
	// valid addresses or accepts nonsense; the real validation is that a message arrives.
	if at <= 0 || at == len(email)-1 || strings.Contains(email, " ") {
		return "", platform.Validation("email", "that does not look like an email address")
	}
	if !strings.Contains(email[at+1:], ".") {
		return "", platform.Validation("email", "that does not look like an email address")
	}
	return email, nil
}

// validatePasswordStrength enforces length only.
//
// Composition rules ("one uppercase, one digit, one symbol") measurably push people
// towards Password1! and away from passphrases, so length is the requirement and the
// upper bound is a denial-of-service guard on the KDF, not a security rule.
func validatePasswordStrength(pw string) error {
	if len(pw) < 10 {
		return platform.Validation("password", "use at least 10 characters — a passphrase is easiest")
	}
	if len(pw) > 1024 {
		return platform.Validation("password", "password is too long")
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
