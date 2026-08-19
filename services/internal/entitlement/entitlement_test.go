package entitlement

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// These tests are the matrix's specification. The package has no database and no clock, so
// there is nothing here that cannot be asserted exactly — which is the point of keeping
// the packaging decision in Go: it is the one part of billing that can be proved before a
// customer meets it.

var lapsedAt = func() *time.Time { t := time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC); return &t }()

func intp(n int) *int { return &n }

// ---------------------------------------------------------------------- the API contract

// The Entitlements type in schema/schema.graphql is the public contract and Features is
// what fills most of it in. A field added to one and not the other is either an API field
// resolved from a hardcoded value, or a policy decision nothing can read — and both are
// discovered by a customer rather than by us.
//
// The check is by name and in both directions, because either direction of drift is a bug.
func TestFeatures_MatchesTheGraphQLContract(t *testing.T) {
	// Every field on the GraphQL type, mapped to the Features field that answers it. The
	// three empty ones are the facts the matrix cannot know: Set answers them from the
	// workspace's own row.
	answeredBy := map[string]string{
		"plan":         "",
		"seatsUsed":    "",
		"lapsed":       "",
		"seatLimit":    "SeatLimit",
		"teamLimit":    "TeamLimit",
		"historyDays":  "HistoryDays",
		"privateTeams": "PrivateTeams",
		"customViews":  "CustomViews",
		"apiKeys":      "APIKeys",
		"sso":          "SSO",
		"auditLog":     "AuditLog",
	}

	path := filepath.Join("..", "..", "..", "schema", "schema.graphql")
	src, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("the schema is the contract this package implements and it must be readable: %v", err)
	}

	onWire := graphQLFieldNames(t, string(src), "Entitlements")
	if len(onWire) == 0 {
		t.Fatal("found no fields on type Entitlements: the parser below stopped working, so this test can no longer fail")
	}

	for _, name := range onWire {
		goField, known := answeredBy[name]
		if !known {
			t.Errorf("Entitlements.%s is on the wire and nothing in this package answers it", name)
			continue
		}
		if goField == "" {
			continue
		}
		if _, ok := reflect.TypeOf(Features{}).FieldByName(goField); !ok {
			t.Errorf("Entitlements.%s claims to be answered by Features.%s, which does not exist", name, goField)
		}
	}

	present := make(map[string]bool, len(onWire))
	for _, name := range onWire {
		present[name] = true
	}
	for name := range answeredBy {
		if !present[name] {
			t.Errorf("this package answers %q, which the schema no longer has", name)
		}
	}

	// And no field on Features that the wire cannot carry: policy the API cannot report is
	// policy nobody can explain to the customer it applied to.
	ft := reflect.TypeOf(Features{})
	for i := range ft.NumField() {
		found := false
		for _, goField := range answeredBy {
			if goField == ft.Field(i).Name {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Features.%s has no field on the GraphQL Entitlements type", ft.Field(i).Name)
		}
	}
}

// graphQLFieldNames pulls the field names out of one type block. Deliberately a small
// scanner rather than a schema parser: this test must fail when the contract moves, not
// when a dependency does.
func graphQLFieldNames(t *testing.T, src, typeName string) []string {
	t.Helper()

	_, after, found := strings.Cut(src, "type "+typeName+" {")
	if !found {
		t.Fatalf("type %s is not in the schema any more", typeName)
	}
	body, _, _ := strings.Cut(after, "\n}")

	var names []string
	inDoc := false
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case inDoc:
			if strings.Contains(line, `"""`) {
				inDoc = false
			}
		case line == "" || strings.HasPrefix(line, "#"):
		case strings.HasPrefix(line, `"""`):
			// A docstring that opens and closes on one line is already finished.
			if strings.Count(line, `"""`) == 1 {
				inDoc = true
			}
		default:
			if name, _, ok := strings.Cut(line, ":"); ok {
				names = append(names, strings.TrimSpace(name))
			}
		}
	}
	return names
}

// ---------------------------------------------------------------------------- the matrix

