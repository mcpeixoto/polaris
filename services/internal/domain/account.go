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

	// InviteToken is the invitation this registration redeems, if any.
	//
	// It travels ON the register call rather than being exchanged first, and the account
	// and the membership are created in ONE transaction. The alternative — register, then
	// POST /auth/invites/accept — is two round trips that can half-fail, and the half is
	// not hypothetical: the invited person ends up holding an account on a server that
	// admits nobody, belonging to no workspace, with an invitation that may since have
	// been revoked or expired. There is no screen for that state and no way out of it
	// except an admin noticing. Here there is no such state to land in: either the account
	// exists and is a member, or nothing happened.
	InviteToken string

	// DisplayName is the name the invited person takes in the workspace they are joining.
	// Ignored when no invitation is being redeemed, because there is no workspace yet to
	// have a name in.
	DisplayName string

	// AllowOpenSignup mirrors POLARIS_REGISTRATION_MODE=open.
	//
	// Passed in rather than read from config here, because domain.Service is constructed
	// with a database and nothing else and this package has no opinion about environment
	// variables. The direction of the flag matters more than its home: false means the
	// closed server, so a caller that forgets to set it gets the safe behaviour rather
	// than the open one.
	AllowOpenSignup bool
}

// Register creates an account, and — when an invitation is redeemed — its workspace
// membership, in one transaction.
//
// It does NOT create a workspace. The caller decides whether the new account is starting
// one or accepting an invitation to an existing one, and conflating the two produces an
// orphan workspace for every invited user.
//
// Who is admitted is decided by admitRegistration; see the comment there for the policy and
// for why a refusal says what it says.
func (s *Service) Register(ctx context.Context, in RegisterInput) (uuid.UUID, Session, error) {
	email, err := normaliseEmail(in.Email)
	if err != nil {
		return uuid.Nil, Session{}, err
	}
	if err := validatePasswordStrength(in.Password); err != nil {
		return uuid.Nil, Session{}, err
	}

	// Admission is checked BEFORE the password is hashed, and that ordering is the point.
	// argon2id allocates 64 MiB per hash (see internal/auth/password.go, and the memory
	// budget in docs/05-infrastructure/11-self-hosting.md, which names a burst of sign-ins
	// as what OOM-kills the api process). Hashing first would let anybody who can reach the
	// endpoint make the process allocate that much before finding out they were never
	// allowed to register — on a server whose whole policy is that they are not. One
	// indexed read is the cheaper way to say no.
	//
	// This call is an optimisation and not the authority: nothing it observes is held, so
	// the transaction below asks again with the lock in hand.
	if _, err := s.admitRegistration(ctx, s.db.Pool(), email, in, false); err != nil {
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
	// The transaction is opened here rather than through db.InTx because the first-account
	// check needs the transaction itself and not just its query set — see claimFirstAccount.
	// Everything else about it is InTx's contract: rollback on any error, and no half-made
	// account without the membership that made it admissible.
	err = func() error {
		tx, err := s.db.Pool().Begin(ctx)
		if err != nil {
			return platform.Internal(err)
		}
		// Safe unconditionally: a rollback after a successful commit is a no-op.
		defer func() { _ = tx.Rollback(ctx) }()
		q := store.New(tx)

		inv, err := s.admitRegistration(ctx, tx, email, in, true)
		if err != nil {
			return err
		}

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

		if inv != nil {
			// Same transaction as the account. An error here takes the account with it,
			// which is the whole reason the token travels on this call.
			if _, err := s.applyInvite(ctx, q, *inv, acct.ID, email, in.DisplayName); err != nil {
				return err
			}
		}

		if session, err = s.issueSession(ctx, q, acct.ID, in.UserAgent, in.IP); err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return platform.Internal(err)
		}
		return nil
	}()
	if err != nil {
		return uuid.Nil, Session{}, err
	}
	return accountID, session, nil
}

// --- who may register ------------------------------------------------------------
//
// POST /auth/register used to accept anybody who could reach it, which for a product people
// run on their own boxes with the port exposed is an abuse report in week one. README states
// the intended policy — "invite-only beta first, no open signup until per-workspace quotas
// and abuse controls are proven" — and this is where it is enforced.
//
// Exactly two people may register on a default install:
//
//  1. Somebody holding a valid, pending, unexpired invitation. Naively closing registration
//     would break invitations completely, because POST /auth/invites/accept is behind
//     RequireAuth and reads the account from the request context — an invited person must
//     already HAVE an account before they can accept anything. So the invitation is what
//     buys the account, on the same call.
//
//  2. The very first account on an install that has none, so a self-hoster can bootstrap
//     without hand-editing the database. There is no CLI for it: polarisctl has five
//     commands and none of them makes an account.
//
// Plus POLARIS_REGISTRATION_MODE=open, off by default.

