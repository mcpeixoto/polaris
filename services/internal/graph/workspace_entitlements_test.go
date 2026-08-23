package graph

import (
	"testing"
)

// The query every administration screen opens with, executed the way the api process
// executes it.
//
// It went through the executor rather than calling the resolver directly on purpose: the
// defect was not in a resolver at all but in a field nothing filled, and a direct call
// hands back a struct whose nil `Entitlements` looks like a field the caller did not ask
// for. gqlgen is what turns that nil into "the requested element is null which the schema
// does not allow", fails the whole `workspace` field, and answers `data: null` — so the
// executor is the only place the bug exists.
//
// What the client does with that answer is the reason it matters. `useEntitlements` treats
// an unanswerable matrix as unknown rather than denied, deliberately, because guessing "no"
// would lock people out of features they pay for. The cost of guessing "yes" is what shipped
// instead: SLAs, private teams, sub-teams, SSO and the audit log rendered as available on
// every plan, and a Free workspace found out only from the error its first write returned.
func TestWorkspace_AnswersWhatThePlanPermits(t *testing.T) {
	h := newHarness(t)

	body := h.execute(t, `
		query Entitlements {
			workspace {
				plan
				seatLimit
				planLapsedAt
				entitlements {
					plan
					seatsUsed
					seatLimit
					teamLimit
					privateTeams
					slas
					sso
					auditLog
					lapsed
				}
			}
		}`, nil)

	if errs, ok := body["errors"]; ok {
		t.Fatalf("the entitlements query failed: %v", errs)
	}
	data, _ := body["data"].(map[string]any)
	workspace, _ := data["workspace"].(map[string]any)
	if workspace == nil {
		t.Fatalf("the query answered with no workspace: %v", data)
	}

	entitlements, _ := workspace["entitlements"].(map[string]any)
	if entitlements == nil {
		t.Fatalf("workspace.entitlements came back empty: %v", workspace)
	}

	// The fixture's workspace is on whatever POLARIS_DEFAULT_PLAN mints, and the assertion
	// is not which plan that is: it is that the answer describes the same plan the workspace
	// column holds, because a matrix resolved against a different plan than the one on
	// screen is worse than no matrix at all.
	if entitlements["plan"] != workspace["plan"] {
		t.Errorf("the matrix answered for plan %v while the workspace is on %v",
			entitlements["plan"], workspace["plan"])
	}
	// One seat: the fixture's admin. The count is the product's single seat query, and a
	// screen quoting "0 of 5 seats" on a workspace with a person in it is the symptom that
	// this is being answered from somewhere else.
	if seats, _ := entitlements["seatsUsed"].(float64); seats != 1 {
		t.Errorf("seatsUsed came back as %v; the fixture's workspace holds exactly one person",
			entitlements["seatsUsed"])
	}
	// Booleans, not nulls. A gate the client reads as `undefined` is a gate it does not draw.
	for _, feature := range []string{"privateTeams", "slas", "sso", "auditLog", "lapsed"} {
		if _, ok := entitlements[feature].(bool); !ok {
			t.Errorf("%s came back as %v rather than a boolean", feature, entitlements[feature])
		}
	}
}