func TestFor_EveryPlan(t *testing.T) {
	tests := []struct {
		name string
		plan Plan
		want Features
	}{
		{
			name: "free is capped but not crippled",
			plan: PlanFree,
			want: Features{
				SeatLimit: 5, TeamLimit: 2, HistoryDays: 90,
				PrivateTeams: false, CustomViews: true, APIKeys: true,
				SSO: false, AuditLog: false,
			},
		},
		{
			name: "pro lifts the caps and nothing else",
			plan: PlanPro,
			want: Features{
				SeatLimit: Unlimited, TeamLimit: Unlimited, HistoryDays: Unlimited,
				PrivateTeams: true, CustomViews: true, APIKeys: true,
				SSO: false, AuditLog: false,
			},
		},
		{
			name: "enterprise adds the two compliance features",
			plan: PlanEnterprise,
			want: Features{
				SeatLimit: Unlimited, TeamLimit: Unlimited, HistoryDays: Unlimited,
				PrivateTeams: true, CustomViews: true, APIKeys: true,
				SSO: true, AuditLog: true,
			},
		},
		{
			// Unlimited seats is the claim that makes this open source rather than a
			// trial, and the ee features are false because that code is not in the build.
			name: "self-hosted core is unlimited and has no ee features",
			plan: PlanSelfHosted,
			want: Features{
				SeatLimit: Unlimited, TeamLimit: Unlimited, HistoryDays: Unlimited,
				PrivateTeams: true, CustomViews: true, APIKeys: true,
				SSO: false, AuditLog: false,
			},
		},
		{
			name: "an unrecognised plan falls back to free, never upwards",
			plan: Plan("platinum"),
			want: matrix[PlanFree],
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := For(tc.plan); got != tc.want {
				t.Errorf("For(%q):\n got  %+v\n want %+v", tc.plan, got, tc.want)
			}
		})
	}
}

// A plan added to AllPlans but not to the matrix would silently resolve to Free for every
// workspace that bought it, which is a refund rather than a bug report.
func TestMatrix_CoversEveryPlan(t *testing.T) {
	if len(AllPlans) != 4 {
		t.Fatalf("AllPlans has %d entries: add the new plan to the matrix, then update this count", len(AllPlans))
	}
	for _, p := range AllPlans {
		if _, ok := matrix[p]; !ok {
			t.Errorf("plan %q has no row in the matrix", p)
		}
		if !p.Valid() {
			t.Errorf("plan %q is listed in AllPlans but Valid() rejects it", p)
		}
	}
	if len(matrix) != len(AllPlans) {
		t.Errorf("the matrix has %d rows and AllPlans has %d: one of them was edited alone", len(matrix), len(AllPlans))
	}
}

// A Feature constant that has() does not answer is denied through the default branch, and
// the symptom is a customer paying for something the code has never heard of.
func TestFeatures_EveryFeatureIsClassified(t *testing.T) {
	if len(AllFeatures) != 5 {
		t.Fatalf("AllFeatures has %d entries: classify the new one in has(), then update this count", len(AllFeatures))
	}
	for _, f := range AllFeatures {
		if _, known := matrix[PlanEnterprise].has(f); !known {
			t.Errorf("feature %q is not answered by Features.has", f)
		}
		if f.Label() == string(f) {
			t.Errorf("feature %q has no human label, so its paywall message reads like a database value", f)
		}
	}
	for _, k := range AllLimits {
		if _, known := matrix[PlanFree].limit(k); !known {
			t.Errorf("limit %q is not answered by Features.limit", k)
		}
	}
}

// narrow is written field by field, so a field added to Features and forgotten there would
// silently become false or 0 for every lapsed workspace. Narrowing a set against itself
// must be a no-op; a forgotten field shows up as a zero value.
func TestFeatures_NarrowCoversEveryField(t *testing.T) {
	var permissive Features
	v := reflect.ValueOf(&permissive).Elem()
	for i := range v.NumField() {
		switch f := v.Field(i); f.Kind() {
		case reflect.Bool:
			f.SetBool(true)
		case reflect.Int:
			f.SetInt(7)
		default:
			t.Fatalf("Features.%s is a %s: teach this test and narrow() about it",
				v.Type().Field(i).Name, f.Kind())
		}
	}

	if got := permissive.narrow(permissive); got != permissive {
		t.Errorf("narrow() dropped a field:\n got  %+v\n want %+v", got, permissive)
	}
}

