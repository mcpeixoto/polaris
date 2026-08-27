// Package entitlement answers "may this workspace do X", in one place.
//
// Gating touches roughly forty features. The alternative to this package is an
// `if plan == "pro"` at each of them, which is unmaintainable for the obvious reason and
// for a worse one: every one of those checks is written on the day gating ships and none
// of them is ever read again, so "what does Free actually include" stops being answerable
// from the code and starts being answerable only by grepping.
//
// The feature matrix is Go and not data, for the reason migration
// 000016_api_keys_and_plans.up.sql gives: which plan may use which feature changes with a
// release, not with data. In the database, adding a feature would need a data migration in
// every self-hosted install, and a mistake in the matrix would be a production data fix
// rather than a revert.
//
// The package imports nothing from internal/store or internal/domain on purpose. It is
// pure policy over values it is handed, so resolvers, jobs, the sync hub and the ee licence
// path all ask the same question without any of them owning the answer, and so the whole
// matrix is testable without a database.
package entitlement

import (
	"fmt"
	"time"

	"github.com/peixotolabs/polaris/services/internal/platform"
)

// Plan is the workspace's packaging. The values match the workspace_plan_check constraint
// in migration 000003, because this type is constructed by converting that column.
type Plan string

const (
	PlanFree       Plan = "free"
	PlanPro        Plan = "pro"
	PlanEnterprise Plan = "enterprise"
	// PlanSelfHosted is an install someone runs themselves under the AGPL, with no licence
	// key. It is unlimited on everything the core does, and false for the two ee features,
	// because that code is compiled out by the `ee` build tag: a self-hosted core build
	// that claimed SSO would be advertising a code path the binary does not contain.
	//
	// A self-host that *has* bought a licence key resolves to PlanEnterprise. One row
	// grants the ee features, whether the money arrived through Stripe or a licence,
	// rather than two rows that drift apart the first time one of them is edited.
	PlanSelfHosted Plan = "self_hosted"
)

// AllPlans exists so a test can assert every plan has a row in the matrix. Go cannot
// enumerate constants, so a plan added without being listed here is invisible to that
// test — which is why the test also asserts the count, forcing whoever adds one to come
// back to this list instead of shipping a plan that silently resolves to Free.
var AllPlans = []Plan{PlanFree, PlanPro, PlanEnterprise, PlanSelfHosted}

// upgradePath is the cloud ladder, cheapest first, and it is what an upsell message is
// allowed to name. PlanSelfHosted is deliberately absent: it is not something a cloud
// workspace can buy, and offering it in a paywall would be nonsense.
var upgradePath = []Plan{PlanFree, PlanPro, PlanEnterprise}

func (p Plan) Valid() bool {
	switch p {
	case PlanFree, PlanPro, PlanEnterprise, PlanSelfHosted:
		return true
	}
	return false
}

// Label is the plan's name as a person reads it. The column value is lowercase and
// snake_cased; capitalising it at each call site produces "Self_hosted" in a message a
// customer sees.
func (p Plan) Label() string {
	switch p {
	case PlanFree:
		return "Free"
	case PlanPro:
		return "Pro"
	case PlanEnterprise:
		return "Enterprise"
	case PlanSelfHosted:
		return "self-hosted"
	}
	return string(p)
}

// rank orders the cloud ladder so a message never suggests "upgrading" sideways or
// downwards. Anything off the ladder, including self-hosted and an unrecognised string,
// sorts below Free and is handled explicitly by the callers that care.
func (p Plan) rank() int {
	switch p {
	case PlanEnterprise:
		return 3
	case PlanPro:
		return 2
	case PlanFree:
		return 1
	}
	return 0
}

// Unlimited is the sentinel every numeric limit uses for "no ceiling".
//
// A sentinel rather than a *int, deliberately. The matrix is a table of literals, and
// pointers in it would have two costs: a helper function around every number, and — the
// one that matters — a *int returned out of a package-level table is a handle onto that
// table. One caller writing through it would change policy for every workspace in the
// process, for the life of the process, with nothing in the diff to suggest it. Features
// is a value, so it copies and cannot be corrupted at a distance.
//
// -1 and not 0 or MaxInt: migration 000016 constrains seat_limit to > 0, so a negative
// number can never collide with a real limit, whereas 0 is a plausible one. MaxInt reads
// as a real number in a log line and invites arithmetic that overflows.
//
// The pointer that GraphQL needs — `seatLimit: Int` is nullable, null meaning unlimited —
// is produced once, in the transport layer, where nullability belongs.
const Unlimited = -1

