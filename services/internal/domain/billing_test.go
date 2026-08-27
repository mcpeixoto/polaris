package domain_test

import (
	"context"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/entitlement"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// The billing writer and the lapse job.
//
// What these guard is that the plan columns have exactly one writer, and that the lapse rule
// has one at all. internal/entitlement tests the policy exhaustively and without a database,
// and every one of those tests passed for as long as nothing wrote plan_lapsed_at — the rule
// was correct, enforced at nine call sites, and dead. So the assertions below are
// deliberately about the columns and about who moved them, not about what the matrix then
// decides.

func periodEnd(d time.Duration) *time.Time {
	v := time.Now().Add(d)
	return &v
}

func seats(n int) *int { return &n }

func readWorkspace(t *testing.T, f *testutil.Fixture) store.Workspace {
	t.Helper()
	ws, err := f.DB.Queries().GetWorkspace(context.Background(), f.WorkspaceID)
	if err != nil {
		t.Fatalf("read workspace: %v", err)
	}
	return ws
}

// paidPro is the state a healthy Pro subscription arrives in.
func paidPro(f *testutil.Fixture, end *time.Time) domain.SubscriptionState {
	subID := "sub_" + f.WorkspaceID.String()
	return domain.SubscriptionState{
		WorkspaceID:      f.WorkspaceID,
		Provider:         "stripe",
		CustomerID:       "cus_" + f.WorkspaceID.String(),
		SubscriptionID:   &subID,
		Status:           domain.SubscriptionActive,
		CurrentPeriodEnd: end,
		SeatsPaid:        seats(12),
		Plan:             entitlement.PlanPro,
	}
}

func TestApplySubscription_PutsTheWorkspaceOnThePlanItPaidFor(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	end := periodEnd(30 * 24 * time.Hour)
	ws, version, err := svc.ApplySubscription(ctx, paidPro(f, end))
	if err != nil {
		t.Fatalf("apply subscription: %v", err)
	}
	if ws.Plan != string(entitlement.PlanPro) {
		t.Errorf("the workspace came back on %q after paying for pro", ws.Plan)
	}
	if version == 0 {
		// The plan lives on the replicated workspace row. A write that emits nothing leaves
		// every open client drawing the gates of the plan the customer was on before.
		t.Error("applying a subscription emitted no change; open clients would not learn the plan moved")
	}

	row := readWorkspace(t, f)
	if row.Plan != string(entitlement.PlanPro) {
		t.Errorf("workspace.plan is %q in the column, want pro", row.Plan)
	}
	// Truncated to microseconds on both sides before comparing. Postgres timestamptz stores
	// microseconds and Go's time.Time carries nanoseconds, so a value that round-trips
	// perfectly still fails an exact Equal by the sub-microsecond remainder.
	if row.PlanExpiresAt == nil ||
		!row.PlanExpiresAt.Truncate(time.Microsecond).Equal(end.Truncate(time.Microsecond)) {
		t.Errorf("plan_expires_at is %v, want the subscription's current_period_end %v",
			row.PlanExpiresAt, *end)
	}
	// Seats are billed by proration, not rationed: a Pro workspace that could not invite its
	// next hire until somebody edited a subscription would be a worse product than free.
	if row.SeatLimit != nil {
		t.Errorf("seat_limit was pinned to %d by an uncapped subscription", *row.SeatLimit)
	}

	sub, err := f.DB.Queries().GetSubscription(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("the plan moved but no subscription row records why: %v", err)
	}
	if sub.Status != string(domain.SubscriptionActive) || sub.SeatsPaid == nil || *sub.SeatsPaid != 12 {
		t.Errorf("subscription recorded status=%q seats=%v", sub.Status, sub.SeatsPaid)
	}
}

func TestApplySubscription_PinsSeatsOnlyForACappedDeal(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	in := paidPro(f, periodEnd(30*24*time.Hour))
	in.SeatLimit = seats(12)
	if _, _, err := svc.ApplySubscription(ctx, in); err != nil {
		t.Fatalf("apply subscription: %v", err)
	}
	if row := readWorkspace(t, f); row.SeatLimit == nil || *row.SeatLimit != 12 {
		t.Fatalf("seat_limit is %v, want the deal's 12", row.SeatLimit)
	}

	// And the deal ending has to be sayable. A COALESCE here would make "no override" a
	// value the billing layer could never send, leaving last quarter's cap in place forever.
	in.SeatLimit = nil
	if _, _, err := svc.ApplySubscription(ctx, in); err != nil {
		t.Fatalf("re-apply subscription: %v", err)
	}
	if row := readWorkspace(t, f); row.SeatLimit != nil {
		t.Errorf("seat_limit is still %d after the cap was lifted", *row.SeatLimit)
	}
}

// A webhook is delivered at least once, so the same event arriving twice is the normal case
// rather than an edge one. Twice has to mean once.
func TestApplySubscription_IsSafeToReplay(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	in := paidPro(f, periodEnd(30*24*time.Hour))
	if _, _, err := svc.ApplySubscription(ctx, in); err != nil {
		t.Fatalf("first apply: %v", err)
	}
	first, err := f.DB.Queries().GetSubscription(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("read subscription: %v", err)
	}

	in.SeatsPaid = seats(14)
	if _, _, err := svc.ApplySubscription(ctx, in); err != nil {
		t.Fatalf("second apply: %v", err)
	}

	var rows int
	if err := db.Pool().QueryRow(ctx,
		`SELECT count(*) FROM subscription WHERE workspace_id = $1`, f.WorkspaceID,
	).Scan(&rows); err != nil {
		t.Fatalf("count subscriptions: %v", err)
	}
	if rows != 1 {
		t.Fatalf("a replayed event left %d subscription rows for one workspace", rows)
	}

	second, err := f.DB.Queries().GetSubscription(ctx, f.WorkspaceID)
	if err != nil {
		t.Fatalf("read subscription: %v", err)
	}
	if second.ID != first.ID {
		t.Error("the upsert churned the row's identity; anything referencing it would dangle")
	}
	if second.SeatsPaid == nil || *second.SeatsPaid != 14 {
		t.Errorf("the newer event did not win: seats_paid is %v", second.SeatsPaid)
	}
}

func TestApplySubscription_LiftsALapseTheMomentPaymentRecovers(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	past := paidPro(f, periodEnd(-(domain.PlanLapseGrace + 24*time.Hour)))
	past.Status = domain.SubscriptionPastDue
	if _, _, err := svc.ApplySubscription(ctx, past); err != nil {
		t.Fatalf("apply past-due subscription: %v", err)
	}
	if n, err := svc.SweepLapsedPlans(ctx, time.Now()); err != nil || n != 1 {
		t.Fatalf("the sweep marked %d workspaces (err %v), want 1", n, err)
	}

	// The customer is watching this happen. Waiting for the next tick to restore writes is
	// an hour of somebody who has just paid being told to upgrade.
	if _, _, err := svc.ApplySubscription(ctx, paidPro(f, periodEnd(30*24*time.Hour))); err != nil {
		t.Fatalf("apply recovered subscription: %v", err)
	}
	if row := readWorkspace(t, f); row.PlanLapsedAt != nil {
		t.Error("plan_lapsed_at survived a recovered payment; gated writes stay narrowed")
	}
}

func TestApplySubscription_DoesNotDecideTheLapseItself(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// Going past due is not going lapsed: the grace window is the whole point, and
	// SweepLapsedPlans owns it because it is the only thing that knows how long it has been.
	past := paidPro(f, periodEnd(-time.Hour))
	past.Status = domain.SubscriptionPastDue
	if _, _, err := svc.ApplySubscription(ctx, past); err != nil {
		t.Fatalf("apply past-due subscription: %v", err)
	}
	if row := readWorkspace(t, f); row.PlanLapsedAt != nil {
		t.Error("a past-due event lapsed the workspace immediately, skipping the grace window")
	}
}

func TestApplySubscription_RefusesWhatNoSubscriptionCanGrant(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	cases := map[string]func(in *domain.SubscriptionState){
		// self_hosted means "nobody is billing this". Selling it is a contradiction, and the
		// lapse rule would then read it as a paid plan.
		"the self-hosted plan": func(in *domain.SubscriptionState) { in.Plan = entitlement.PlanSelfHosted },
		"an unmapped status":   func(in *domain.SubscriptionState) { in.Status = "trialing_maybe" },
		// The database rejects it too: it is the value that locks a workspace out of every
		// seat it has.
		"a zero seat cap":     func(in *domain.SubscriptionState) { in.SeatLimit = seats(0) },
		"a nameless provider": func(in *domain.SubscriptionState) { in.Provider = "" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			in := paidPro(f, periodEnd(30*24*time.Hour))
			mutate(&in)
			_, _, err := svc.ApplySubscription(ctx, in)
			if err == nil {
				t.Fatalf("%s was accepted", name)
			}
			// Named, not merely refused. The caller is a webhook handler with a log and no
			// user; an internal fault tells it nothing about which field to fix.
			if code := platform.CodeOf(err); code == platform.CodeInternal {
				t.Fatalf("%s was refused as an internal fault (%v)", name, err)
			}
			// The fixture ships self_hosted, so an unchanged plan proves the refusal
			// happened before anything was written rather than halfway through.
			if row := readWorkspace(t, f); row.Plan != string(entitlement.PlanSelfHosted) {
				t.Fatalf("a refused apply still moved the workspace to %q", row.Plan)
			}
		})
	}
}

