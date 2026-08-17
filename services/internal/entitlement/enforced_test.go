package entitlement_test

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/peixotolabs/polaris/services/internal/entitlement"
)

// Every way this package can say no has somebody asking.
//
// A refusal method is a peculiar kind of dead code: it compiles, it is exhaustively tested,
// its documentation is accurate, and none of that has any bearing on whether the product
// enforces anything. `CanAddSeat` and `CanAddTeam` sat here fully tested and with no caller
// outside this package, so a workspace on the five-seat tier could hold fifty people while
// the settings screen quoted a limit that existed only in the matrix. The unit tests were
// green throughout, because they were testing the boundary and the bug was the asking.
//
// So the check is against the domain layer's source. Crude, and the crudeness is the point:
// the question is "does any production code path invoke this", and the artefact that answers
// it is the code. An interface the domain had to satisfy would prove the method exists on
// something, not that a write path consults it.
//
// It deliberately does not check WHERE. Which write spends which limit is a product decision
// that moves; that no write spends it at all is a bug in every arrangement.
func TestEveryRefusalIsAsked(t *testing.T) {
	source := domainSource(t)

	set := reflect.TypeOf(entitlement.Set{})
	errType := reflect.TypeOf((*error)(nil)).Elem()

	found := 0
	for i := range set.NumMethod() {
		method := set.Method(i)
		// A refusal is an exported method whose last result is an error: it is asked a
		// question and answers by declining or not. Accessors — Plan, Features, SeatsUsed,
		// Lapsed, Has, Limit — describe rather than decide, and a describer with no caller
		// is unused code rather than an unenforced rule.
		signature := method.Type
		if signature.NumOut() == 0 || signature.Out(signature.NumOut()-1) != errType {
			continue
		}
		found++

		if !strings.Contains(source, "."+method.Name+"(") {
			t.Errorf("entitlement.Set.%s can refuse a caller and no code under internal/domain "+
				"ever asks it.\n\n"+
				"The rule is therefore not enforced anywhere, however well this package tests "+
				"it: the limit exists in the matrix, on the settings screen and in the pricing "+
				"page, and not in the product. Call it from the write path that spends the "+
				"thing it guards, or delete it.", method.Name)
		}
	}

	if found == 0 {
		t.Fatal("entitlement.Set has no method that returns an error any more — either the " +
			"refusals moved, in which case teach this test where, or there are none and " +
			"nothing here is enforced by anything")
	}
}

// domainSource is every .go file under internal/domain, concatenated. Tests excluded: a
// method called only by its own tests is exactly the state this exists to detect.
func domainSource(t *testing.T) string {
	t.Helper()

	const dir = "../domain"
	entries, err := os.ReadDir(dir)
	if err != nil {
		// Fatal rather than skipped. A skip is silent on the day somebody moves the domain
		// package, which is precisely when this stops holding.
		t.Fatalf("cannot read %s: %v", dir, err)
	}

	var b strings.Builder
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		content, err := os.ReadFile(filepath.Clean(filepath.Join(dir, name)))
		if err != nil {
			t.Fatalf("cannot read %s: %v", name, err)
		}
		b.Write(content)
	}
	if b.Len() == 0 {
		t.Fatal("read no domain source at all; this test would pass vacuously")
	}
	return b.String()
}

// The refusals are also required to stay classifiable, because the call sites return them
// as they come rather than wrapping them — which is what lets GraphQL present PLAN_LIMIT
// and REST answer 402 without either layer knowing about plans.
func TestARefusalUnwrapsToTheEntitlementCode(t *testing.T) {
	full := entitlement.New(entitlement.Facts{Plan: entitlement.PlanFree, SeatsUsed: 5})

	var refusal *entitlement.Error
	if !errors.As(full.CanAddSeat(), &refusal) {
		t.Fatal("a seat refusal is not an *entitlement.Error, so a client has a sentence " +
			"to string-match instead of a paywall to render")
	}
}