// Feature names a capability that gating can turn off. Features are coarse: one per thing
// a customer would recognise on a pricing page, not one per resolver.
type Feature string

const (
	FeaturePrivateTeams       Feature = "private_teams"
	FeatureSubTeams           Feature = "sub_teams"
	FeatureMultiLevelSubTeams Feature = "multi_level_sub_teams"
	FeatureCustomViews        Feature = "custom_views"
	FeatureAPIKeys            Feature = "api_keys"
	FeatureSSO                Feature = "sso"
	FeatureAuditLog           Feature = "audit_log"
	FeatureSLAs               Feature = "slas"
	FeatureSlack              Feature = "slack"
)

// AllFeatures exists for the same reason as AllPlans: it is what lets a test prove the
// matrix answers for every feature rather than falling through a default branch to "no".
var AllFeatures = []Feature{
	FeaturePrivateTeams, FeatureSubTeams, FeatureMultiLevelSubTeams,
	FeatureCustomViews, FeatureAPIKeys, FeatureSSO, FeatureAuditLog,
	FeatureSLAs, FeatureSlack,
}

// Label names the feature in a sentence a customer reads, and is phrased to work as the
// first word of one.
func (f Feature) Label() string {
	switch f {
	case FeaturePrivateTeams:
		return "Private teams"
	case FeatureSubTeams:
		return "Sub-teams"
	case FeatureMultiLevelSubTeams:
		return "Multi-level sub-teams"
	case FeatureCustomViews:
		return "Custom views"
	case FeatureAPIKeys:
		return "Personal API keys"
	case FeatureSSO:
		return "SAML SSO"
	case FeatureAuditLog:
		return "The audit log"
	case FeatureSLAs:
		return "SLAs"
	case FeatureSlack:
		return "Slack"
	}
	return string(f)
}

// LimitKind names a countable ceiling.
type LimitKind string

const (
	LimitSeats       LimitKind = "seats"
	LimitTeams       LimitKind = "teams"
	LimitHistoryDays LimitKind = "history_days"
)

var AllLimits = []LimitKind{LimitSeats, LimitTeams, LimitHistoryDays}

func (l LimitKind) Label() string {
	switch l {
	case LimitSeats:
		return "members"
	case LimitTeams:
		return "teams"
	case LimitHistoryDays:
		return "days of history"
	}
	return string(l)
}

// Features is what one plan permits. It mirrors the Entitlements type in
// schema/schema.graphql field for field, minus the three the matrix cannot know —
// plan, seatsUsed and lapsed — which come from the workspace's own facts and are answered
// by Set.
type Features struct {
	// SeatLimit counts billable members. Unlimited means no ceiling.
	SeatLimit int
	TeamLimit int
	// HistoryDays is how far back the product's history is queryable.
	//
	// Not to be confused with change_log's 30-day physical retention
	// (docs/05-infrastructure/03-sync-engine.md), which applies to every plan and is a
	// property of the sync engine, not of what anybody paid for. A client offline longer
	// than that re-bootstraps regardless of plan.
	HistoryDays int

	PrivateTeams       bool
	SubTeams           bool
	MultiLevelSubTeams bool
	CustomViews        bool
	APIKeys            bool
	SSO                bool
	AuditLog           bool
	SLAs               bool
	Slack              bool
}