// registrationClosed is what a caller who supplied no invitation is told.
//
// It reveals one thing — that this install already has an account — and it cannot avoid
// revealing it, because on an install that does NOT have one the same request succeeds. That
// is inherent to having a bootstrap rule at all, and it is why the self-hosting document
// tells operators to create their account before the box is reachable.
func registrationClosed() error {
	return platform.Forbidden(
		"this server is invite-only — ask an admin to send you an invitation link")
}

// invitationUnusable is what EVERY failed invitation is told, without exception.
//
// A token that never existed, one that was revoked, one that expired, one already accepted,
// and one presented with the wrong email address all produce this exact string. The
// alternative is an oracle: "no invitation for this address" and "that invitation expired"
// each answer a question an attacker holding a leaked or guessed link would like answered.
// This is the same reasoning RevokeInvite states for its NOT_FOUND being deliberately
// indistinguishable across three causes.
//
// The refusal is distinct from registrationClosed above, and that is not a leak: the two are
// told apart by whether the caller supplied a token, which the caller already knows. It buys
// an actionable message — "the link is stale, and it has to be the address it was sent to" —
// for nothing.
func invitationUnusable() error {
	return platform.Forbidden(
		"this invitation cannot be used — ask for a new one, and sign up with the address it was sent to")
}

// bootstrapLockKey namespaces the advisory lock the first-account check runs under.
//
// An arbitrary constant; advisory locks share one 64-bit space per database, so the only
// requirement is that nothing else in this schema picks the same number. testutil's template
// lock is the other one in the tree, and it is taken against the maintenance database rather
// than this one.
const bootstrapLockKey int64 = 0x504f4c41524953 // "POLARIS"

// admitRegistration decides whether this caller may create an account at all, and returns
// the invitation being redeemed, or nil.
//
// Called twice per registration, against different handles. Once on the pool before the
// password is hashed, where it is only an optimisation, and once inside the transaction —
// with lock set — where it is the authority. Writing it once rather than twice is deliberate:
// two checks that must agree, in two places, is how one of them ends up not being updated.
func (s *Service) admitRegistration(
	ctx context.Context, db store.DBTX, email string, in RegisterInput, lock bool,
) (*store.Invite, error) {
	q := store.New(db)

	switch {
	case in.InviteToken != "":
		// Checked even when open signup is on. Somebody who followed an invitation link
		// meant to join that workspace, and quietly handing them a bare account on a bad
		// token strands them outside it with no error and no way to notice.
		inv, err := resolveInvite(ctx, q, in.InviteToken, email)
		if err != nil {
			// Everything that is not a database failure becomes the one refusal. An internal
			// error passes through unchanged, for the reason AuthenticateApiKey gives:
			// answering "your invitation is bad" to a database outage sends whoever is
			// holding the pager to the wrong system.
			if platform.CodeOf(err) == platform.CodeInternal {
				return nil, err
			}
			return nil, invitationUnusable()
		}
		return &inv, nil

	case in.AllowOpenSignup:
		return nil, nil

	default:
		return nil, claimFirstAccount(ctx, db, lock)
	}
}

