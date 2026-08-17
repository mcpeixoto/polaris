package httpapi_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// POST /auth/register used to accept anybody who could reach it.
//
// README states the policy the implementation never matched — "invite-only beta first, no
// open signup until per-workspace quotas and abuse controls are proven" — and for a product
// people run on their own boxes with the port exposed, the gap between the two is an abuse
// report in week one.
//
// The interesting part is that closing it naively breaks onboarding completely:
// POST /auth/invites/accept is behind RequireAuth and reads the account from the request
// context, so an invited person must already HAVE an account before they can accept
// anything. These tests go through the real router against a real database because the thing
// under test is a policy spread across a handler, a config value and a transaction, and
// every one of those three was individually correct before.

func TestRegister_TheFirstAccountOnAFreshInstallIsAdmitted(t *testing.T) {
	// The self-hoster's bootstrap. There is no CLI that makes an account — polarisctl has
	// five commands and none of them is this — so if the first registration were refused the
	// only way onto a new install would be hand-editing Postgres.
	h := newRegisterHarness(t, platform.RegistrationInvite)

	got := h.register(registerBody{Email: "founder@example.com", Password: "a-long-enough-passphrase"})
	if got.status != http.StatusOK {
		t.Fatalf("the first account on an empty install was refused: %d %s", got.status, got.body)
	}
}

func TestRegister_AStrangerIsRefusedOnceAnAccountExists(t *testing.T) {
	h := newRegisterHarness(t, platform.RegistrationInvite)

	first := h.register(registerBody{Email: "founder@example.com", Password: "a-long-enough-passphrase"})
	if first.status != http.StatusOK {
		t.Fatalf("setup: first account refused: %d %s", first.status, first.body)
	}

	got := h.register(registerBody{Email: "stranger@example.com", Password: "another-long-passphrase"})
	if got.status != http.StatusForbidden {
		t.Fatalf("an uninvited stranger got in: %d %s", got.status, got.body)
	}
	if !strings.Contains(got.body, "invite-only") {
		t.Errorf("the refusal does not say what to do about it: %s", got.body)
	}
	if h.countAccounts() != 1 {
		t.Errorf("a refused registration left %d accounts behind, want 1", h.countAccounts())
	}
}

func TestRegister_ADeletedFirstAccountDoesNotReopenTheInstall(t *testing.T) {
	// account.deleted_at is a soft delete, and every other query against the table filters
	// on it. The first-account check deliberately does not: an install whose only account was
	// deleted is not a fresh install, it is somebody's server with their issues still in it,
	// and re-opening the front door would hand the next stranger the lot.
	h := newRegisterHarness(t, platform.RegistrationInvite)

	if got := h.register(registerBody{
		Email: "founder@example.com", Password: "a-long-enough-passphrase",
	}); got.status != http.StatusOK {
		t.Fatalf("setup: first account refused: %d %s", got.status, got.body)
	}
	if _, err := h.svc.DB().Pool().Exec(context.Background(),
		`UPDATE account SET deleted_at = now()`); err != nil {
		t.Fatalf("soft delete: %v", err)
	}

	got := h.register(registerBody{Email: "stranger@example.com", Password: "another-long-passphrase"})
	if got.status != http.StatusForbidden {
		t.Fatalf("deleting the only account reopened registration: %d %s", got.status, got.body)
	}
}

func TestRegister_TwoPeopleRacingAFreshInstallProduceOneAccount(t *testing.T) {
	// The race the whole advisory lock exists for. A plain count-then-insert loses it by
	// construction — at READ COMMITTED neither transaction sees the other's uncommitted row,
	// so both count zero and both commit — and "unlikely to lose" is not the same as safe.
	//
	// Six callers, one winner, and the losers must be refused rather than erroring: they are
	// ordinary strangers on an install that now has an owner.
	const racers = 6
	h := newRegisterHarness(t, platform.RegistrationInvite)

	results := make([]probe, racers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range racers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			results[i] = h.register(registerBody{
				Email:    fmt.Sprintf("racer%d@example.com", i),
				Password: "a-long-enough-passphrase",
			})
		}()
	}
	close(start)
	wg.Wait()

	admitted := 0
	for i, got := range results {
		switch got.status {
		case http.StatusOK:
			admitted++
		case http.StatusForbidden:
		default:
			t.Errorf("racer %d got an unexpected %d: %s", i, got.status, got.body)
		}
	}
	if admitted != 1 {
		t.Fatalf("%d of %d racers became the first account — want exactly 1", admitted, racers)
	}
	if n := h.countAccounts(); n != 1 {
		t.Fatalf("the install ended up with %d accounts, want 1", n)
	}
}