func TestFeatures_NarrowTakesTheSmaller(t *testing.T) {
	free, ent := For(PlanFree), For(PlanEnterprise)

	got := ent.narrow(free)
	if got.SeatLimit != 5 || got.TeamLimit != 2 || got.HistoryDays != 90 {
		t.Errorf("unlimited narrowed by a number must give the number: %+v", got)
	}
	if got.SSO || got.AuditLog {
		t.Errorf("a paid feature must not survive narrowing to free: %+v", got)
	}
	if !got.CustomViews || !got.APIKeys {
		t.Errorf("a feature both sides have must survive narrowing: %+v", got)
	}
	if got.PrivateTeams {
		t.Errorf("private teams on free must not survive narrowing from enterprise: %+v", got)
	}
	if free.narrow(ent) != got {
		t.Error("narrow must not depend on the order of its arguments")
	}
}

// ------------------------------------------------------------------------------ features

func TestAllow_EveryPlanEveryFeature(t *testing.T) {
	tests := []struct {
		plan  Plan
		allow []Feature
		deny  []Feature
	}{
		{
			// Custom views and API keys stay free; private teams are Business+.
			plan:  PlanFree,
			allow: []Feature{FeatureCustomViews, FeatureAPIKeys},
			deny:  []Feature{FeaturePrivateTeams, FeatureSSO, FeatureAuditLog},
		},
		{
			plan:  PlanPro,
			allow: []Feature{FeaturePrivateTeams, FeatureCustomViews, FeatureAPIKeys},
			deny:  []Feature{FeatureSSO, FeatureAuditLog},
		},
		{
			plan:  PlanEnterprise,
			allow: AllFeatures,
			deny:  nil,
		},
		{
			plan:  PlanSelfHosted,
			allow: []Feature{FeaturePrivateTeams, FeatureCustomViews, FeatureAPIKeys},
			deny:  []Feature{FeatureSSO, FeatureAuditLog},
		},
	}

	for _, tc := range tests {
		t.Run(string(tc.plan), func(t *testing.T) {
			s := New(Facts{Plan: tc.plan})
			for _, f := range tc.allow {
				if err := s.Allow(f); err != nil {
					t.Errorf("%s must allow %s: %v", tc.plan, f, err)
				}
				if !s.Has(f) {
					t.Errorf("%s must report Has(%s)", tc.plan, f)
				}
			}
			for _, f := range tc.deny {
				if err := s.Allow(f); err == nil {
					t.Errorf("%s must deny %s", tc.plan, f)
				}
				if s.Has(f) {
					t.Errorf("%s must not report Has(%s)", tc.plan, f)
				}
			}
		})
	}
}

// A Feature constant nobody added to the matrix must be denied, not allowed. Failing open
// here is a feature given away silently; failing closed is a bug report.
func TestAllow_UnknownFeatureIsDenied(t *testing.T) {
	s := New(Facts{Plan: PlanEnterprise})
	if err := s.Allow(Feature("time_travel")); err == nil {
		t.Fatal("an unknown feature must be denied even on the top plan")
	}
}