func TestSweepLapsedPlans_MarksPastDueBeyondGraceAndOnlyOnce(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	past := paidPro(f, periodEnd(-(domain.PlanLapseGrace + 24*time.Hour)))
	past.Status = domain.SubscriptionPastDue
	if _, _, err := svc.ApplySubscription(ctx, past); err != nil {
		t.Fatalf("apply past-due subscription: %v", err)
	}

	n, err := svc.SweepLapsedPlans(ctx, time.Now())
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 1 {
		t.Fatalf("the sweep changed %d workspaces, want 1", n)
	}
	row := readWorkspace(t, f)
	if row.PlanLapsedAt == nil {
		t.Fatal("a subscription a day past grace did not lapse; the rule still enforces nothing")
	}
	marked := *row.PlanLapsedAt

	// The process restarts freely and the job runs hourly, so a second pass is routine. It
	// must not re-stamp the timestamp: "lapsed since" is what support reads to answer when
	// the customer was cut off.
	if n, err := svc.SweepLapsedPlans(ctx, time.Now()); err != nil || n != 0 {
		t.Fatalf("a second sweep changed %d workspaces (err %v), want 0", n, err)
	}
	if again := readWorkspace(t, f); again.PlanLapsedAt == nil || !again.PlanLapsedAt.Equal(marked) {
		t.Errorf("the second sweep moved plan_lapsed_at from %v to %v", marked, again.PlanLapsedAt)
	}
}