func TestRegister_AnInvitedPersonGetsInAndIsAMemberOnTheSameCall(t *testing.T) {
	// The constraint that makes this feature interesting: accepting an invitation needs an
	// account, and getting an account needs an invitation. The token therefore rides on the
	// register call, and the membership is created in the same transaction — so there is no
	// half-joined state and no second round trip to fail.
	h := newRegisterHarness(t, platform.RegistrationInvite)
	fixture := testutil.NewFixture(t, h.svc.DB())

	invite, err := h.svc.InviteToWorkspace(context.Background(), fixture.Principal(), domain.InviteInput{
		Email: "invited@example.com",
		Role:  "member",
	})
	if err != nil {
		t.Fatalf("setup: invite: %v", err)
	}

	got := h.register(registerBody{
		Email:       "invited@example.com",
		Password:    "a-long-enough-passphrase",
		InviteToken: invite.Token,
		DisplayName: "Ada Lovelace",
	})
	if got.status != http.StatusOK {
		t.Fatalf("an invited person was refused: %d %s", got.status, got.body)
	}

	// The workspace comes back on the register response itself, which is what lets the client
	// route straight in. If it did not, the invited person would land on "create a workspace"
	// — the screen for somebody who was never invited at all.
	var body struct {
		Workspaces []struct {
			ID string `json:"id"`
		} `json:"workspaces"`
	}
	if err := json.Unmarshal([]byte(got.body), &body); err != nil {
		t.Fatalf("decode register response: %v", err)
	}
	if len(body.Workspaces) != 1 || body.Workspaces[0].ID != fixture.WorkspaceID.String() {
		t.Fatalf("the register response listed %v, want the workspace that invited them (%s)",
			body.Workspaces, fixture.WorkspaceID)
	}
}

func TestRegister_EveryUnusableInvitationSaysTheSameThing(t *testing.T) {
	// The refusal must not be an oracle. "no invitation for this address" and "that
	// invitation expired" each answer a question somebody holding a guessed or forwarded
	// link would like answered, which is the reason RevokeInvite's NOT_FOUND is deliberately
	// indistinguishable across three causes. Same rule here, across five.
	h := newRegisterHarness(t, platform.RegistrationInvite)
	fixture := testutil.NewFixture(t, h.svc.DB())
	ctx := context.Background()

	newInvite := func(t *testing.T, email string) domain.CreatedInvite {
		t.Helper()
		inv, err := h.svc.InviteToWorkspace(ctx, fixture.Principal(), domain.InviteInput{
			Email: email, Role: "member",
		})
		if err != nil {
			t.Fatalf("setup: invite %s: %v", email, err)
		}
		return inv
	}

	cases := []struct {
		name string
		body func(t *testing.T) registerBody
	}{
		{"a token that never existed", func(*testing.T) registerBody {
			return registerBody{
				Email: "nobody@example.com", Password: "a-long-enough-passphrase",
				InviteToken: "not-a-real-token-at-all",
			}
		}},
		{"a revoked invitation", func(t *testing.T) registerBody {
			inv := newInvite(t, "revoked@example.com")
			if _, _, err := h.svc.RevokeInvite(ctx, fixture.Principal(), inv.ID); err != nil {
				t.Fatalf("setup: revoke: %v", err)
			}
			return registerBody{
				Email: "revoked@example.com", Password: "a-long-enough-passphrase",
				InviteToken: inv.Token,
			}
		}},
		{"an expired invitation", func(t *testing.T) registerBody {
			inv := newInvite(t, "expired@example.com")
			if _, err := h.svc.DB().Pool().Exec(ctx,
				`UPDATE invite SET expires_at = now() - interval '1 day' WHERE id = $1`, inv.ID,
			); err != nil {
				t.Fatalf("setup: expire: %v", err)
			}
			return registerBody{
				Email: "expired@example.com", Password: "a-long-enough-passphrase",
				InviteToken: inv.Token,
			}
		}},
		{"an invitation presented with a different address", func(t *testing.T) registerBody {
			inv := newInvite(t, "intended@example.com")
			return registerBody{
				Email: "somebody.else@example.com", Password: "a-long-enough-passphrase",
				InviteToken: inv.Token,
			}
		}},
		{"an invitation that was already accepted", func(t *testing.T) registerBody {
			inv := newInvite(t, "twice@example.com")
			if got := h.register(registerBody{
				Email: "twice@example.com", Password: "a-long-enough-passphrase",
				InviteToken: inv.Token,
			}); got.status != http.StatusOK {
				t.Fatalf("setup: first acceptance refused: %d %s", got.status, got.body)
			}
			// A second person, holding the same link.
			return registerBody{
				Email: "twice@example.com", Password: "a-long-enough-passphrase",
				InviteToken: inv.Token,
			}
		}},
	}

	var first probe
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := h.register(tc.body(t))
			if got.status != http.StatusForbidden {
				t.Fatalf("status %d, want 403: %s", got.status, got.body)
			}
			if i == 0 {
				first = got
				return
			}
			// Byte-identical, not merely both refusals. A difference in wording, in code or
			// in field is the oracle, whatever the status says.
			if got.body != first.body {
				t.Errorf("this refusal is distinguishable from %q:\n  %s", cases[0].name, got.body)
			}
		})
	}
}

