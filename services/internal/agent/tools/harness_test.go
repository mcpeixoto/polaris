package tools_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/agent/tools"
	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// harness is a real workspace and a real registry. Nothing here is stubbed: a tool's whole
// job is to translate arguments into a domain call and a result into JSON, and a fake
// service would leave both halves of that untested.
type harness struct {
	t   *testing.T
	ctx context.Context
	svc *domain.Service
	f   *testutil.Fixture
	reg *tools.Registry
	p   *authz.Principal
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	return &harness{
		t:   t,
		ctx: context.Background(),
		svc: domain.NewService(db),
		f:   f,
		reg: tools.New(),
		p:   f.Principal(),
	}
}

// call runs a tool as the fixture's owner and fails the test if it errors.
func (h *harness) call(name string, args map[string]any) any {
	h.t.Helper()
	out, err := h.callAs(h.p, name, args)
	if err != nil {
		h.t.Fatalf("%s: %v", name, err)
	}
	return out
}

func (h *harness) callAs(p *authz.Principal, name string, args map[string]any) (any, error) {
	h.t.Helper()
	tool, ok := h.reg.Get(name)
	if !ok {
		h.t.Fatalf("no tool named %q", name)
	}
	if args == nil {
		args = map[string]any{}
	}
	return tool.Run(h.ctx, h.svc, p, args)
}

func (h *harness) object(name string, args map[string]any) map[string]any {
	h.t.Helper()
	out, ok := h.call(name, args).(map[string]any)
	if !ok {
		h.t.Fatalf("%s did not return an object", name)
	}
	return out
}

func (h *harness) list(name string, args map[string]any) []map[string]any {
	h.t.Helper()
	out, ok := h.call(name, args).([]map[string]any)
	if !ok {
		h.t.Fatalf("%s did not return a list", name)
	}
	return out
}

// newIssue files an issue through the tools themselves, which is what most tests want: a
// fixture-written row has no identifier counter behind it that create_issue would agree
// with, and the tests below are about the tools rather than about the fixture.
func (h *harness) newIssue(title string) map[string]any {
	h.t.Helper()
	return h.object("create_issue", map[string]any{"title": title, "team": "ENG"})
}

func str(t *testing.T, m map[string]any, key string) string {
	t.Helper()
	v, ok := m[key].(string)
	if !ok {
		t.Fatalf("key %q is %v, want a string (in %v)", key, m[key], m)
	}
	return v
}

func identifiers(rows []map[string]any) []string {
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		s, _ := r["identifier"].(string)
		out = append(out, s)
	}
	return out
}

func mustUUID(t *testing.T, raw string) uuid.UUID {
	t.Helper()
	id, err := uuid.Parse(raw)
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}
	return id
}

func ptr[T any](v T) *T { return &v }

func contains(haystack []string, want string) bool {
	for _, s := range haystack {
		if s == want {
			return true
		}
	}
	return false
}