// The matrix. This table is the packaging decision, and everything else in this package is
// derived from it — including which plan an upsell message names, so a feature moved
// between plans cannot leave a message behind saying otherwise.
//
// It follows docs/06-product-model/02-plans-and-packaging.md. Two of the five booleans
// are true on every plan today, and that is the point rather than an oversight:
//
//   - Custom views stay free because saved filters are how the tracker is used at all.
//   - Personal API keys stay free because gating the API kills the integration ecosystem
//     that makes an open-source tracker worth adopting. Free is rate-limited, not walled.
//   - Slack stays free for the same reason: chat is how issues arrive.
//
// Private teams are Business+ (Pro and above). They are in the matrix so the client
// renders one source of truth instead of hardcoding "everyone has this".
var matrix = map[Plan]Features{
	// Free caps exist to bound the cost of running a free tier, not to frustrate: five
	// people doing real work is enough that leaving hurts, and small enough that a
	// thousand such workspaces fit on one machine.
	PlanFree: {
		SeatLimit:          5,
		TeamLimit:          2,
		HistoryDays:        90,
		PrivateTeams:       false,
		SubTeams:           false,
		MultiLevelSubTeams: false,
		CustomViews:        true,
		APIKeys:            true,
		SSO:                false,
		AuditLog:           false,
		SLAs:               false,
		Slack:              true,
	},
	PlanPro: {
		SeatLimit:          Unlimited,
		TeamLimit:          Unlimited,
		HistoryDays:        Unlimited,
		PrivateTeams:       true,
		SubTeams:           true,
		MultiLevelSubTeams: false,
		CustomViews:        true,
		APIKeys:            true,
		SSO:                false,
		AuditLog:           false,
		SLAs:               true,
		Slack:              true,
	},
	PlanEnterprise: {
		SeatLimit:          Unlimited,
		TeamLimit:          Unlimited,
		HistoryDays:        Unlimited,
		PrivateTeams:       true,
		SubTeams:           true,
		MultiLevelSubTeams: true,
		CustomViews:        true,
		APIKeys:            true,
		SSO:                true,
		AuditLog:           true,
		SLAs:               true,
		Slack:              true,
	},
	// Unlimited on seats is the whole claim of an open-source tracker: anybody who wants
	// to run this for 300 people without paying may. A seat count here would make the
	// project a trial with a licence file.
	PlanSelfHosted: {
		SeatLimit:          Unlimited,
		TeamLimit:          Unlimited,
		HistoryDays:        Unlimited,
		PrivateTeams:       true,
		SubTeams:           true,
		MultiLevelSubTeams: true,
		CustomViews:        true,
		APIKeys:            true,
		SSO:                false,
		AuditLog:           false,
		SLAs:               true,
		Slack:              true,
	},
}

// For returns what a plan permits.
//
// An unrecognised plan resolves to Free. That direction is chosen knowing it is wrong for
// the customer it hits: a paying workspace whose plan column was mangled gets free-tier
// limits and files a support ticket within the hour, which is recoverable. Failing the
// other way hands the ee features to any typo and nobody ever reports it.
func For(p Plan) Features {
	f, ok := matrix[p]
	if !ok {
		return matrix[PlanFree]
	}
	return f
}

// has answers the matrix for one feature. The second return says whether the feature was
// recognised at all, so Allow can fail closed on a constant nobody added here and a test
// can prove no such constant exists.
func (f Features) has(feat Feature) (allowed, known bool) {
	switch feat {
	case FeaturePrivateTeams:
		return f.PrivateTeams, true
	case FeatureSubTeams:
		return f.SubTeams, true
	case FeatureMultiLevelSubTeams:
		return f.MultiLevelSubTeams, true
	case FeatureCustomViews:
		return f.CustomViews, true
	case FeatureAPIKeys:
		return f.APIKeys, true
	case FeatureSSO:
		return f.SSO, true
	case FeatureAuditLog:
		return f.AuditLog, true
	case FeatureSLAs:
		return f.SLAs, true
	case FeatureSlack:
		return f.Slack, true
	}
	return false, false
}

func (f Features) limit(k LimitKind) (n int, known bool) {
	switch k {
	case LimitSeats:
		return f.SeatLimit, true
	case LimitTeams:
		return f.TeamLimit, true
	case LimitHistoryDays:
		return f.HistoryDays, true
	}
	return 0, false
}

// narrow returns the more restrictive of two feature sets, field by field. It is how the
// lapsed case is expressed, and it guarantees the invariant that matters there: a lapse
// can only ever take something away, never grant it. A workspace whose negotiated seat
// count is below the free cap does not gain seats by failing to pay.
func (f Features) narrow(other Features) Features {
	return Features{
		SeatLimit:          narrowLimit(f.SeatLimit, other.SeatLimit),
		TeamLimit:          narrowLimit(f.TeamLimit, other.TeamLimit),
		HistoryDays:        narrowLimit(f.HistoryDays, other.HistoryDays),
		PrivateTeams:       f.PrivateTeams && other.PrivateTeams,
		SubTeams:           f.SubTeams && other.SubTeams,
		MultiLevelSubTeams: f.MultiLevelSubTeams && other.MultiLevelSubTeams,
		CustomViews:        f.CustomViews && other.CustomViews,
		APIKeys:            f.APIKeys && other.APIKeys,
		SSO:                f.SSO && other.SSO,
		AuditLog:           f.AuditLog && other.AuditLog,
		SLAs:               f.SLAs && other.SLAs,
		Slack:              f.Slack && other.Slack,
	}
}

