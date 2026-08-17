package domain_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/mailer"
	"github.com/peixotolabs/polaris/services/internal/store"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

// Email delivery, against a real Postgres.
//
// The rendering is tested without a database in internal/mailer. What these prove is the
// part only a database can: that a digest names what actually happened, that a second pass
// sends nothing — the property the whole design is arranged around — and that a relay
// refusing a message delays the digest instead of swallowing it.

const digestBaseURL = "https://polaris.test"

func digestOpts() domain.DigestOptions {
	return domain.DigestOptions{BaseURL: digestBaseURL, Tick: time.Hour, Now: time.Now()}
}

// TestDeliverNotificationDigests_SendsOnceAndNamesWhatHappened is the important one: the
// second pass is the crashed-and-restarted worker, and it must send nothing.
func TestDeliverNotificationDigests_SendsOnceAndNamesWhatHappened(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)

	issue, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Ship the thing", AssigneeID: &bobID,
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, _, err := svc.CreateComment(ctx, alice, domain.CreateCommentInput{
		IssueID: issue.ID, Body: "started on this",
	}); err != nil {
		t.Fatalf("comment: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}

	rec := mailer.NewRecorder()
	sent, err := svc.DeliverNotificationDigests(ctx, rec, digestOpts())
	if err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if sent != 1 {
		t.Fatalf("sent %d messages, want 1 — one digest for the one person with news", sent)
	}

	msgs := rec.Sent()
	if got := msgs[0].To.Email; got != accountEmail(t, db, bobID) {
		t.Errorf("the digest went to %q", got)
	}
	// Named, not counted. "You have 2 notifications" is a notification about notifications:
	// it sends the reader to the app to find out whether any of it mattered.
	if !strings.Contains(msgs[0].Subject, "1 issue assigned to you") {
		t.Errorf("subject is %q; it does not say what happened", msgs[0].Subject)
	}
	identifier := model.Identifier(f.TeamKey, issue.Number)
	for _, want := range []string{
		"1 issue assigned to you",
		"1 new comment on issues you follow",
		identifier,
		"Ship the thing",
		digestBaseURL + "/issue/" + identifier,
		digestBaseURL + "/settings/notifications",
	} {
		if !strings.Contains(msgs[0].Text, want) {
			t.Errorf("the digest does not contain %q:\n%s", want, msgs[0].Text)
		}
	}

	// The second pass, run a day later so that the cadence is not what stops it.
	//
	// That detail is the whole test. Repeating the pass at the same instant would also send
	// nothing — because a daily digest is not due again — and would pass identically with the
	// claim removed entirely. Moving the clock past the cadence leaves exactly one thing
	// standing between the recipient and a duplicate: emailed_at.
	tomorrow := digestOpts()
	tomorrow.Now = time.Now().Add(25 * time.Hour)
	sent, err = svc.DeliverNotificationDigests(ctx, rec, tomorrow)
	if err != nil {
		t.Fatalf("second pass: %v", err)
	}
	if sent != 0 {
		t.Errorf("a second pass sent %d messages; the claim on emailed_at did not hold", sent)
	}
	if n := len(rec.Sent()); n != 1 {
		t.Errorf("%d messages reached the relay in total, want 1", n)
	}

	// The notifications are still in the inbox and still unread. Email is a copy of the news,
	// never the news itself, and a digest must not quietly mark an inbox read.
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)
	if got := inbox(t, svc, bob); len(got) != 2 {
		t.Errorf("bob's inbox has %d rows after the digest, want 2", len(got))
	}
	if unread, err := svc.UnreadNotificationCount(ctx, bob); err != nil || unread != 2 {
		t.Errorf("the badge says %d after a digest (err %v), want 2", unread, err)
	}
}

// Two passes at once, which is what a second worker replica is.
//
// The claim's guard is the only thing standing between them: both passes see the same person
// as having news waiting, because they read that list before either of them has claimed
// anything. Everything above the claim can be raced; the UPDATE ... WHERE emailed_at IS NULL
// is where exactly one of them wins.
func TestDeliverNotificationDigests_TwoWorkersSendOneDigest(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	if _, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Ship the thing", AssigneeID: &bobID,
	}); err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}

	rec := mailer.NewRecorder()
	var wg sync.WaitGroup
	start := make(chan struct{})
	errs := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := svc.DeliverNotificationDigests(ctx, rec, digestOpts())
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent pass: %v", err)
		}
	}

	if n := rec.Count(); n != 1 {
		t.Errorf("two simultaneous passes sent %d messages, want 1", n)
	}
}

