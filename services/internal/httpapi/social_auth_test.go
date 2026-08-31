package httpapi_test

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/auth/oidc"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/httpapi"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// A stand-in for Google: an RSA key, a JWKS endpoint, and a token minter. The router is
// pointed at it through Deps.SocialProviders, so everything from the HTTP handler down —
// verification, account resolution, session issuing — is the production path.
type fakeIssuer struct {
	key    *rsa.PrivateKey
	server *httptest.Server
}

func newFakeIssuer(t *testing.T) *fakeIssuer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeIssuer{key: key}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		e := make([]byte, 8)
		binary.BigEndian.PutUint64(e, uint64(key.PublicKey.E))
		trimmed := 0
		for trimmed < len(e)-1 && e[trimmed] == 0 {
			trimmed++
		}
		_, _ = fmt.Fprintf(w, `{"keys":[{"kty":"RSA","use":"sig","alg":"RS256","kid":"k1","n":%q,"e":%q}]}`,
			base64.RawURLEncoding.EncodeToString(key.PublicKey.N.Bytes()),
			base64.RawURLEncoding.EncodeToString(e[trimmed:]))
	}))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeIssuer) provider() oidc.Provider {
	return oidc.Provider{
		Name: "google", Issuer: "https://fake.example",
		JWKSURL: f.server.URL, Audiences: []string{"client-a"},
	}
}