// narrowLimit is min() with the sentinel treated as the largest possible value, which is
// what it means.
func narrowLimit(a, b int) int {
	switch {
	case a == Unlimited:
		return b
	case b == Unlimited:
		return a
	}
	return min(a, b)
}

// admits reports whether a limit leaves room for n of something. Unlimited always does.
func admits(limit, n int) bool {
	return limit == Unlimited || n <= limit
}

// Facts are the things about one workspace that the matrix cannot know. They come
// straight off the workspace row; this package never reads them itself, which is what
// keeps it free of internal/store.
type Facts struct {
	Plan Plan

	// PlanLapsedAt is workspace.plan_lapsed_at: set when a paid plan has actually lapsed.
	//
	// Whether a plan has lapsed is decided once, by the billing job that writes this
	// column, and never re-derived here by comparing plan_expires_at against a clock.
	// Two places deciding it is how a workspace becomes lapsed on one server and not on
	// another for the length of a clock skew, and it is also why this package needs no
	// clock and its tests need no fake one.
	PlanLapsedAt *time.Time

	// SeatLimit is workspace.seat_limit: an override of the plan's default, for the deals
	// that always happen. nil means "whatever the plan says". A pointer because the fact
	// is genuinely nullable in the database; the pointer stops here and the policy below
	// is all values.
	SeatLimit *int

	// SeatsUsed is the number of billable members right now: active human users. App
	// users are agents and are not billable, and suspended users are not billed, so
	// neither is counted. That definition belongs to whoever runs the query, and it must
	// be the same query everywhere — two call sites counting differently is how one screen
	// says a workspace is over its limit while another says it is under.
	SeatsUsed int
}

// Set is the resolved answer for one workspace: the matrix, plus that workspace's own
// facts, plus the lapsed rule. Build one per request and pass it down.
type Set struct {
	plan      Plan
	seatsUsed int
	lapsed    bool
	// seatOverride records that the seat ceiling came from a negotiated deal rather than
	// from the plan, because it changes what a denial may honestly say: upgrading does not
	// lift a limit that was written by hand.
	seatOverride bool

	// features is what the plan entitles, with the seat override applied and the lapse
	// ignored. This is what the customer is paying for and what the UI shows.
	features Features
	// writeFeatures is features narrowed by the lapse. Gated writes are answered from
	// here; reads are never answered from here. See Allow.
	writeFeatures Features
}

// New resolves a workspace's facts against the matrix.
func New(f Facts) Set {
	s := Set{
		plan:      f.Plan,
		seatsUsed: f.SeatsUsed,
		features:  For(f.Plan),
	}

	// An override replaces the plan's seat count outright, in both directions and on every
	// plan: it is how a design partner gets twelve seats on Free without inventing a plan
	// for them, and how a capped deal gets fewer than Enterprise's unlimited.
	//
	// A non-positive override is ignored. The database forbids it
	// (workspace_seat_limit_positive), so the only way to arrive here with one is a caller
	// that built Facts from something other than the column — and locking a workspace out
	// of every seat because of a zero is a worse answer than falling back to its plan.
	if f.SeatLimit != nil && *f.SeatLimit > 0 {
		s.features.SeatLimit = *f.SeatLimit
		s.seatOverride = true
	}

	// A free plan cannot lapse: there is nothing to fail to pay. Honouring a stray flag on
	// one would take a workspace below the tier it is already entitled to for free.
	s.lapsed = f.PlanLapsedAt != nil && f.Plan != PlanFree

	s.writeFeatures = s.features
	if s.lapsed {
		// The lapsed rule, from migration 000016 and
		// docs/06-product-model/02-plans-and-packaging.md: reads keep working and gated
		// writes do not. Concretely the workspace falls back to the Free matrix for
		// writes — read-only above the free caps, fully usable below them — so a lapsed
		// Pro workspace with three people carries on unaffected while one with forty
		// cannot invite a forty-first.
		//
		// Locking people out of their own data over a failed card is not a business model.
		// It is also the fastest way to turn a billing problem into a migration away.
		s.writeFeatures = s.features.narrow(For(PlanFree))
	}

	return s
}