func TestRegister_AFailedInvitationLeavesNoAccountBehind(t *testing.T) {
	// The account and the membership are one transaction, so a bad token must not leave
	// somebody holding an account on a server that admits nobody and belonging to no
	// workspace — which is exactly the state the two-round-trip design produces.
	h := newRegisterHarness(t, platform.RegistrationInvite)
	fixture := testutil.NewFixture(t, h.svc.DB())
	before := h.countAccounts()

	got := h.register(registerBody{
		Email: "hopeful@example.com", Password: "a-long-enough-passphrase",
		InviteToken: "not-a-real-token-at-all",
	})
	if got.status != http.StatusForbidden {
		t.Fatalf("status %d, want 403: %s", got.status, got.body)
	}
	if after := h.countAccounts(); after != before {
		t.Errorf("account count went %d -> %d; a refused registration created an account", before, after)
	}
	_ = fixture
}

func TestRegister_OpenModeAdmitsAnybody(t *testing.T) {
	// The escape hatch, for an operator who genuinely wants a public server. Off by default,
	// and this is the test that it is actually reachable when set — an escape hatch nobody
	// can open is a config variable that only looks like one.
	h := newRegisterHarness(t, platform.RegistrationOpen)
	testutil.NewFixture(t, h.svc.DB()) // the install is not fresh

	got := h.register(registerBody{Email: "stranger@example.com", Password: "a-long-enough-passphrase"})
	if got.status != http.StatusOK {
		t.Fatalf("POLARIS_REGISTRATION_MODE=open still refused a stranger: %d %s", got.status, got.body)
	}
}

func TestRegister_OpenModeStillRefusesABadInvitation(t *testing.T) {
	// Somebody who followed an invitation link meant to join that workspace. Handing them a
	// bare account on an open server because the token was stale would strand them outside
	// it with no error and nothing to notice.
	h := newRegisterHarness(t, platform.RegistrationOpen)
	testutil.NewFixture(t, h.svc.DB())

	got := h.register(registerBody{
		Email: "stranger@example.com", Password: "a-long-enough-passphrase",
		InviteToken: "not-a-real-token-at-all",
	})
	if got.status != http.StatusForbidden {
		t.Fatalf("a stale invitation was ignored rather than refused: %d %s", got.status, got.body)
	}
}

func TestRegister_TheSignInBudgetStillBoundsARefusedRegistration(t *testing.T) {
	// Registration shares the per-account sign-in budget, and the gate must sit INSIDE it.
	// A refusal that cost nothing would turn the new endpoint into the cheapest way to probe
	// this process, which is the opposite of what closing it was for.
	h := newRegisterHarness(t, platform.RegistrationInvite)
	testutil.NewFixture(t, h.svc.DB())
	h.enableLimits(t, 3, time.Minute)

	body := registerBody{Email: "prober@example.com", Password: "a-long-enough-passphrase"}
	for i := range 3 {
		if got := h.register(body); got.status != http.StatusForbidden {
			t.Fatalf("attempt %d: status %d, want 403: %s", i+1, got.status, got.body)
		}
	}
	got := h.register(body)
	if got.status != http.StatusTooManyRequests {
		t.Fatalf("a fourth refused registration was not rate limited: %d %s", got.status, got.body)
	}
	if got.Header.Get("Retry-After") == "" {
		t.Error("no Retry-After on the 429, so a client has nothing to act on")
	}
}