func (f *fakeIssuer) token(t *testing.T, subject, email string, verified any) string {
	t.Helper()
	claims := map[string]any{
		"iss": "https://fake.example", "sub": subject, "aud": "client-a",
		"exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(),
	}
	if email != "" {
		claims["email"] = email
		claims["email_verified"] = verified
	}
	encode := func(v any) string {
		raw, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return base64.RawURLEncoding.EncodeToString(raw)
	}
	signing := encode(map[string]any{"alg": "RS256", "kid": "k1", "typ": "JWT"}) + "." + encode(claims)
	digest := sha256.Sum256([]byte(signing))
	signature, err := rsa.SignPKCS1v15(rand.Reader, f.key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return signing + "." + base64.RawURLEncoding.EncodeToString(signature)
}

type socialHarness struct {
	router http.Handler
	db     *store.DB
	issuer *fakeIssuer
	svc    *domain.Service
}

func socialRouter(t *testing.T, openSignup bool, configured bool) socialHarness {
	t.Helper()
	db := testutil.NewDB(t)
	issuer := newFakeIssuer(t)
	svc := domain.NewService(db)

	cfg := platform.Config{
		JWTSecret:      "test-secret-long-enough-for-hmac",
		AccessTokenTTL: time.Minute,
		PublicURL:      "https://polaris.example",
	}
	if openSignup {
		cfg.RegistrationMode = platform.RegistrationOpen
	} else {
		cfg.RegistrationMode = platform.RegistrationInvite
	}

	providers := map[string]oidc.Provider{"google": issuer.provider()}
	if !configured {
		// What a deployment that never set POLARIS_GOOGLE_CLIENT_ID looks like.
		providers = map[string]oidc.Provider{"google": oidc.Google(nil)}
	}

	router := httpapi.NewRouter(httpapi.Deps{
		Service:         svc,
		Tokens:          httpapi.NewTokens(cfg.JWTSecret, cfg.AccessTokenTTL),
		Config:          cfg,
		SocialProviders: providers,
	})
	return socialHarness{router: router, db: db, issuer: issuer, svc: svc}
}

func (h socialHarness) signIn(t *testing.T, provider, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/auth/oidc/"+provider, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	return rec
}

func (h socialHarness) accountIDFor(t *testing.T, email string) string {
	t.Helper()
	acct, err := h.db.Queries().GetAccountByEmail(context.Background(), email)
	if err != nil {
		t.Fatalf("no account for %s: %v", email, err)
	}
	return acct.ID.String()
}

func body(idToken string) string {
	raw, _ := json.Marshal(map[string]string{"idToken": idToken})
	return string(raw)
}

// The happy path on a server that admits strangers: a verified Google assertion makes an
// account and returns a session, with no password anywhere in it.
func TestSocialSignInCreatesAnAccount(t *testing.T) {
	h := socialRouter(t, true, true)

	rec := h.signIn(t, "google", body(h.issuer.token(t, "sub-1", "ada@example.com", true)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
	// The same session shape a password login returns: an access token in the body and a
	// refresh cookie. A client must not have to care which way in was used.
	if !strings.Contains(rec.Body.String(), "accessToken") {
		t.Fatalf("no access token in the response: %s", rec.Body)
	}
	if rec.Result().Cookies() == nil || len(rec.Result().Cookies()) == 0 {
		t.Fatal("no refresh cookie was set")
	}

	acct, err := h.db.Queries().GetAccountByEmail(context.Background(), "ada@example.com")
	if err != nil {
		t.Fatalf("the account was not created: %v", err)
	}
	if acct.PasswordHash != nil {
		t.Fatal("a social account was given a password hash")
	}
	// The provider vouched for the address, so nothing should ask the person to confirm it.
	if acct.EmailVerifiedAt == nil {
		t.Fatal("the address was not recorded as verified")
	}
}

// Signing in twice is one account. The subject is the identity, so this holds even when the
// address at the provider has changed since.
func TestSocialSignInIsIdempotentOnTheSubject(t *testing.T) {
	h := socialRouter(t, true, true)

	if rec := h.signIn(t, "google", body(h.issuer.token(t, "sub-1", "ada@example.com", true))); rec.Code != http.StatusOK {
		t.Fatalf("first sign-in: %d %s", rec.Code, rec.Body)
	}
	first := h.accountIDFor(t, "ada@example.com")

	// Same subject, new address at the provider.
	if rec := h.signIn(t, "google", body(h.issuer.token(t, "sub-1", "ada@newdomain.com", true))); rec.Code != http.StatusOK {
		t.Fatalf("second sign-in: %d %s", rec.Code, rec.Body)
	}
	if _, err := h.db.Queries().GetAccountByEmail(context.Background(), "ada@newdomain.com"); err == nil {
		t.Fatal("a second account was created for the same provider subject")
	}
	if again := h.accountIDFor(t, "ada@example.com"); again != first {
		t.Fatalf("account moved from %s to %s", first, again)
	}
}

// Somebody who signed up with a password and later uses Google on the same verified address
// is the same person. Making them a second account reads as data loss.
func TestSocialSignInLinksAnExistingAccount(t *testing.T) {
	h := socialRouter(t, true, true)

	if _, _, err := h.svc.Register(context.Background(), domain.RegisterInput{
		Email: "grace@example.com", Password: "correct horse battery staple",
		AllowOpenSignup: true,
	}); err != nil {
		t.Fatalf("seeding the password account: %v", err)
	}
	before := h.accountIDFor(t, "grace@example.com")

	rec := h.signIn(t, "google", body(h.issuer.token(t, "sub-grace", "grace@example.com", true)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
	if after := h.accountIDFor(t, "grace@example.com"); after != before {
		t.Fatalf("linking created a new account: %s -> %s", before, after)
	}
	// And the password still works: linking adds a way in, it does not replace one.
	if _, _, err := h.svc.Login(context.Background(), domain.LoginInput{
		Email: "grace@example.com", Password: "correct horse battery staple",
	}); err != nil {
		t.Fatalf("the password stopped working after linking: %v", err)
	}
}

// The takeover this guard exists for: a provider that has not checked the address must not
// be able to hand over an account that belongs to it.
func TestSocialSignInRefusesAnUnverifiedAddress(t *testing.T) {
	h := socialRouter(t, true, true)

	if _, _, err := h.svc.Register(context.Background(), domain.RegisterInput{
		Email: "victim@example.com", Password: "correct horse battery staple",
		AllowOpenSignup: true,
	}); err != nil {
		t.Fatal(err)
	}
	victim := h.accountIDFor(t, "victim@example.com")

	rec := h.signIn(t, "google", body(h.issuer.token(t, "sub-attacker", "victim@example.com", false)))
	if rec.Code == http.StatusOK {
		t.Fatalf("an unverified address signed in: %s", rec.Body)
	}

	// And nothing was linked to the victim's account behind the refusal.
	if _, err := h.db.Queries().GetAccountCredential(context.Background(),
		store.GetAccountCredentialParams{Kind: "oauth_google", ExternalID: "sub-attacker"}); err == nil {
		t.Fatal("a credential was linked despite the refusal")
	}
	if h.accountIDFor(t, "victim@example.com") != victim {
		t.Fatal("the victim's account moved")
	}
}

func TestSocialSignInRefusesWhatItCannotVerify(t *testing.T) {
	h := socialRouter(t, true, true)

	cases := map[string]string{
		"not a token":  body("garbage"),
		"empty token":  body(""),
		"missing body": `{}`,
	}
	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			rec := h.signIn(t, "google", payload)
			if rec.Code == http.StatusOK {
				t.Fatalf("accepted: %s", rec.Body)
			}
		})
	}
}

// A deployment that never configured the provider must say the route is not there, rather
// than refusing every token for a reason nobody can see.
func TestSocialSignInIsNotOfferedWhenUnconfigured(t *testing.T) {
	h := socialRouter(t, true, false)

	rec := h.signIn(t, "google", body(h.issuer.token(t, "sub-1", "ada@example.com", true)))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404: %s", rec.Code, rec.Body)
	}

	req := httptest.NewRequest(http.MethodGet, "/auth/providers", nil)
	list := httptest.NewRecorder()
	h.router.ServeHTTP(list, req)
	if strings.Contains(list.Body.String(), `"google"`) {
		t.Fatalf("an unconfigured provider was advertised: %s", list.Body)
	}
}

// Social sign-in must not be a way around a server's registration policy.
func TestSocialSignInHonoursInviteOnlyRegistration(t *testing.T) {
	h := socialRouter(t, false, true)

	// The very first account bootstraps on an empty install, by the same rule the password
	// path uses — so seed one first, and then the next stranger must be refused.
	if rec := h.signIn(t, "google", body(h.issuer.token(t, "sub-first", "first@example.com", true))); rec.Code != http.StatusOK {
		t.Fatalf("the bootstrap account was refused: %d %s", rec.Code, rec.Body)
	}

	rec := h.signIn(t, "google", body(h.issuer.token(t, "sub-2", "stranger@example.com", true)))
	if rec.Code == http.StatusOK {
		t.Fatalf("an invite-only server admitted a stranger through Google: %s", rec.Body)
	}
	if _, err := h.db.Queries().GetAccountByEmail(context.Background(), "stranger@example.com"); err == nil {
		t.Fatal("an account was created on an invite-only server")
	}
}

// The advertised list is what the sign-in page renders buttons from.
func TestProvidersEndpointAdvertisesWhatWorks(t *testing.T) {
	h := socialRouter(t, true, true)

	req := httptest.NewRequest(http.MethodGet, "/auth/providers", nil)
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var got struct {
		Providers  []string `json:"providers"`
		OpenSignup bool     `json:"openSignup"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Providers) != 1 || got.Providers[0] != "google" {
		t.Fatalf("providers = %v", got.Providers)
	}
	if !got.OpenSignup {
		t.Fatal("openSignup was not reported on a server with open registration")
	}
}