// Plan is the workspace's plan as given. Unrecognised values are returned unchanged rather
// than normalised to free, so a log line says what was actually in the column.
func (s Set) Plan() Plan { return s.plan }

// Features is what the plan entitles, with any seat override applied and the lapse
// deliberately not applied. It is the source for the Entitlements type on the API: the
// client shows what the workspace is entitled to, alongside Lapsed, rather than being told
// its features vanished.
func (s Set) Features() Features { return s.features }

func (s Set) SeatsUsed() int { return s.seatsUsed }

// Lapsed reports that a paid plan has lapsed. Reads are unaffected by it.
func (s Set) Lapsed() bool { return s.lapsed }

// Has reports whether the plan includes a feature, ignoring any lapse.
//
// This is the read-side and display-side answer: "does this workspace's plan include the
// audit log", for deciding whether to render it and whether an existing audit log stays
// readable. Gated writes ask Allow instead.
func (s Set) Has(f Feature) bool {
	allowed, _ := s.features.has(f)
	return allowed
}

// Allow answers "may this workspace perform a write that needs this feature", and returns
// a *Error naming the plan that would permit it if not.
//
// Reads must not call Allow. A lapsed workspace still gets its data, so a read path that
// gates on this is the exact bug the lapsed rule exists to prevent; it asks Has.
//
// Every gated write calls Allow even for features that are free on every plan today. That
// is the point of the package: the day one of them becomes paid, the matrix changes and
// nothing else does.
func (s Set) Allow(f Feature) error {
	if allowed, _ := s.writeFeatures.has(f); allowed {
		return nil
	}
	return s.denyFeature(f)
}

// Deny is the refusal a READ path returns when Has said no.
//
// Allow cannot serve that case, and the difference is the lapse. Allow answers from the
// narrowed write matrix, so a lapsed Pro workspace is refused a feature its plan includes —
// correct for a write, and exactly the bug the lapsed rule exists to prevent if a read did
// it. So a read asks Has, and when the answer is no it comes here for the sentence.
//
// Why not let the caller write the sentence: because the message names the plan that would
// permit the feature, and that name is derived from the matrix. A hand-written string is a
// message that keeps naming Enterprise on the day the feature moves to Pro, and it is the
// one string a customer reads before deciding whether to pay.
//
// Deny does not check anything. It is the caller's job to have asked Has first; calling it
// for a feature the plan includes produces a refusal that contradicts itself, which is why
// this is a separate method rather than a second return from Has.
func (s Set) Deny(f Feature) error { return s.denyFeature(f) }

// Limit reports a plan's ceiling. ok is false when there is none, in which case n is
// Unlimited.
//
// It describes; Allow, CanAddSeat and CanAddTeam decide. The distinction is not
// cosmetic: two of the three limits are read by read paths — the history window is a read,
// and narrowing it on a lapsed workspace would break the promise that reads keep working —
// so Limit reports the plan's number and the Can* methods apply the lapse.
//
// n is the sentinel rather than 0 when unbounded, and 0 rather than the sentinel for a
// LimitKind nobody added to the matrix. Both make a caller who drops ok deny rather than
// grant: a rule that wrongly blocks is reported within the hour, and one that wrongly
// grants is never reported at all.
func (s Set) Limit(k LimitKind) (int, bool) {
	n, known := s.features.limit(k)
	if !known {
		return 0, true
	}
	if n == Unlimited {
		return Unlimited, false
	}
	return n, true
}

// CanAddSeat answers whether one more billable member fits.
//
// The boundary is the whole method. With a limit of five and five members the workspace is
// full; with four it may add its fifth. Getting this wrong in either direction is a bug a
// customer notices immediately — they cannot add the person they are paying for, or they
// get one free — which is why it is written once here and nowhere else.
func (s Set) CanAddSeat() error {
	if admits(s.writeFeatures.SeatLimit, s.seatsUsed+1) {
		return nil
	}
	return s.denyLimit(LimitSeats, s.writeFeatures.SeatLimit, s.seatsUsed+1)
}

// CanAddTeam answers whether one more team fits, given how many exist now.
//
// The count is a parameter rather than a fact on the workspace because teams are counted
// only at this one call site, while seats are needed for billing and for the API's
// seatsUsed. A separate method rather than a kind argument to a shared one, for the reason
// authz gives for splitting its label actions: two names cannot be confused, and an
// argument that decides which rule applies is an argument somebody forgets.
func (s Set) CanAddTeam(current int) error {
	if admits(s.writeFeatures.TeamLimit, current+1) {
		return nil
	}
	return s.denyLimit(LimitTeams, s.writeFeatures.TeamLimit, current+1)
}

