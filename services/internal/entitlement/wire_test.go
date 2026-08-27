package entitlement

import (
	"encoding/json"
	"errors"
	"maps"
	"slices"
	"testing"
)

// The refusal has to survive the transport with its structure intact.
//
// Everything a paywall can say that is not the sentence — which feature, which plan lifts
// it, which ceiling was hit, whether this is a lapse — lived on the Error struct and stopped
// at Unwrap, which yields a *platform.Error carrying a code and a message and nothing else.
// A client holding only those two has exactly one way to render a specific paywall, and it
// is to string-match the message. These tests are what stop the fields going back to being
// server-side decoration.

func TestFeatureRefusalNamesThePlanThatLiftsIt(t *testing.T) {
	set := Set{plan: PlanFree, features: For(PlanFree)}
	err := set.denyFeature(FeatureSSO)

	d := err.Details()
	if d.Feature != string(FeatureSSO) {
		t.Errorf("the refusal is about %s; the wire says %q", FeatureSSO, d.Feature)
	}
	if d.NeedsPlan != string(PlanEnterprise) {
		t.Errorf("SSO is sold on %s; the wire offers %q", PlanEnterprise, d.NeedsPlan)
	}
	if d.Plan != string(PlanFree) {
		t.Errorf("the workspace is on %s; the wire says %q", PlanFree, d.Plan)
	}
	// Cap is meaningful only alongside Limit. Sent on a feature refusal it is a ceiling of
	// zero, and a client rendering "limited to 0" would be quoting a number nobody set.
	if d.Cap != nil {
		t.Errorf("a feature refusal has no ceiling, yet the wire carries cap=%d", *d.Cap)
	}
	if d.Lapsed {
		t.Error("a packaging refusal reported itself as a billing lapse, which sends a customer to the wrong screen")
	}
}

func TestLimitRefusalCarriesTheCeilingItHit(t *testing.T) {
	set := Set{plan: PlanFree, features: For(PlanFree), writeFeatures: For(PlanFree)}
	err := set.CanAddTeam(For(PlanFree).TeamLimit)

	var e *Error
	if !errors.As(err, &e) {
		t.Fatalf("adding a team past the Free cap gave %v, not an *entitlement.Error", err)
	}
	d := e.Details()
	if d.Limit != string(LimitTeams) {
		t.Errorf("the ceiling was teams; the wire says %q", d.Limit)
	}
	if d.Cap == nil || *d.Cap != For(PlanFree).TeamLimit {
		t.Errorf("the wire has to carry the ceiling that was hit, got %v", d.Cap)
	}
	if d.NeedsPlan != string(PlanPro) {
		t.Errorf("more teams are sold on %s; the wire offers %q", PlanPro, d.NeedsPlan)
	}
}

// A cap of zero is a real ceiling — a negotiated seat override can be one — so the key has
// to be present and zero rather than omitted. Omitted and zero are indistinguishable to a
// client reading JSON, and the two mean opposite things: "no ceiling was named" against
// "the ceiling is none at all".
func TestACeilingOfZeroIsSentRatherThanOmitted(t *testing.T) {
	e := &Error{Plan: PlanPro, Limit: LimitSeats, Cap: 0}

	if ext := e.Details().Extensions(); ext["cap"] != 0 {
		t.Errorf("a ceiling of zero must reach the client as cap=0, got %v", ext["cap"])
	}

	body, err := json.Marshal(e.Details())
	if err != nil {
		t.Fatalf("the details would not marshal: %v", err)
	}
	var back map[string]any
	if err := json.Unmarshal(body, &back); err != nil {
		t.Fatalf("the details would not round-trip: %v", err)
	}
	if _, present := back["cap"]; !present {
		t.Errorf("cap went missing from the REST body: %s", body)
	}
}

// The two transports must not disagree about which keys exist.
//
// GraphQL builds the map by hand and REST leans on encoding/json's omitempty. Nothing makes
// those agree except this test, and a key present in one and missing in the other is a
// client that renders a paywall on one endpoint and bare prose on the other.
func TestBothTransportsSendTheSameKeys(t *testing.T) {
	cases := map[string]*Error{
		"feature":  {Plan: PlanFree, Feature: FeatureSSO, NeedsPlan: PlanEnterprise},
		"limit":    {Plan: PlanFree, Limit: LimitSeats, Cap: 5, NeedsPlan: PlanPro},
		"lapse":    {Plan: PlanPro, Feature: FeatureSLAs, Lapsed: true},
		"override": {Plan: PlanEnterprise, Limit: LimitSeats, Cap: 3},
		"empty":    {},
	}

	for name, e := range cases {
		t.Run(name, func(t *testing.T) {
			details := e.Details()

			body, err := json.Marshal(details)
			if err != nil {
				t.Fatalf("the details would not marshal: %v", err)
			}
			var rest map[string]any
			if err := json.Unmarshal(body, &rest); err != nil {
				t.Fatalf("the details would not round-trip: %v", err)
			}

			gql := slices.Sorted(maps.Keys(details.Extensions()))
			wire := slices.Sorted(maps.Keys(rest))
			if !slices.Equal(gql, wire) {
				t.Errorf("GraphQL sends %v and REST sends %v; one client has to read both", gql, wire)
			}
		})
	}
}