// claimFirstAccount admits the bootstrap registration on an install that has no accounts.
//
// # The race
//
// Two people hitting a brand-new instance at the same moment must not both become the first
// account, and "unlikely to lose" is not the same as safe. A plain count-then-insert loses
// this race by construction: at READ COMMITTED neither transaction can see the other's
// uncommitted row, so both count zero and both commit. `INSERT ... WHERE NOT EXISTS` loses it
// the same way, for the same reason — the subquery reads a snapshot taken before the other
// insert existed.
//
// So the check runs under a transaction-scoped advisory lock. Every bootstrap attempt queues
// on the same key; the winner's INSERT is committed, and therefore visible, before the lock
// is released, so the next attempt reads a non-empty table and is refused. Transaction-scoped
// rather than session-scoped because the release is then the commit or the rollback itself:
// there is no unlock statement to be skipped by an early return, a panic or a dropped
// connection, and a leaked lock here would wedge registration on the install permanently.
//
// The lock is taken only on this path. An invited registration and an open-signup one never
// touch it, so the ordinary case pays nothing.
//
// # Deleted accounts
//
// The existence check counts EVERY account row, including soft-deleted ones — no
// `deleted_at IS NULL`, unlike every other query against this table. An install whose only
// account was deleted is not a fresh install: it is somebody's server with their data still
// in it, and re-opening the front door because the owner deleted their own login would hand
// the next stranger a workspace full of somebody else's issues. The door closes once and
// stays closed.
func claimFirstAccount(ctx context.Context, db store.DBTX, lock bool) error {
	if lock {
		if _, err := db.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, bootstrapLockKey); err != nil {
			return platform.Internal(err)
		}
	}

	// Raw SQL rather than a generated query, and it is the one place in this package that
	// does that. The lock statement has no sqlc equivalent at all, and adding `CountAccounts`
	// to internal/store/queries would not remove the need for it — see the note in the
	// report accompanying this change.
	var exists bool
	if err := db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM account)`).Scan(&exists); err != nil {
		return platform.Internal(err)
	}
	if exists {
		return registrationClosed()
	}
	return nil
}

type LoginInput struct {
	Email     string
	Password  string
	UserAgent string
	IP        *netip.Addr
}

// The mailbox and passphrase polarisctl seed creates, and the one POST /auth/dev-session
// will mint a cookie for on loopback. Kept next to Login rather than in the HTTP layer
// so a test of the domain path does not have to know the handler's constants.
const (
	localDevEmail    = "dev@polaris.local"
	localDevPassword = "polaris-dev-password"
)

// LoginDev opens a session for local development without a password.
//
// Prefer the seed account if it exists; otherwise the oldest workspace's owner or
// admin; otherwise create the seed account the same way polarisctl seed does — first
// account on an empty install, Argon2id hash, ordinary session row. It does not set
// AllowOpenSignup, so an install that already has accounts and no usable owner is
// still invite-only. The HTTP handler is what stops this being reachable off
// loopback; this method itself is just "who do we sign in as".
func (s *Service) LoginDev(ctx context.Context, userAgent string, ip *netip.Addr) (uuid.UUID, Session, error) {
	accountID, err := s.resolveDevAccount(ctx)
	if err != nil {
		if platform.CodeOf(err) != platform.CodeNotFound {
			return uuid.Nil, Session{}, err
		}
		return s.Register(ctx, RegisterInput{
			Email:     localDevEmail,
			Password:  localDevPassword,
			UserAgent: userAgent,
			IP:        ip,
		})
	}

	var session Session
	err = s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		if err := q.MarkAccountLogin(ctx, accountID); err != nil {
			return platform.Internal(err)
		}
		session, err = s.issueSession(ctx, q, accountID, userAgent, ip)
		return err
	})
	return accountID, session, err
}

func (s *Service) resolveDevAccount(ctx context.Context) (uuid.UUID, error) {
	acct, err := s.db.Queries().GetAccountByEmail(ctx, localDevEmail)
	if err == nil {
		return acct.ID, nil
	}
	if !store.IsNotFound(err) {
		return uuid.Nil, platform.Internal(err)
	}

	// Same question polarisctl seed answers when the mailbox is missing: whoever
	// already owns the first workspace. A laptop that was seeded under a different
	// address, or a fixture, still gets a session rather than a login form.
	var id uuid.UUID
	err = s.db.Pool().QueryRow(ctx, `
		SELECT a.id
		FROM workspace w
		JOIN "user" u ON u.workspace_id = w.id AND u.account_id IS NOT NULL
		JOIN account a ON a.id = u.account_id
		WHERE w.deleted_at IS NULL
		  AND u.archived_at IS NULL
		  AND u.status = 'active'
		  AND u.role IN ('owner', 'admin')
		  AND a.deleted_at IS NULL
		ORDER BY w.created_at ASC, u.created_at ASC
		LIMIT 1`).Scan(&id)
	if err != nil {
		if store.IsNotFound(err) {
			return uuid.Nil, platform.NotFound("dev account")
		}
		return uuid.Nil, platform.Internal(err)
	}
	return id, nil
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
		if err != nil {
			return err
		}
		// Audited here rather than in issueSession, which also mints sessions for
		// registration and for every token refresh. A refresh is not a sign-in.
		return s.auditSignIn(ctx, q, acct.ID, in.UserAgent, in.IP)
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

		// Rotated in place rather than revoked and re-issued.
		//
		// A refresh has to change the token — a refresh token that survives its own use is a
		// replay waiting to happen — but it must not change which session this is. It used to
		// do both: the old row was revoked and a new one inserted, so every live device became
		// a different session id every fifteen minutes. The Sessions screen draws a Revoke
		// button per id, so pressing it on any device that had refreshed since the list loaded
		// answered "session not found" and left that device signed in and refreshing happily —
		// which is the whole of what that screen is for.
		//
		// Nothing is weakened by keeping the row: the previous digest is overwritten, so the
		// old token authenticates nothing, exactly as revoking it did. What is gained is a
		// stable identity for the login, and with it a truthful created_at, user_agent, ip and
		// country instead of values that were re-derived (or lost) on every refresh.
		plain, hash, err := auth.NewOpaqueToken()
		if err != nil {
			return err
		}
		row, err := q.RotateSessionToken(ctx, store.RotateSessionTokenParams{
			ID:        existing.ID,
			TokenHash: hash,
			ExpiresAt: time.Now().Add(s.refreshTTL()),
		})
		if err != nil {
			if store.IsNotFound(err) {
				// Revoked between the lookup above and this update: somebody pressed Revoke on
				// this very device a moment ago, and the answer they are owed is that it is gone.
				return platform.Unauthorized("session expired, please sign in again")
			}
			return platform.Internal(err)
		}
		session = Session{
			SessionID:    row.ID,
			AccountID:    row.AccountID,
			RefreshToken: plain,
			ExpiresAt:    row.ExpiresAt,
		}
		return nil
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
		// Refused here as well as on acceptance, and the duplication is the point.
		//
		// The limit is spent when the invitation is redeemed (see applyInvite), so that is
		// where it must be enforced. But an admin who sends an invitation that cannot be
		// accepted learns about the cap through their new colleague, from an email link that
		// fails — which is both the worst moment and the wrong person. This is the same
		// question asked at the moment somebody can still do something about it.
		//
		// Deliberately not counting pending invitations against the limit: an invitation is
		// not a seat, most of a batch is usually accepted, and reserving capacity for links
		// that may never be clicked would make a workspace full while nobody is using it.
		// The consequence is that a batch sent into one free seat is admitted and only the
		// first acceptance succeeds, which is the honest ordering.
		ent, err := entitlementSetFor(ctx, q, p.WorkspaceID)
		if err != nil {
			return err
		}
		if err := ent.CanAddSeat(); err != nil {
			return err
		}

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

		// The invitation, not the token. `plain` is a live credential that grants membership
		// to whoever holds it, and this table is permanent and readable by every admin —
		// writing it here would turn the audit log into a place to harvest working invites.
		entry := s.auditBy(ctx, q, p, AuditInviteSent)
		entry.TargetType = "invite"
		entry.TargetID = &row.ID
		entry.TargetLabel = row.Email
		entry.After = map[string]any{"email": row.Email, "role": row.Role, "teamIds": row.TeamIds}
		return s.recordAudit(ctx, q, entry)
	})
	return out, err
}

// AcceptInvite turns an invitation into workspace membership for an existing account.
//
// This is the second workspace and onwards. The first one arrives through Register, which
// redeems the invitation on the same call that creates the account — an invited person has
// no account yet, and this endpoint is behind RequireAuth. Both paths share resolveInvite
// and applyInvite so there is one definition of what redeeming an invitation does.
func (s *Service) AcceptInvite(ctx context.Context, accountID uuid.UUID, token, displayName string) (model.User, uuid.UUID, error) {
	var (
		user        model.User
		workspaceID uuid.UUID
	)
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		acct, err := q.GetAccount(ctx, accountID)
		if err != nil {
			return platform.Internal(err)
		}

		// The distinct messages resolveInvite produces are kept here, unlike on the register
		// path which collapses them. This caller is already signed in and already holds the
		// token, so "that was sent to a different address" tells them nothing they could not
		// work out — and it is the one message that gets somebody who is signed in as the
		// wrong account to the right remedy instead of asking for a new invitation.
		inv, err := resolveInvite(ctx, q, token, acct.Email)
		if err != nil {
			return err
		}
		workspaceID = inv.WorkspaceID

		user, err = s.applyInvite(ctx, q, inv, accountID, acct.Email, displayName)
		return err
	})
	return user, workspaceID, err
}

// resolveInvite finds the invitation a token names and checks it belongs to this address.
//
// Looked up BY hash rather than fetched and compared, for the reason AuthenticateApiKey
// states in domain/apikeys.go: invite_token_hash_key makes this one indexed read and the
// comparison happens inside the index over a full-entropy digest, so no candidate row ever
// reaches Go and there is no byte-by-byte comparison whose duration could reveal how much of
// a guessed token was right. Pending, unrevoked and unexpired are filtered by the query
// itself, so no caller can forget one of the three.
func resolveInvite(ctx context.Context, q *store.Queries, token, accountEmail string) (store.Invite, error) {
	inv, err := q.GetInviteByTokenHash(ctx, auth.HashToken(token))
	if err != nil {
		if store.IsNotFound(err) {
			return store.Invite{}, platform.Validation("token", "this invitation is no longer valid")
		}
		return store.Invite{}, platform.Internal(err)
	}
	// The invitation is to a specific address. Letting any account redeem a leaked link
	// would make a forwarded email a workspace entry point.
	if !strings.EqualFold(accountEmail, inv.Email) {
		return store.Invite{}, platform.Forbidden("this invitation was sent to a different email address")
	}
	return inv, nil
}

// applyInvite creates the workspace membership an invitation grants, inside the caller's
// transaction. It assumes resolveInvite has already vouched for the invitation.
func (s *Service) applyInvite(
	ctx context.Context, q *store.Queries, inv store.Invite,
	accountID uuid.UUID, accountEmail, displayName string,
) (model.User, error) {
	// Already a member: accept idempotently rather than erroring, because the common
	// cause is somebody clicking the link twice.
	if existing, err := q.GetUserByAccountAndWorkspace(ctx, store.GetUserByAccountAndWorkspaceParams{
		AccountID: &accountID, WorkspaceID: inv.WorkspaceID,
	}); err == nil {
		if err := q.AcceptInvite(ctx, store.AcceptInviteParams{ID: inv.ID, AcceptedBy: &existing.ID}); err != nil {
			return model.User{}, platform.Internal(err)
		}
		return toUser(existing), nil
	} else if !store.IsNotFound(err) {
		return model.User{}, platform.Internal(err)
	}

	// A seat is consumed here and only here, so this is where the plan's limit is enforced.
	//
	// Below the idempotent branch above, deliberately: somebody who already has a membership
	// and clicks the link twice occupies the seat they are already occupying, and refusing
	// them because the workspace is now full would break a link that had already worked.
	//
	// Inside the caller's transaction, so the count cannot go stale between reading it and
	// writing the row — two invitations redeemed at the same moment against the last seat
	// would otherwise both read "one free" and both be admitted.
	//
	// InviteToWorkspace checks the same thing when the invitation is sent, which is the
	// friendlier moment to hear it. That check cannot replace this one: a seat can be taken
	// in the days between sending and accepting, and the acceptance is where the limit is
	// actually spent.
	ent, err := entitlementSetFor(ctx, q, inv.WorkspaceID)
	if err != nil {
		return model.User{}, err
	}
	if err := ent.CanAddSeat(); err != nil {
		return model.User{}, err
	}

	if displayName == "" {
		displayName = strings.SplitN(accountEmail, "@", 2)[0]
	}
	userID, err := uuid.NewV7()
	if err != nil {
		return model.User{}, platform.Internal(err)
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
		return model.User{}, platform.Internal(err)
	}
	user := toUser(row)

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
			return model.User{}, platform.Internal(err)
		}
		m, err := s.addMember(ctx, q, inv.WorkspaceID, teamID, userID, "member")
		if err != nil {
			return model.User{}, err
		}
		changes = append(changes, Change{
			EntityType: "teamMembership", EntityID: m.ID, Op: OpUpsert, TeamID: &teamID,
			Scope: authz.TeamScope(teamID, team.Private), Payload: m,
		})
	}

	if err := q.AcceptInvite(ctx, store.AcceptInviteParams{ID: inv.ID, AcceptedBy: &userID}); err != nil {
		return model.User{}, platform.Internal(err)
	}

	// Hooked here rather than in AcceptInvite, because this is the shared redemption path:
	// Register redeems an invitation too, and auditing the caller instead would miss every
	// person who joined by signing up from the invitation email.
	//
	// The actor is the invitee, not an administrator — nobody else is present. That is the
	// pair to invite.sent, and reading the two together is what answers "who let them in".
	acceptance := AuditEntry{
		WorkspaceID: inv.WorkspaceID,
		Actor:       authz.UserActor(userID),
		ActorLabel:  user.DisplayName,
		Action:      AuditInviteAccepted,
		TargetType:  "invite",
		TargetID:    &inv.ID,
		TargetLabel: inv.Email,
		After:       map[string]any{"userId": userID, "role": inv.Role},
	}
	if err := s.recordAudit(ctx, q, acceptance); err != nil {
		return model.User{}, err
	}

	if _, err := s.em.Emit(ctx, q, inv.WorkspaceID, authz.UserActor(userID), changes...); err != nil {
		return model.User{}, err
	}
	return user, nil
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