func TestSweepLapsedPlans_LeavesTheGraceWindowAlone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// One day past due: a card expired, the retry cycle is running, somebody is on holiday.
	past := paidPro(f, periodEnd(-24*time.Hour))
	past.Status = domain.SubscriptionPastDue
	if _, _, err := svc.ApplySubscription(ctx, past); err != nil {
		t.Fatalf("apply past-due subscription: %v", err)
	}

	if n, err := svc.SweepLapsedPlans(ctx, time.Now()); err != nil || n != 0 {
		t.Fatalf("the sweep changed %d workspaces (err %v) inside the grace window", n, err)
	}
	if row := readWorkspace(t, f); row.PlanLapsedAt != nil {
		t.Error("a workspace one day past due was lapsed; the grace window buys nothing")
	}
}

func TestSweepLapsedPlans_LiftsTheMarkWhenTheSubscriptionRecovers(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	past := paidPro(f, periodEnd(-(domain.PlanLapseGrace + 24*time.Hour)))
	past.Status = domain.SubscriptionPastDue
	if _, _, err := svc.ApplySubscription(ctx, past); err != nil {
		t.Fatalf("apply past-due subscription: %v", err)
	}
	if _, err := svc.SweepLapsedPlans(ctx, time.Now()); err != nil {
		t.Fatalf("sweep: %v", err)
	}

	// Recovery written straight to the subscription row rather than through the domain
	// writer: a nightly reconciliation against the provider has exactly this shape, and the
	// job has to notice by itself rather than only ever being told.
	if _, err := db.Pool().Exec(ctx,
		`UPDATE subscription SET status = 'active', current_period_end = now() + interval '30 days'
		 WHERE workspace_id = $1`, f.WorkspaceID,
	); err != nil {
		t.Fatalf("recover subscription: %v", err)
	}

	n, err := svc.SweepLapsedPlans(ctx, time.Now())
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 1 {
		t.Fatalf("the recovery sweep changed %d workspaces, want 1", n)
	}
	if row := readWorkspace(t, f); row.PlanLapsedAt != nil {
		t.Error("a recovered subscription is still marked lapsed")
	}
	// And it settles. The two listings are exact negations of each other; if they were not,
	// a workspace would flap between lapsed and not on every tick.
	if n, err := svc.SweepLapsedPlans(ctx, time.Now()); err != nil || n != 0 {
		t.Fatalf("a settled sweep changed %d workspaces (err %v), want 0", n, err)
	}
}