// Error is a refusal on entitlement grounds.
//
// It carries the structure a client needs to render an upsell — which feature, which plan
// would permit it, which ceiling was hit, and whether this is a lapse rather than a
// packaging decision — because a paywall that only has a sentence to work with becomes a
// paywall that string-matches one.
//
// Unwrap yields a *platform.Error carrying CodeEntitlement, so both transports classify it
// without a conversion at any call site: GraphQL presents PLAN_LIMIT and the REST handlers
// answer 402. A resolver that simply returns this error does the right thing.
type Error struct {
	// Plan is the workspace's plan at the moment of refusal.
	Plan Plan
	// NeedsPlan is the cheapest plan that would permit it, derived from the matrix rather
	// than written into the message, so moving a feature between plans cannot leave a
	// message behind that lies. Empty when no plan would, or when the ceiling came from a
	// negotiated override that upgrading does not lift.
	NeedsPlan Plan
	// Feature is set on a feature refusal, Limit on a ceiling refusal. Exactly one of them.
	Feature Feature
	Limit   LimitKind
	// Cap is the ceiling that was hit, meaningful only alongside Limit.
	Cap int
	// Lapsed says the refusal is a billing lapse and not a packaging decision. A client
	// showing "upgrade" here instead of "update your billing details" sends a paying
	// customer to the wrong screen.
	Lapsed bool
	// Message is shown to the caller. It never names an internal identifier.
	Message string
}

func (e *Error) Error() string { return e.Message }

func (e *Error) Unwrap() error {
	return &platform.Error{Code: platform.CodeEntitlement, Message: e.Message}
}

// Details is the refusal as a client is allowed to act on it.
//
// The fields on Error above have carried this structure since gating shipped and not one of
// them ever reached a browser: Unwrap yields a *platform.Error, which has room for a code
// and a sentence and nothing else, so both transports flattened the whole refusal into
// prose — exactly the paywall-that-string-matches-a-message the Error comment warns against.
// This type is the shape that crosses the wire, written once so the GraphQL extensions and
// the 402 body cannot drift apart.
//
// Cap is a pointer because 0 is a real ceiling — a workspace whose negotiated seat override
// is zero looks exactly like that — and a client cannot tell an absent Cap from a Cap of
// zero unless the key is missing rather than zero.
type Details struct {
	Plan      string `json:"plan,omitempty"`
	NeedsPlan string `json:"needsPlan,omitempty"`
	Feature   string `json:"feature,omitempty"`
	Limit     string `json:"limit,omitempty"`
	Cap       *int   `json:"cap,omitempty"`
	Lapsed    bool   `json:"lapsed,omitempty"`
}

// Details renders the refusal for the wire.
func (e *Error) Details() Details {
	d := Details{
		Plan:      string(e.Plan),
		NeedsPlan: string(e.NeedsPlan),
		Feature:   string(e.Feature),
		Limit:     string(e.Limit),
		Lapsed:    e.Lapsed,
	}
	// Cap is meaningful only alongside Limit, as the Error comment says. Sending it on a
	// feature refusal would hand the client a ceiling of zero to write a sentence about.
	if e.Limit != "" {
		ceiling := e.Cap
		d.Cap = &ceiling
	}
	return d
}

// Extensions is Details as GraphQL carries it, merged into the error's `extensions` beside
// `code`. Flattened rather than nested under a key of its own so that a client reads the
// same field names whichever transport answered — the REST body embeds this struct for the
// same reason.
//
// Keys whose value is absent are omitted, matching `omitempty` on the struct above.
// wire_test.go asserts the two stay in step, because a key present in one and missing in the
// other is a client that works on one endpoint and not on the other.
func (d Details) Extensions() map[string]any {
	ext := map[string]any{}
	if d.Plan != "" {
		ext["plan"] = d.Plan
	}
	if d.NeedsPlan != "" {
		ext["needsPlan"] = d.NeedsPlan
	}
	if d.Feature != "" {
		ext["feature"] = d.Feature
	}
	if d.Limit != "" {
		ext["limit"] = d.Limit
	}
	if d.Cap != nil {
		ext["cap"] = *d.Cap
	}
	if d.Lapsed {
		ext["lapsed"] = true
	}
	return ext
}

