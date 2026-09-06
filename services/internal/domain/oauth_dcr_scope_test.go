package domain_test

import (
	"slices"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The scope rule is two-tier on purpose, and the two tiers look alike enough that somebody
// will eventually try to collapse them. These three tests are why they cannot be.

func registerWithScope(t *testing.T, scope string) (domain.DynamicClientRegistration, error) {
	t.Helper()
	svc := domain.NewService(testutil.NewDB(t))
	return svc.RegisterDynamicClient(t.Context(), domain.RegisterDynamicClientInput{
		ClientName:   "Scoped",
		RedirectURIs: []string{"https://example.com/cb"},
		Scope:        scope,
	})
}

// A scope from somebody else's vocabulary is not a request this server has an opinion
// about. Refusing the registration over it is what stopped Claude connecting.
func TestDynamicClient_UnknownScopesAreDropped(t *testing.T) {
	reg, err := registerWithScope(t, "openid profile email offline_access")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if !slices.Contains(reg.Scopes, domain.OauthScopeRead) || !slices.Contains(reg.Scopes, domain.OauthScopeWrite) {
		t.Errorf("scopes = %v, want the read/write default", reg.Scopes)
	}
}

func TestDynamicClient_MixedScopesKeepOnlyReadAndWrite(t *testing.T) {
	reg, err := registerWithScope(t, "openid write email")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if slices.Contains(reg.Scopes, "openid") || slices.Contains(reg.Scopes, "email") {
		t.Errorf("scopes = %v, want no foreign scope stored", reg.Scopes)
	}
	if !slices.Contains(reg.Scopes, domain.OauthScopeWrite) {
		t.Errorf("scopes = %v, want write kept", reg.Scopes)
	}
}

// The other tier. A client asking for admin speaks this vocabulary, so it gets an answer
// rather than a silent narrowing — see TestDynamicClient_ScopesAreClampedToReadAndWrite.
func TestDynamicClient_StillRefusesAPrivilegedScope(t *testing.T) {
	if _, err := registerWithScope(t, "read admin"); err == nil {
		t.Fatal("a self-registered client must not be able to ask for admin")
	}
	if _, err := registerWithScope(t, "issues:create"); err == nil {
		t.Fatal("a self-registered client must not be able to ask for issues:create")
	}
}
