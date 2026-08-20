package domain_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/testutil"
)

func TestEnsureCycleCalendarFeed_MintsOnceAndStaysPersonal(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	feed, token, _, err := svc.EnsureCycleCalendarFeed(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	if !strings.HasPrefix(token, "cal_") {
		t.Fatalf("token %q should be a cal_ secret, not something a replica could guess", token)
	}
	if feed.TeamID != f.TeamID || feed.UserID != p.UserID {
		t.Fatalf("feed %+v is not this viewer on this team", feed)
	}

	again, same, version, err := svc.EnsureCycleCalendarFeed(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("ensure again: %v", err)
	}
	if again.ID != feed.ID || same != token {
		t.Fatalf("a second click minted a new feed (%s vs %s)", again.ID, feed.ID)
	}
	if version != 0 {
		t.Fatalf("idempotent ensure should not emit; version = %d", version)
	}

	otherID := f.NewUser(t, "sam", "member", true)
	other := f.PrincipalFor(otherID, authz.RoleMember, f.TeamID)
	theirs, theirsToken, _, err := svc.EnsureCycleCalendarFeed(ctx, other, f.TeamID)
	if err != nil {
		t.Fatalf("other ensure: %v", err)
	}
	if theirs.ID == feed.ID || theirsToken == token {
		t.Fatal("two members of the same team must not share a feed token")
	}
}

func TestEnsureCycleCalendarFeed_RefusesATeamTheCallerCannotSee(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()

	priv, _, err := svc.CreateTeam(ctx, f.Principal(), domain.CreateTeamInput{
		Key: "SEC", Name: "Security", Private: true,
	})
	if err != nil {
		t.Fatalf("create private team: %v", err)
	}
	outsiderID := f.NewUser(t, "out", "member", false)
	outsider := f.PrincipalFor(outsiderID, authz.RoleMember)
	if _, _, _, err := svc.EnsureCycleCalendarFeed(ctx, outsider, priv.ID); err == nil {
		t.Fatal("a member who cannot see the team must not mint a calendar of its cycles")
	}
}

func TestGetPublicCycleCalendar_ListsTheTeamWindows(t *testing.T) {
	db := testutil.NewDB(t)
	f := testutil.NewFixture(t, db)
	svc := domain.NewService(db)
	ctx := context.Background()
	p := f.Principal()

	on := true
	if _, _, err := svc.UpdateTeamCycles(ctx, p, domain.UpdateTeamCyclesInput{
		TeamID: f.TeamID, Enabled: &on,
	}); err != nil {
		t.Fatalf("enable cycles: %v", err)
	}
	_, token, _, err := svc.EnsureCycleCalendarFeed(ctx, p, f.TeamID)
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}

	ics, err := svc.GetPublicCycleCalendar(ctx, token+".ics")
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	body := string(ics.Body)
	if !strings.Contains(body, "BEGIN:VCALENDAR") || !strings.Contains(body, "BEGIN:VEVENT") {
		t.Fatalf("not an ICS calendar of cycles:\n%s", body)
	}
	if !strings.Contains(body, "VALUE=DATE") {
		t.Fatal("cycle events must be all-day so a timezone-less subscribe still lands on the right day")
	}
	if !strings.HasSuffix(ics.Filename, "-cycles.ics") {
		t.Fatalf("filename %q", ics.Filename)
	}

	if _, err := svc.GetPublicCycleCalendar(ctx, "cal_not-a-real-token"); err == nil {
		t.Fatal("an unknown token must 404, not return an empty calendar")
	}
}

func TestRenderCycleICS_AllDayExclusiveEnd(t *testing.T) {
	start := time.Date(2026, 8, 20, 0, 1, 0, 0, time.UTC)
	end := time.Date(2026, 9, 3, 0, 1, 0, 0, time.UTC)
	desc := "Ship it"
	body := string(domain.RenderCycleICS("Engineering", "UTC", []model.Cycle{{
		ID:          [16]byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16},
		Name:        "Cycle 12",
		Description: &desc,
		StartsAt:    start,
		EndsAt:      end,
	}}, start))
	if !strings.Contains(body, "DTSTART;VALUE=DATE:20260820") {
		t.Fatalf("start day missing:\n%s", body)
	}
	if !strings.Contains(body, "DTEND;VALUE=DATE:20260903") {
		t.Fatalf("exclusive end day missing:\n%s", body)
	}
	if !strings.Contains(body, "SUMMARY:Cycle 12") {
		t.Fatalf("summary missing:\n%s", body)
	}
}