func (s Set) denyFeature(f Feature) *Error {
	e := &Error{Plan: s.plan, Feature: f}

	// A feature the plan itself includes can only be missing because billing lapsed, and
	// that is a different sentence and a different button: telling somebody to upgrade the
	// plan they already pay for is how a support thread starts.
	if entitled, _ := s.features.has(f); entitled && s.lapsed {
		e.Lapsed = true
		e.Message = fmt.Sprintf(
			"%s is unavailable because your %s subscription has lapsed. Update your billing details to restore it; nothing has been deleted and your existing data is still readable.",
			f.Label(), s.plan.Label())
		return e
	}

	need := cheapestWithFeature(f)
	switch {
	case need == "":
		// Every feature in the matrix is on Enterprise, so no plan selling one can only mean
		// a Feature constant nobody added to the matrix. That is our bug, and its constant is
		// an internal name: it tells the reader nothing and tells them where it came from.
		e.Message = "That feature is not available."
	case s.plan == PlanSelfHosted:
		// A self-hosted install has no plan to buy. The thing that unlocks this is a
		// licence key, and saying "upgrade to Enterprise" sends the reader looking for a
		// billing screen that does not exist in their install.
		e.Message = fmt.Sprintf("%s requires an Enterprise licence.", f.Label())
	case !s.plan.Valid():
		// Naming the current plan is only helpful when it is a plan. An unrecognised
		// column value is a bug of ours, and echoing it at a customer explains nothing.
		e.NeedsPlan = need
		e.Message = fmt.Sprintf("%s requires the %s plan.", f.Label(), need.Label())
	default:
		e.NeedsPlan = need
		e.Message = fmt.Sprintf("%s requires the %s plan. This workspace is on %s.",
			f.Label(), need.Label(), s.plan.Label())
	}
	return e
}

func (s Set) denyLimit(k LimitKind, ceiling, needed int) *Error {
	e := &Error{Plan: s.plan, Limit: k, Cap: ceiling}

	// What the plan entitles with the lapse ignored. A lapse is only the reason for a refusal
	// when the unlapsed ceiling would have admitted the count: an Enterprise workspace with a
	// negotiated cap of three, at three members, is refused whether or not billing is
	// current, and blaming billing there promises that paying restores something paying does
	// not restore. denyFeature makes the same distinction for the same reason.
	entitled, _ := s.features.limit(k)

	switch {
	case s.lapsed && admits(entitled, needed):
		e.Lapsed = true
		e.Message = fmt.Sprintf(
			"Your %s subscription has lapsed, so this workspace is limited to %d %s until billing is up to date. Everyone already here keeps their access and nothing has been deleted.",
			s.plan.Label(), ceiling, k.Label())

	case k == LimitSeats && s.seatOverride:
		// The ceiling was written by hand for this workspace, so no upgrade lifts it and
		// NeedsPlan stays empty. Offering one would be an upsell that does not work.
		e.Message = fmt.Sprintf(
			"This workspace is limited to %d %s. Contact us to raise the limit.",
			ceiling, k.Label())

	default:
		// The upsell is only offered when there is one to make: a plan that actually
		// admits the count, higher up the ladder than the one being paid for, and named
		// after a plan the reader recognises rather than whatever string was in the
		// column.
		need := cheapestWithLimit(k, needed)
		if need == "" || need.rank() <= s.plan.rank() || !s.plan.Valid() {
			e.Message = fmt.Sprintf("This workspace is limited to %d %s.", ceiling, k.Label())
			break
		}
		e.NeedsPlan = need
		e.Message = fmt.Sprintf("The %s plan includes %d %s. Upgrade to %s to add more.",
			s.plan.Label(), ceiling, k.Label(), need.Label())
	}
	return e
}

// cheapestWithFeature walks the cloud ladder and returns the first plan whose matrix row
// includes the feature. Derived rather than declared: a feature moved from Enterprise to
// Pro changes one line in the matrix and every message follows it.
func cheapestWithFeature(f Feature) Plan {
	for _, p := range upgradePath {
		if allowed, _ := For(p).has(f); allowed {
			return p
		}
	}
	return ""
}

// cheapestWithLimit returns the first plan on the ladder whose ceiling admits n.
func cheapestWithLimit(k LimitKind, n int) Plan {
	for _, p := range upgradePath {
		limit, known := For(p).limit(k)
		if known && admits(limit, n) {
			return p
		}
	}
	return ""
}