func TestAllow_ErrorNamesThePlanNeeded(t *testing.T) {
	s := New(Facts{Plan: PlanFree})

	err := s.Allow(FeatureSSO)
	var e *Error
	if !errors.As(err, &e) {
		t.Fatalf("a refusal must be an *entitlement.Error, got %T", err)
	}
	if e.NeedsPlan != PlanEnterprise {
		t.Errorf("SSO needs %s, the error says %q", PlanEnterprise, e.NeedsPlan)
	}
	if e.Feature != FeatureSSO || e.Lapsed {
		t.Errorf("unexpected error shape: %+v", e)
	}
	if !strings.Contains(e.Message, "Enterprise") {
		t.Errorf("the message must name the plan needed: %q", e.Message)
	}

	// Both transports classify entitlement refusals without a conversion at the call site:
	// GraphQL presents PLAN_LIMIT, the REST handlers answer 402. If this stops holding,
	// every paywall silently becomes an internal error.
	if code := platform.CodeOf(err); code != platform.CodeEntitlement {
		t.Errorf("a refusal must classify as %s, got %s", platform.CodeEntitlement, code)
	}
	var perr *platform.Error
	if !errors.As(err, &perr) || perr.Message != e.Message {
		t.Errorf("the wrapped platform error must carry the same user-facing message: %+v", perr)
	}
}

// A self-hosted install has no billing screen. Sending its operator to one is the kind of
// message that gets screenshotted.
func TestAllow_SelfHostedIsToldAboutALicence(t *testing.T) {
	err := New(Facts{Plan: PlanSelfHosted}).Allow(FeatureAuditLog)
	if err == nil {
		t.Fatal("self-hosted core must deny the audit log")
	}
	if !strings.Contains(err.Error(), "licence") {
		t.Errorf("a self-hosted refusal must name a licence, not a plan: %q", err)
	}
}

// An unrecognised plan or feature is our bug, and the customer who meets it should not be
// shown the evidence. The refusal still has to be a sentence they can act on.
func TestDenials_NeverEchoAnUnrecognisedValue(t *testing.T) {
	feature := New(Facts{Plan: Plan("platinum")}).Allow(FeatureSSO)
	if feature == nil {
		t.Fatal("an unrecognised plan resolves to free, which has no SSO")
	}
	if strings.Contains(feature.Error(), "platinum") {
		t.Errorf("the message names a plan the customer cannot have read anywhere: %q", feature)
	}
	if !strings.Contains(feature.Error(), "Enterprise") {
		t.Errorf("the message must still say what would permit it: %q", feature)
	}

	seat := New(Facts{Plan: Plan("platinum"), SeatsUsed: 5}).CanAddSeat()
	if seat == nil {
		t.Fatal("an unrecognised plan gets the free seat cap")
	}
	if strings.Contains(seat.Error(), "platinum") {
		t.Errorf("the message names a plan the customer cannot have read anywhere: %q", seat)
	}

	var e *Error
	if !errors.As(New(Facts{Plan: PlanEnterprise}).Allow(Feature("time_travel")), &e) {
		t.Fatal("expected an *entitlement.Error")
	}
	if e.NeedsPlan != "" {
		t.Errorf("no plan sells a feature that does not exist, yet the error offers %q", e.NeedsPlan)
	}
	if strings.Contains(e.Message, "time_travel") {
		t.Errorf("the message shows the customer a constant out of our source: %q", e.Message)
	}

	// A lapsed workspace on an unrecognised plan must not have that value read back to it
	// either: the lapse messages are the ones that name the plan.
	lapsedUnknown := New(Facts{Plan: Plan("platinum"), PlanLapsedAt: lapsedAt, SeatsUsed: 5})
	if err := lapsedUnknown.CanAddSeat(); err == nil {
		t.Error("an unrecognised plan gets the free seat cap")
	} else if strings.Contains(err.Error(), "platinum") {
		t.Errorf("the message names a plan the customer cannot have read anywhere: %q", err)
	}
	if err := lapsedUnknown.CanAddTeam(2); err == nil {
		t.Error("an unrecognised plan gets the free team cap")
	} else if strings.Contains(err.Error(), "platinum") {
		t.Errorf("the message names a plan the customer cannot have read anywhere: %q", err)
	}
}

// -------------------------------------------------------------------------- the lapsed case