func TestSweepLapsedPlans_IgnoresAWorkspaceItHasNoBillingRecordFor(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// A hand-written deal, a support script, a migration. This job did not write the mark and
	// knows nothing about why it is there; "recovering" it would be the job granting a paid
	// plan on no evidence at all.
	if _, err := db.Pool().Exec(ctx,
		`UPDATE workspace SET plan = 'pro', plan_lapsed_at = now() WHERE id = $1`, f.WorkspaceID,
	); err != nil {
		t.Fatalf("mark workspace: %v", err)
	}

	if n, err := svc.SweepLapsedPlans(ctx, time.Now()); err != nil || n != 0 {
		t.Fatalf("the sweep changed %d workspaces (err %v) with no subscription row", n, err)
	}
	if row := readWorkspace(t, f); row.PlanLapsedAt == nil {
		t.Error("the sweep cleared a lapse it had no billing record for")
	}
}

func TestSweepLapsedPlans_LeavesSelfHostedInstallsAlone(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	// The fixture's workspace is self_hosted, which is what this repository's product is.
	// entitlement.New honours plan_lapsed_at on every plan but free, so a stray timestamp
	// here would quietly put a self-hoster's writes under the free caps for a cloud billing
	// reason they are not part of — and nobody would think to trace that back to billing.
	if _, err := db.Pool().Exec(ctx,
		`INSERT INTO subscription (id, workspace_id, provider, provider_customer_id, status,
		                           current_period_end)
		 VALUES (gen_random_uuid(), $1, 'stripe', 'cus_stray', 'past_due', now() - interval '90 days')`,
		f.WorkspaceID,
	); err != nil {
		t.Fatalf("insert subscription: %v", err)
	}

	if n, err := svc.SweepLapsedPlans(ctx, time.Now()); err != nil || n != 0 {
		t.Fatalf("the sweep changed %d workspaces (err %v) on a self-hosted install", n, err)
	}
	if row := readWorkspace(t, f); row.PlanLapsedAt != nil {
		t.Error("a self-hosted workspace was lapsed by a cloud billing row")
	}
}

// The seat count, at the role that is not billed.
//
// CountWorkspaceSeats had no role predicate, so a guest consumed a paid seat — while
// docs/06-product-model/02-plans-and-packaging.md sells guests as core and ungated, on the
// grounds that charging for an access-control boundary is user-hostile. A workspace that
// brought in a dozen contractors hit its seat limit and was told to upgrade.
func TestCountWorkspaceSeats_DoesNotBillForGuests(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)

	before := activeSeats(t, f)

	f.NewUser(t, "contractor", "guest", true)
	if got := activeSeats(t, f); got != before {
		t.Errorf("a guest moved the seat count from %d to %d", before, got)
	}

	// And the predicate has not simply stopped counting: a member still spends a seat.
	f.NewUser(t, "colleague", "member", true)
	if got := activeSeats(t, f); got != before+1 {
		t.Errorf("a member left the seat count at %d, want %d", got, before+1)
	}
}