// A bulk edit is one inbox row carrying a count, and the digest has to say the count rather
// than naming one of two hundred issues as if it were the whole story.
func TestDeliverNotificationDigests_CountsACoalescedRow(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	ids := seedSubscribedIssues(t, f, bobID, 5)

	if _, skipped, _, err := svc.BulkUpdateIssues(ctx, alice, domain.BulkUpdateIssuesInput{
		IDs: ids, StateID: &f.InProgress,
	}); err != nil || len(skipped) != 0 {
		t.Fatalf("bulk update: %v (skipped %d)", err, len(skipped))
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}

	rec := mailer.NewRecorder()
	if _, err := svc.DeliverNotificationDigests(ctx, rec, digestOpts()); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	msgs := rec.Sent()
	if len(msgs) != 1 {
		t.Fatalf("sent %d messages, want 1", len(msgs))
	}
	if !strings.Contains(msgs[0].Text, "5 status changes on issues you follow") {
		t.Errorf("the digest does not carry the coalesced count:\n%s", msgs[0].Text)
	}
	if !strings.Contains(msgs[0].Text, "and 4 more like it") {
		t.Errorf("the digest names one issue of five without saying so:\n%s", msgs[0].Text)
	}
}

func TestDeliverNotificationDigests_HonoursTheCadencePreference(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)
	carolID := f.NewUser(t, "carol", "member", true)
	carol := f.PrincipalFor(carolID, authz.RoleMember, f.TeamID)

	// Bob wants nothing by email. Carol has said nothing, which is the default: a digest.
	if _, _, err := svc.UpdateNotificationPrefs(ctx, bob, json.RawMessage(`{"emailDigest":"off"}`)); err != nil {
		t.Fatalf("update prefs: %v", err)
	}

	issue, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{TeamID: f.TeamID, Title: "Watched"})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	for _, p := range []*authz.Principal{bob, carol} {
		if _, _, err := svc.SetIssueSubscription(ctx, p, issue.ID, true); err != nil {
			t.Fatalf("subscribe: %v", err)
		}
	}
	if _, _, err := svc.UpdateIssue(ctx, alice, domain.UpdateIssueInput{ID: issue.ID, StateID: &f.InProgress}); err != nil {
		t.Fatalf("move status: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}

	rec := mailer.NewRecorder()
	sent, err := svc.DeliverNotificationDigests(ctx, rec, digestOpts())
	if err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if sent != 1 {
		t.Fatalf("sent %d messages, want 1 — carol only", sent)
	}
	if got := rec.Sent()[0].To.Email; got != accountEmail(t, db, carolID) {
		t.Errorf("the digest went to %q; somebody who switched email off was mailed", got)
	}

	// Bob's notification is still there, unclaimed, because switching email off must not
	// consume it — he reads it in the app like everybody else.
	if got := inbox(t, svc, bob); len(got) != 1 {
		t.Errorf("bob's inbox has %d rows, want 1", len(got))
	}

	// Carol's cadence is the default, daily. More news within the day does not produce a
	// second email; it waits for tomorrow's.
	if _, _, err := svc.UpdateIssue(ctx, alice, domain.UpdateIssueInput{ID: issue.ID, StateID: &f.Done}); err != nil {
		t.Fatalf("complete: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}
	sent, err = svc.DeliverNotificationDigests(ctx, rec, digestOpts())
	if err != nil {
		t.Fatalf("second deliver: %v", err)
	}
	if sent != 0 {
		t.Errorf("a daily digest sent %d messages twice in one day", sent)
	}

	// A day later, it goes out — and carries the news that waited.
	tomorrow := digestOpts()
	tomorrow.Now = time.Now().Add(25 * time.Hour)
	sent, err = svc.DeliverNotificationDigests(ctx, rec, tomorrow)
	if err != nil {
		t.Fatalf("deliver a day later: %v", err)
	}
	if sent != 1 {
		t.Fatalf("a day later the digest sent %d messages, want 1", sent)
	}
	if last := rec.Sent()[len(rec.Sent())-1]; !strings.Contains(last.Text, "status change") {
		t.Errorf("the deferred news is missing from the next digest:\n%s", last.Text)
	}
}

// Per-notification email: the preference M1 describes, and never the default.
func TestDeliverNotificationDigests_PerNotificationIsAPreferenceAndStillSendsOnce(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	// Per-notification instead of a digest, which is the combination somebody who wants email
	// as it happens actually sets. The two keys are independent switches, and the pass that
	// honoured "digest: off" without noticing the second one would send this person nothing at
	// all — silently, since nobody reports an email that never arrived.
	if _, _, err := svc.UpdateNotificationPrefs(ctx, bob,
		json.RawMessage(`{"emailDigest":"off","emailPerNotification":true}`)); err != nil {
		t.Fatalf("update prefs: %v", err)
	}

	issue, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Ship the thing", AssigneeID: &bobID,
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, _, err := svc.CreateComment(ctx, alice, domain.CreateCommentInput{
		IssueID: issue.ID, Body: "a thought",
	}); err != nil {
		t.Fatalf("comment: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}

	rec := mailer.NewRecorder()
	sent, err := svc.DeliverNotificationDigests(ctx, rec, digestOpts())
	if err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if sent != 2 {
		t.Fatalf("sent %d messages, want one per notification (2)", sent)
	}
	// Each message is about one thing, which is the entire difference from a digest.
	for _, m := range rec.Sent() {
		if strings.Count(m.Text, "  * ") != 1 {
			t.Errorf("a per-notification email lists more than one item:\n%s", m.Text)
		}
	}

	// And the claim holds here too: per-notification does not mean per-pass.
	if sent, err = svc.DeliverNotificationDigests(ctx, rec, digestOpts()); err != nil || sent != 0 {
		t.Errorf("a second pass sent %d messages (err %v)", sent, err)
	}
}

// A relay that refuses must delay a digest, never swallow it. Without the release, an hour
// of downtime marks an hour of notifications as sent and they are never in another digest.
func TestDeliverNotificationDigests_ReleasesTheClaimWhenTheRelayRefuses(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)

	issue, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Ship the thing", AssigneeID: &bobID,
	})
	if err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}

	rec := mailer.NewRecorder()
	rec.Err = errors.New("the relay is down")
	sent, err := svc.DeliverNotificationDigests(ctx, rec, digestOpts())
	if err == nil {
		t.Fatal("a refused delivery reported success")
	}
	if sent != 0 {
		t.Fatalf("sent %d messages while the relay was down", sent)
	}
	if n := pendingEmailCount(t, db, bobID); n != 1 {
		t.Fatalf("%d notifications are still claimable after a refusal, want 1", n)
	}

	rec.Err = nil
	sent, err = svc.DeliverNotificationDigests(ctx, rec, digestOpts())
	if err != nil {
		t.Fatalf("deliver after recovery: %v", err)
	}
	if sent != 1 {
		t.Fatalf("sent %d messages after the relay came back, want 1", sent)
	}
	if !strings.Contains(rec.Sent()[0].Text, model.Identifier(f.TeamKey, issue.Number)) {
		t.Error("the digest that was refused did not come back with its news intact")
	}
}

// The inbox is the faster channel, and when it wins there is nothing left to email.
func TestDeliverNotificationDigests_SkipsWhatWasAlreadyRead(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	bob := f.PrincipalFor(bobID, authz.RoleMember, f.TeamID)

	if _, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Ship the thing", AssigneeID: &bobID,
	}); err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}
	if _, _, err := svc.MarkAllNotificationsRead(ctx, bob); err != nil {
		t.Fatalf("mark read: %v", err)
	}

	rec := mailer.NewRecorder()
	sent, err := svc.DeliverNotificationDigests(ctx, rec, digestOpts())
	if err != nil {
		t.Fatalf("deliver: %v", err)
	}
	if sent != 0 {
		t.Errorf("emailed %d messages about notifications that had already been read", sent)
	}
}