func TestLapsed_ReadsSurviveAndGatedWritesDoNot(t *testing.T) {
	s := New(Facts{Plan: PlanEnterprise, PlanLapsedAt: lapsedAt, SeatsUsed: 40})

	if !s.Lapsed() {
		t.Fatal("a paid plan with plan_lapsed_at set is lapsed")
	}

	// The read side is untouched: the plan still says what it always said, so the client
	// shows the entitlement alongside the lapse rather than pretending the features never
	// existed, and an existing audit log stays readable.
	if s.Features() != For(PlanEnterprise) {
		t.Errorf("a lapse must not change what the plan entitles: %+v", s.Features())
	}
	if !s.Has(FeatureAuditLog) || !s.Has(FeatureSSO) {
		t.Error("Has is the read-side answer and must ignore the lapse")
	}
	if n, ok := s.Limit(LimitHistoryDays); ok || n != Unlimited {
		t.Errorf("the history window is a read: it must not narrow on a lapse, got (%d, %v)", n, ok)
	}

	// The write side falls back to Free.
	if err := s.Allow(FeatureAuditLog); err == nil {
		t.Error("a gated write must be refused while lapsed")
	}
	if err := s.Allow(FeatureAPIKeys); err != nil {
		t.Errorf("a feature free on every plan must survive a lapse: %v", err)
	}
	if err := s.CanAddSeat(); err == nil {
		t.Error("40 members is above the free cap: no more seats while lapsed")
	}
}

// Read-only above the free caps, fully usable below them. A three-person workspace whose
// card failed carries on working; it has not exceeded anything it would be given for free.
func TestLapsed_DegradesToFreeRatherThanLockingOut(t *testing.T) {
	small := New(Facts{Plan: PlanPro, PlanLapsedAt: lapsedAt, SeatsUsed: 3})
	if err := small.CanAddSeat(); err != nil {
		t.Errorf("under the free cap a lapsed workspace still works: %v", err)
	}
	if err := small.CanAddTeam(1); err != nil {
		t.Errorf("under the free team cap a lapsed workspace still works: %v", err)
	}
	if err := small.CanAddTeam(2); err == nil {
		t.Error("above the free team cap a lapsed workspace must be refused")
	}
}

func TestLapsed_ErrorSaysBillingRatherThanUpgrade(t *testing.T) {
	s := New(Facts{Plan: PlanEnterprise, PlanLapsedAt: lapsedAt, SeatsUsed: 40})

	var e *Error
	if !errors.As(s.Allow(FeatureSSO), &e) {
		t.Fatal("expected an *entitlement.Error")
	}
	if !e.Lapsed || e.NeedsPlan != "" {
		t.Errorf("a lapse is not an upsell: %+v", e)
	}
	if !strings.Contains(e.Message, "lapsed") || !strings.Contains(e.Message, "billing") {
		t.Errorf("the message must point at billing: %q", e.Message)
	}
	// Somebody whose card failed is exactly the person who needs telling their work is
	// still there.
	if !strings.Contains(e.Message, "still readable") {
		t.Errorf("the message must say the data is intact: %q", e.Message)
	}

	if !errors.As(s.CanAddSeat(), &e) {
		t.Fatal("expected an *entitlement.Error")
	}
	if !e.Lapsed || e.Cap != 5 {
		t.Errorf("a lapsed seat refusal is capped at the free tier: %+v", e)
	}
}

// A lapse is only the reason for a refusal when paying would lift it. An Enterprise
// workspace with a negotiated cap of three, sitting at three, is refused whether or not
// billing is current — so telling it that billing is what stands in the way promises a fix
// that settling the invoice does not deliver, and sends it to the wrong screen to get it.
func TestLapsed_DoesNotTakeTheBlameForACeilingItDidNotCause(t *testing.T) {
	var e *Error
	if !errors.As(New(Facts{
		Plan: PlanEnterprise, PlanLapsedAt: lapsedAt, SeatLimit: intp(3), SeatsUsed: 3,
	}).CanAddSeat(), &e) {
		t.Fatal("expected an *entitlement.Error")
	}
	if e.Lapsed {
		t.Errorf("the override refuses this on its own, so the lapse must not be blamed: %+v", e)
	}
	if strings.Contains(e.Message, "billing") || strings.Contains(e.Message, "lapsed") {
		t.Errorf("the message sends a paying customer to a screen that will not help: %q", e.Message)
	}
	if e.Cap != 3 {
		t.Errorf("the ceiling that was hit is the override, got %d", e.Cap)
	}

	// The other direction still has to work: an unlimited plan refused only because it fell
	// back to the free cap is a lapse, and must say so.
	if !errors.As(New(Facts{Plan: PlanPro, PlanLapsedAt: lapsedAt, SeatsUsed: 5}).CanAddSeat(), &e) {
		t.Fatal("expected an *entitlement.Error")
	}
	if !e.Lapsed || e.Cap != 5 {
		t.Errorf("this refusal exists only because of the lapse: %+v", e)
	}
}