func TestAcceptInvite_StillJoinsASecondWorkspace(t *testing.T) {
	// The endpoint register did NOT replace. An account that already exists — because it was
	// invited somewhere else, or bootstrapped the install — joins further workspaces here,
	// and closing registration must not have taken that with it.
	h := newRegisterHarness(t, platform.RegistrationInvite)
	first := testutil.NewFixture(t, h.svc.DB())
	ctx := context.Background()

	// The second workspace is built through the domain API rather than a second fixture:
	// testutil.NewFixture derives its account's email from the first eight characters of a
	// uuid v7, which are the top 32 bits of a millisecond timestamp and therefore identical
	// for any two fixtures created within about 65 seconds of each other. Two fixtures in one
	// database collide on account_email_lower_key.
	other, err := h.svc.CreateWorkspace(ctx, domain.CreateWorkspaceInput{
		AccountID: first.AccountID,
		Name:      "Second",
		URLKey:    "second",
		UserName:  "Dev User",
	})
	if err != nil {
		t.Fatalf("setup: second workspace: %v", err)
	}
	otherPrincipal, err := h.svc.ResolvePrincipal(ctx, first.AccountID, other.Workspace.ID)
	if err != nil {
		t.Fatalf("setup: principal for the second workspace: %v", err)
	}

	one, err := h.svc.InviteToWorkspace(ctx, first.Principal(), domain.InviteInput{
		Email: "roamer@example.com", Role: "member",
	})
	if err != nil {
		t.Fatalf("setup: first invite: %v", err)
	}
	two, err := h.svc.InviteToWorkspace(ctx, otherPrincipal, domain.InviteInput{
		Email: "roamer@example.com", Role: "member",
	})
	if err != nil {
		t.Fatalf("setup: second invite: %v", err)
	}

	joined := h.register(registerBody{
		Email: "roamer@example.com", Password: "a-long-enough-passphrase", InviteToken: one.Token,
	})
	if joined.status != http.StatusOK {
		t.Fatalf("register with an invitation: %d %s", joined.status, joined.body)
	}

	var reg struct {
		AccessToken string `json:"accessToken"`
	}
	if err := json.Unmarshal([]byte(joined.body), &reg); err != nil {
		t.Fatalf("decode register response: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/auth/invites/accept",
		strings.NewReader(fmt.Sprintf(`{"token":%q}`, two.Token)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+reg.AccessToken)
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("accepting a second invitation failed: %d %s", rec.Code, rec.Body.String())
	}
}

// --- harness ---------------------------------------------------------------------------

type registerBody struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	InviteToken string `json:"inviteToken,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
}

type probe struct {
	status int
	body   string
	http.Header
}

type registerHarness struct {
	svc     *domain.Service
	cfg     platform.Config
	handler http.Handler
}

func newRegisterHarness(t *testing.T, mode string) *registerHarness {
	t.Helper()

	svc := domain.NewService(testutil.NewDB(t))
	h := &registerHarness{
		svc: svc,
		cfg: platform.Config{
			Env:              "development",
			JWTSecret:        "test-secret-long-enough-for-these-tests",
			RegistrationMode: mode,
			AccessTokenTTL:   time.Minute,
			// Off by default so the gate is measured on its own. The one test that cares
			// about the budget turns it on with enableLimits.
			RateLimitEnabled: false,
		},
	}
	h.build()
	return h
}

// enableLimits rebuilds the router with the per-account sign-in budget switched on.
func (h *registerHarness) enableLimits(t *testing.T, attempts int, per time.Duration) {
	t.Helper()
	h.cfg.RateLimitEnabled = true
	h.cfg.RateLimitLoginAttempts = attempts
	h.cfg.RateLimitLoginPeriod = per
	h.cfg.RateLimitAnonRequests = 1000
	h.cfg.RateLimitAnonPeriod = time.Minute
	h.cfg.RateLimitMaxCallers = 1000
	h.build()
}

func (h *registerHarness) build() {
	h.handler = httpapi.NewRouter(httpapi.Deps{
		Service: h.svc,
		Tokens:  httpapi.NewTokens(h.cfg.JWTSecret, h.cfg.AccessTokenTTL),
		Config:  h.cfg,
		Limits:  httpapi.NewLimits(h.cfg),
	})
}

func (h *registerHarness) register(body registerBody) probe {
	encoded, err := json.Marshal(body)
	if err != nil {
		panic(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/auth/register", strings.NewReader(string(encoded)))
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	return probe{status: rec.Code, body: strings.TrimSpace(rec.Body.String()), Header: rec.Header()}
}

func (h *registerHarness) countAccounts() int {
	var n int
	// Every row, including soft-deleted ones — the same question claimFirstAccount asks.
	if err := h.svc.DB().Pool().QueryRow(context.Background(),
		`SELECT count(*) FROM account`).Scan(&n); err != nil {
		panic(err)
	}
	return n
}