// An install with no relay configured is a supported install, and the job on it is a no-op
// rather than an hourly error.
func TestDeliverNotificationDigests_WithNoRelayConfigured(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	alice := f.Principal()
	bobID := f.NewUser(t, "bob", "member", true)
	if _, _, err := svc.CreateIssue(ctx, alice, domain.CreateIssueInput{
		TeamID: f.TeamID, Title: "Ship the thing", AssigneeID: &bobID,
	}); err != nil {
		t.Fatalf("create issue: %v", err)
	}
	if _, err := svc.FanOut(ctx, f.WorkspaceID); err != nil {
		t.Fatalf("fan out: %v", err)
	}

	m, err := mailer.New(mailer.Config{From: mailer.Address{Email: "polaris@example.com"}})
	if err != nil {
		t.Fatalf("build mailer: %v", err)
	}
	if _, err := svc.DeliverNotificationDigests(ctx, m, digestOpts()); err != nil {
		t.Fatalf("a pass with no relay configured failed: %v", err)
	}
}

// ---------------------------------------------------------------------------------------

// accountEmail is the address a user's login is under, which is where their mail goes.
func accountEmail(t *testing.T, db *store.DB, userID uuid.UUID) string {
	t.Helper()
	var email string
	err := db.Pool().QueryRow(context.Background(),
		`SELECT a.email FROM account a JOIN "user" u ON u.account_id = a.id WHERE u.id = $1`,
		userID).Scan(&email)
	if err != nil {
		t.Fatalf("read account email: %v", err)
	}
	return email
}

// pendingEmailCount is how many of somebody's notifications a delivery pass would still pick
// up — the predicate the claim uses, asserted from outside it.
func pendingEmailCount(t *testing.T, db *store.DB, userID uuid.UUID) int {
	t.Helper()
	var n int
	err := db.Pool().QueryRow(context.Background(),
		`SELECT count(*) FROM notification
		 WHERE user_id = $1 AND emailed_at IS NULL AND read_at IS NULL AND deleted_at IS NULL`,
		userID).Scan(&n)
	if err != nil {
		t.Fatalf("count pending: %v", err)
	}
	return n
}