// A free workspace has nothing to fail to pay for. Honouring a stray flag would take it
// below the tier it already gets for nothing.
func TestLapsed_IgnoredOnFree(t *testing.T) {
	s := New(Facts{Plan: PlanFree, PlanLapsedAt: lapsedAt, SeatsUsed: 4})
	if s.Lapsed() {
		t.Error("a free plan cannot lapse")
	}
	if err := s.CanAddSeat(); err != nil {
		t.Errorf("a free workspace under its cap must still add its fifth member: %v", err)
	}
}

// The invariant that makes the lapsed rule safe to reason about: it can only ever take
// something away. Anything else and a workspace could gain by not paying.
func TestLapsed_NeverGrants(t *testing.T) {
	for _, p := range AllPlans {
		for _, override := range []*int{nil, intp(1), intp(500)} {
			live := New(Facts{Plan: p, SeatLimit: override})
			dead := New(Facts{Plan: p, PlanLapsedAt: lapsedAt, SeatLimit: override})

			for _, f := range AllFeatures {
				lapsedOK := dead.Allow(f) == nil
				liveOK := live.Allow(f) == nil
				if lapsedOK && !liveOK {
					t.Errorf("%s: lapsing granted %s", p, f)
				}
			}
			for _, k := range AllLimits {
				a, _ := live.writeFeatures.limit(k)
				b, _ := dead.writeFeatures.limit(k)
				if a != Unlimited && (b == Unlimited || b > a) {
					t.Errorf("%s: lapsing raised %s from %d to %d", p, k, a, b)
				}
			}
		}
	}
}

// ------------------------------------------------------------------------ the seat limit

// The boundary. Off by one in one direction and a customer cannot add the fifth person
// they are entitled to; in the other, everybody gets a sixth seat free.
func TestCanAddSeat_Boundary(t *testing.T) {
	tests := []struct {
		name      string
		facts     Facts
		wantAllow bool
	}{
		{"free, three used, room to spare", Facts{Plan: PlanFree, SeatsUsed: 3}, true},
		{"free, four used, the fifth member fits", Facts{Plan: PlanFree, SeatsUsed: 4}, true},
		{"free, exactly at the limit", Facts{Plan: PlanFree, SeatsUsed: 5}, false},
		{"free, somehow over the limit", Facts{Plan: PlanFree, SeatsUsed: 6}, false},
		{"free, empty workspace", Facts{Plan: PlanFree, SeatsUsed: 0}, true},

		{"pro is unlimited", Facts{Plan: PlanPro, SeatsUsed: 5_000}, true},
		{"enterprise is unlimited", Facts{Plan: PlanEnterprise, SeatsUsed: 5_000}, true},
		{"self-hosted is unlimited", Facts{Plan: PlanSelfHosted, SeatsUsed: 5_000}, true},

		{"an override of one, empty", Facts{Plan: PlanFree, SeatLimit: intp(1), SeatsUsed: 0}, true},
		{"an override of one, at the limit", Facts{Plan: PlanFree, SeatLimit: intp(1), SeatsUsed: 1}, false},
		{"an override below the limit", Facts{Plan: PlanFree, SeatLimit: intp(2), SeatsUsed: 2}, false},
		{"an override above the limit", Facts{Plan: PlanFree, SeatLimit: intp(12), SeatsUsed: 11}, true},
		{"an override above the limit, at it", Facts{Plan: PlanFree, SeatLimit: intp(12), SeatsUsed: 12}, false},
		{"an override caps an unlimited plan", Facts{Plan: PlanEnterprise, SeatLimit: intp(200), SeatsUsed: 200}, false},
		{"an override caps an unlimited plan, under it", Facts{Plan: PlanEnterprise, SeatLimit: intp(200), SeatsUsed: 199}, true},

		{"lapsed pro falls back to the free cap", Facts{Plan: PlanPro, PlanLapsedAt: lapsedAt, SeatsUsed: 5}, false},
		{"lapsed pro under the free cap", Facts{Plan: PlanPro, PlanLapsedAt: lapsedAt, SeatsUsed: 4}, true},
		{
			"a lapse does not raise a lower override",
			Facts{Plan: PlanEnterprise, PlanLapsedAt: lapsedAt, SeatLimit: intp(3), SeatsUsed: 3},
			false,
		},
		{
			"a lapse ignores an override above the free cap",
			Facts{Plan: PlanEnterprise, PlanLapsedAt: lapsedAt, SeatLimit: intp(200), SeatsUsed: 5},
			false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := New(tc.facts).CanAddSeat()
			if tc.wantAllow && err != nil {
				t.Errorf("a seat must fit here: %v", err)
			}
			if !tc.wantAllow && err == nil {
				t.Error("a seat must not fit here")
			}
		})
	}
}

func TestSeatOverride_ReplacesThePlansNumber(t *testing.T) {
	// Both directions and on every plan: an override is how a design partner gets twelve
	// seats on Free, and how a capped deal gets fewer than Enterprise's unlimited.
	if got := New(Facts{Plan: PlanFree, SeatLimit: intp(12)}).Features().SeatLimit; got != 12 {
		t.Errorf("an override must raise the free cap, got %d", got)
	}
	if got := New(Facts{Plan: PlanEnterprise, SeatLimit: intp(200)}).Features().SeatLimit; got != 200 {
		t.Errorf("an override must cap an unlimited plan, got %d", got)
	}
	if n, ok := New(Facts{Plan: PlanPro, SeatLimit: intp(200)}).Limit(LimitSeats); !ok || n != 200 {
		t.Errorf("Limit must report the override, got (%d, %v)", n, ok)
	}

	// The database forbids a non-positive seat_limit. If one arrives anyway it came from a
	// caller that did not read the column, and locking a workspace out of every seat over
	// it is worse than falling back to the plan.
	for _, bad := range []*int{intp(0), intp(-1)} {
		s := New(Facts{Plan: PlanFree, SeatLimit: bad, SeatsUsed: 0})
		if s.Features().SeatLimit != 5 {
			t.Errorf("a non-positive override must be ignored, got %d", s.Features().SeatLimit)
		}
		if err := s.CanAddSeat(); err != nil {
			t.Errorf("a non-positive override must not lock the workspace out: %v", err)
		}
	}
}

// No upgrade lifts a number somebody wrote by hand, so the refusal must not offer one.
func TestSeatOverride_RefusalDoesNotOfferAnUpgrade(t *testing.T) {
	var e *Error
	if !errors.As(New(Facts{Plan: PlanFree, SeatLimit: intp(12), SeatsUsed: 12}).CanAddSeat(), &e) {
		t.Fatal("expected an *entitlement.Error")
	}
	if e.NeedsPlan != "" {
		t.Errorf("an override is not lifted by upgrading, yet the error suggests %q", e.NeedsPlan)
	}
	if e.Cap != 12 || e.Limit != LimitSeats {
		t.Errorf("unexpected error shape: %+v", e)
	}
	if strings.Contains(e.Message, "Upgrade") {
		t.Errorf("the message must not offer an upgrade that changes nothing: %q", e.Message)
	}
}

func TestCanAddSeat_FreeRefusalPointsAtPro(t *testing.T) {
	var e *Error
	if !errors.As(New(Facts{Plan: PlanFree, SeatsUsed: 5}).CanAddSeat(), &e) {
		t.Fatal("expected an *entitlement.Error")
	}
	if e.NeedsPlan != PlanPro || e.Cap != 5 {
		t.Errorf("unexpected error shape: %+v", e)
	}
	if !strings.Contains(e.Message, "Pro") || !strings.Contains(e.Message, "5") {
		t.Errorf("the message must name the plan and the cap: %q", e.Message)
	}
	if platform.CodeOf(e) != platform.CodeEntitlement {
		t.Errorf("a seat refusal must classify as %s", platform.CodeEntitlement)
	}
}

// ----------------------------------------------------------------------- the other limits

func TestCanAddTeam_Boundary(t *testing.T) {
	tests := []struct {
		name      string
		plan      Plan
		current   int
		wantAllow bool
	}{
		{"free, none yet", PlanFree, 0, true},
		{"free, one team, the second fits", PlanFree, 1, true},
		{"free, exactly at the limit", PlanFree, 2, false},
		{"free, over the limit", PlanFree, 3, false},
		{"pro is unlimited", PlanPro, 200, true},
		{"enterprise is unlimited", PlanEnterprise, 200, true},
		{"self-hosted is unlimited", PlanSelfHosted, 200, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := New(Facts{Plan: tc.plan}).CanAddTeam(tc.current)
			if tc.wantAllow && err != nil {
				t.Errorf("a team must fit here: %v", err)
			}
			if !tc.wantAllow && err == nil {
				t.Error("a team must not fit here")
			}
		})
	}
}

func TestLimit_ReportsTheCeilingAndWhetherThereIsOne(t *testing.T) {
	tests := []struct {
		plan    Plan
		kind    LimitKind
		wantN   int
		wantSet bool
	}{
		{PlanFree, LimitSeats, 5, true},
		{PlanFree, LimitTeams, 2, true},
		{PlanFree, LimitHistoryDays, 90, true},
		{PlanPro, LimitSeats, Unlimited, false},
		{PlanPro, LimitTeams, Unlimited, false},
		{PlanPro, LimitHistoryDays, Unlimited, false},
		{PlanEnterprise, LimitSeats, Unlimited, false},
		{PlanSelfHosted, LimitHistoryDays, Unlimited, false},
	}

	for _, tc := range tests {
		t.Run(string(tc.plan)+"/"+string(tc.kind), func(t *testing.T) {
			n, ok := New(Facts{Plan: tc.plan}).Limit(tc.kind)
			if n != tc.wantN || ok != tc.wantSet {
				t.Errorf("got (%d, %v), want (%d, %v)", n, ok, tc.wantN, tc.wantSet)
			}
		})
	}
}

// Both unusable answers deny rather than grant when a caller drops the second return
// value: a rule that wrongly blocks is reported within the hour, one that wrongly grants
// is never reported at all.
func TestLimit_FailsClosed(t *testing.T) {
	s := New(Facts{Plan: PlanPro})

	if n, _ := s.Limit(LimitSeats); n != Unlimited {
		t.Errorf("an unlimited plan must report the sentinel, not 0: got %d", n)
	}
	if n, ok := s.Limit(LimitKind("attachments")); n != 0 || !ok {
		t.Errorf("an unknown limit kind must read as a ceiling of nothing, got (%d, %v)", n, ok)
	}
}

// ------------------------------------------------------------------------------ the facts

func TestSet_ReportsTheFactsItWasGiven(t *testing.T) {
	s := New(Facts{Plan: Plan("platinum"), SeatsUsed: 7})

	// The raw column value is returned unchanged, even though the features resolved to
	// Free, so that a log line says what was actually there rather than what we guessed.
	if s.Plan() != Plan("platinum") {
		t.Errorf("Plan must not normalise, got %q", s.Plan())
	}
	if s.SeatsUsed() != 7 {
		t.Errorf("SeatsUsed must round-trip, got %d", s.SeatsUsed())
	}
	if s.Features() != For(PlanFree) {
		t.Errorf("an unrecognised plan must resolve to free features, got %+v", s.Features())
	}
	if s.Lapsed() {
		t.Error("no plan_lapsed_at means not lapsed")
	}
}
