package domain

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Cycles are dated windows on a team. Cooldown is a gap between them, not a row, which is
// why an issue can never be assigned to one: there is nothing to point at.
//
// Cadence lives on the team the way the estimate scale does. Enabling creates the current
// window and the configured number of upcoming ones; the worker's AdvanceCycles closes a
// window that has ended, rolls unfinished work into the next, and auto-adds cycle-less
// started/completed issues while a window is open.

var cycleWeekdays = map[string]time.Weekday{
	"sunday":    time.Sunday,
	"monday":    time.Monday,
	"tuesday":   time.Tuesday,
	"wednesday": time.Wednesday,
	"thursday":  time.Thursday,
	"friday":    time.Friday,
	"saturday":  time.Saturday,
}

type UpdateTeamCyclesInput struct {
	TeamID           uuid.UUID
	Enabled          *bool
	DurationWeeks    *int
	CooldownWeeks    *int
	StartDay         *string
	UpcomingCount    *int
	AutoAddStarted   *bool
	AutoAddCompleted *bool
}

func (s *Service) UpdateTeamCycles(
	ctx context.Context, p *authz.Principal, in UpdateTeamCyclesInput,
) (model.Team, int64, error) {
	if err := validateCycleCadence(in); err != nil {
		return model.Team{}, 0, err
	}

	var out model.Team
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		before, err := s.requireTeamAccess(ctx, q, p, in.TeamID, authz.ActionTeamUpdate)
		if err != nil {
			return err
		}
		if err := refuseInheritedCycleCadence(ctx, q, before); err != nil {
			return err
		}

		row, err := q.UpdateTeamCycles(ctx, store.UpdateTeamCyclesParams{
			ID:                    in.TeamID,
			CyclesEnabled:         in.Enabled,
			CycleDurationWeeks:    int16ptr(in.DurationWeeks),
			CycleCooldownWeeks:    int16ptr(in.CooldownWeeks),
			CycleStartDay:         in.StartDay,
			CycleUpcomingCount:    int16ptr(in.UpcomingCount),
			CycleAutoAddStarted:   in.AutoAddStarted,
			CycleAutoAddCompleted: in.AutoAddCompleted,
		})
		if err != nil {
			return platform.Internal(err)
		}
		out = toTeam(row)

		now := time.Now()
		var extra []Change
		switch {
		case before.CyclesEnabled && !out.CyclesEnabled:
			extra, err = disableCycles(ctx, q, row, now)
		case out.CyclesEnabled:
			extra, err = ensureCycles(ctx, q, row, now)
		}
		if err != nil {
			return err
		}

		changes := append([]Change{{
			EntityType: "team", EntityID: out.ID, Op: OpUpsert, TeamID: &out.ID,
			Scope: authz.TeamScope(out.ID, out.Private), Payload: out,
		}}, extra...)
		propagated, err := s.propagateCycleSchedule(ctx, q, row, now)
		if err != nil {
			return err
		}
		changes = append(changes, propagated...)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...)
		return err
	})
	return out, version, err
}

func (s *Service) ListCycles(ctx context.Context, p *authz.Principal, teamID uuid.UUID) ([]model.Cycle, error) {
	q := s.db.Queries()
	team, err := q.GetTeam(ctx, teamID)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, platform.NotFound("team")
		}
		return nil, platform.Internal(err)
	}
	if !authz.Visible(p, authz.TeamScope(teamID, team.Private)) {
		return nil, platform.NotFound("team")
	}

	rows, err := q.ListCyclesForTeam(ctx, teamID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]model.Cycle, 0, len(rows))
	for _, row := range rows {
		out = append(out, toCycle(row))
	}
	return out, nil
}

func (s *Service) GetCycle(ctx context.Context, p *authz.Principal, id uuid.UUID) (model.Cycle, error) {
	q := s.db.Queries()
	row, err := q.GetCycle(ctx, id)
	if err != nil {
		if store.IsNotFound(err) {
			return model.Cycle{}, platform.NotFound("cycle")
		}
		return model.Cycle{}, platform.Internal(err)
	}
	team, err := q.GetTeam(ctx, row.TeamID)
	if err != nil {
		return model.Cycle{}, platform.Internal(err)
	}
	if !authz.Visible(p, authz.TeamScope(row.TeamID, team.Private)) {
		return model.Cycle{}, platform.NotFound("cycle")
	}
	return toCycle(row), nil
}

// AdvanceCycles closes windows that have ended, rolls unfinished work forward, fills the
// upcoming pipeline, and auto-adds cycle-less started/completed issues.
//
// now is injected so a test can stand on a cycle's ends_at rather than waiting a week.
// The worker passes time.Now().
func (s *Service) AdvanceCycles(ctx context.Context, now time.Time) (int, error) {
	teams, err := s.db.Queries().ListTeamsWithCyclesEnabled(ctx)
	if err != nil {
		return 0, platform.Internal(err)
	}
	advanced := 0
	for _, team := range teams {
		// Sub-teams that inherit a parent schedule are aligned from the parent after
		// that parent advances. Closing them independently would mint a second set of
		// windows from the child's timezone.
		_, inherited, err := cycleScheduleParent(ctx, s.db.Queries(), team)
		if err != nil {
			return advanced, err
		}
		if inherited {
			continue
		}
		if err := s.advanceTeamCycles(ctx, team, now); err != nil {
			return advanced, err
		}
		advanced++
	}
	return advanced, nil
}

func (s *Service) advanceTeamCycles(ctx context.Context, team store.Team, now time.Time) error {
	return s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		var changes []Change
		cycles, err := q.ListCyclesForTeam(ctx, team.ID)
		if err != nil {
			return platform.Internal(err)
		}

		for _, closing := range endedUncompleted(cycles, now) {
			next, created, err := nextCycleAfter(ctx, q, team, cycles, closing)
			if err != nil {
				return err
			}
			if created != nil {
				changes = append(changes, *created)
				cycles = append(cycles, store.Cycle{
					ID:          created.EntityID,
					WorkspaceID: team.WorkspaceID,
					TeamID:      team.ID,
					StartsAt:    next.StartsAt,
					EndsAt:      next.EndsAt,
				})
			}
			moved, err := rollOpenIssues(ctx, q, team, closing.ID, next.ID)
			if err != nil {
				return err
			}
			changes = append(changes, moved...)

			completed, err := q.CompleteCycle(ctx, store.CompleteCycleParams{
				ID:          closing.ID,
				CompletedAt: &now,
			})
			if err != nil {
				if store.IsNotFound(err) {
					continue
				}
				return platform.Internal(err)
			}
			changes = append(changes, cycleChange(team, toCycle(completed)))
		}

		filled, err := ensureCycles(ctx, q, team, now)
		if err != nil {
			return err
		}
		changes = append(changes, filled...)

		added, err := autoAddIssues(ctx, q, team, now)
		if err != nil {
			return err
		}
		changes = append(changes, added...)

		fresh, err := q.GetTeam(ctx, team.ID)
		if err != nil {
			return platform.Internal(err)
		}
		propagated, err := s.propagateCycleSchedule(ctx, q, fresh, now)
		if err != nil {
			return err
		}
		changes = append(changes, propagated...)

		if len(changes) == 0 {
			return nil
		}
		_, err = s.em.Emit(ctx, q, team.WorkspaceID, authz.SystemActor(), changes...)
		return err
	})
}

func validateCycleCadence(in UpdateTeamCyclesInput) error {
	if in.DurationWeeks != nil && (*in.DurationWeeks < 1 || *in.DurationWeeks > 8) {
		return platform.Validation("durationWeeks", "duration must be 1 to 8 weeks")
	}
	if in.CooldownWeeks != nil && (*in.CooldownWeeks < 0 || *in.CooldownWeeks > 8) {
		return platform.Validation("cooldownWeeks", "cooldown must be 0 to 8 weeks")
	}
	if in.UpcomingCount != nil && (*in.UpcomingCount < 1 || *in.UpcomingCount > 15) {
		return platform.Validation("upcomingCount", "upcoming count must be 1 to 15")
	}
	if in.StartDay != nil {
		if _, ok := cycleWeekdays[*in.StartDay]; !ok {
			return platform.Validation("startDay", "start day must be a weekday")
		}
	}
	return nil
}

func disableCycles(ctx context.Context, q *store.Queries, team store.Team, now time.Time) ([]Change, error) {
	var changes []Change
	cycles, err := q.ListCyclesForTeam(ctx, team.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	for _, c := range cycles {
		if cycleContains(c, now) && c.CompletedAt == nil {
			row, err := q.CompleteCycle(ctx, store.CompleteCycleParams{ID: c.ID, CompletedAt: &now})
			if err != nil {
				if store.IsNotFound(err) {
					continue
				}
				return nil, platform.Internal(err)
			}
			changes = append(changes, cycleChange(team, toCycle(row)))
		}
	}
	dropped, err := q.DeleteUpcomingCycles(ctx, store.DeleteUpcomingCyclesParams{
		TeamID: team.ID,
		Now:    now,
	})
	if err != nil {
		return nil, platform.Internal(err)
	}
	scope := authz.TeamScope(team.ID, team.Private)
	for _, id := range dropped {
		changes = append(changes, Change{
			EntityType: "cycle", EntityID: id, Op: OpDelete, TeamID: &team.ID, Scope: scope,
		})
	}
	return changes, nil
}

func ensureCycles(ctx context.Context, q *store.Queries, team store.Team, now time.Time) ([]Change, error) {
	if !team.CyclesEnabled {
		return nil, nil
	}
	cycles, err := q.ListCyclesForTeam(ctx, team.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}

	var changes []Change
	hasCurrent := false
	for _, c := range cycles {
		if cycleContains(c, now) && c.CompletedAt == nil {
			hasCurrent = true
			break
		}
	}
	if !hasCurrent {
		start, err := currentCycleStart(now, team.Timezone, team.CycleStartDay)
		if err != nil {
			return nil, err
		}
		if last := lastByStart(cycles); last != nil && !start.After(last.EndsAt) {
			start = last.EndsAt.Add(weekDuration(int(team.CycleCooldownWeeks)))
		}
		end := start.Add(weekDuration(int(team.CycleDurationWeeks)))
		created, err := insertCycle(ctx, q, team, start, end)
		if err != nil {
			return nil, err
		}
		changes = append(changes, created)
		cycles, err = q.ListCyclesForTeam(ctx, team.ID)
		if err != nil {
			return nil, platform.Internal(err)
		}
	}

	upcoming := 0
	for _, c := range cycles {
		if c.StartsAt.After(now) {
			upcoming++
		}
	}
	want := int(team.CycleUpcomingCount)
	for upcoming < want {
		last := lastByStart(cycles)
		if last == nil {
			break
		}
		start := last.EndsAt.Add(weekDuration(int(team.CycleCooldownWeeks)))
		end := start.Add(weekDuration(int(team.CycleDurationWeeks)))
		created, err := insertCycle(ctx, q, team, start, end)
		if err != nil {
			return nil, err
		}
		changes = append(changes, created)
		cycles = append(cycles, store.Cycle{
			ID: created.EntityID, StartsAt: start, EndsAt: end, Number: int32(upcoming + 1),
		})
		upcoming++
	}
	return changes, nil
}

func insertCycle(
	ctx context.Context, q *store.Queries, team store.Team, startsAt, endsAt time.Time,
) (Change, error) {
	n, err := nextCycleNumber(ctx, q, team.ID)
	if err != nil {
		return Change{}, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return Change{}, platform.Internal(err)
	}
	row, err := q.CreateCycle(ctx, store.CreateCycleParams{
		ID:          id,
		WorkspaceID: team.WorkspaceID,
		TeamID:      team.ID,
		Number:      n,
		Name:        fmt.Sprintf("Cycle %d", n),
		StartsAt:    startsAt,
		EndsAt:      endsAt,
	})
	if err != nil {
		return Change{}, platform.Internal(err)
	}
	return cycleChange(team, toCycle(row)), nil
}

func nextCycleNumber(ctx context.Context, q *store.Queries, teamID uuid.UUID) (int32, error) {
	n, err := q.LastCycleNumber(ctx, teamID)
	if store.IsNotFound(err) {
		return 1, nil
	}
	if err != nil {
		return 0, platform.Internal(err)
	}
	return n + 1, nil
}

func nextCycleAfter(
	ctx context.Context, q *store.Queries, team store.Team, cycles []store.Cycle, closing store.Cycle,
) (model.Cycle, *Change, error) {
	for _, c := range cycles {
		if c.ID == closing.ID {
			continue
		}
		if c.StartsAt.Equal(closing.EndsAt) || c.StartsAt.After(closing.EndsAt) {
			return toCycle(c), nil, nil
		}
	}
	start := closing.EndsAt.Add(weekDuration(int(team.CycleCooldownWeeks)))
	end := start.Add(weekDuration(int(team.CycleDurationWeeks)))
	created, err := insertCycle(ctx, q, team, start, end)
	if err != nil {
		return model.Cycle{}, nil, err
	}
	return model.Cycle{ID: created.EntityID, StartsAt: start, EndsAt: end}, &created, nil
}

func rollOpenIssues(
	ctx context.Context, q *store.Queries, team store.Team, from, to uuid.UUID,
) ([]Change, error) {
	open, err := q.ListOpenIssuesInCycle(ctx, &from)
	if err != nil {
		return nil, platform.Internal(err)
	}
	out := make([]Change, 0, len(open))
	for _, issue := range open {
		change, err := setIssueCycle(ctx, q, team, issue.ID, &to)
		if err != nil {
			return nil, err
		}
		out = append(out, change)
	}
	return out, nil
}

func autoAddIssues(ctx context.Context, q *store.Queries, team store.Team, now time.Time) ([]Change, error) {
	cycles, err := q.ListCyclesForTeam(ctx, team.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}

	var current *store.Cycle
	var previous *store.Cycle
	for i := range cycles {
		c := &cycles[i]
		if cycleContains(*c, now) {
			current = c
		}
		if !c.EndsAt.After(now) {
			previous = c
		}
	}

	var changes []Change
	add := func(category string, cycleID uuid.UUID) error {
		rows, err := q.ListCyclelessIssuesByCategory(ctx, store.ListCyclelessIssuesByCategoryParams{
			TeamID:   team.ID,
			Category: category,
		})
		if err != nil {
			return platform.Internal(err)
		}
		for _, issue := range rows {
			change, err := setIssueCycle(ctx, q, team, issue.ID, &cycleID)
			if err != nil {
				return err
			}
			changes = append(changes, change)
		}
		return nil
	}

	if current != nil {
		if team.CycleAutoAddStarted {
			if err := add(CategoryStarted, current.ID); err != nil {
				return nil, err
			}
		}
		if team.CycleAutoAddCompleted {
			if err := add(CategoryCompleted, current.ID); err != nil {
				return nil, err
			}
		}
		return changes, nil
	}

	// Cooldown: completed work is attributed to the cycle that just ended; started work
	// waits for the next window. There is no cycle to file started work into.
	if previous != nil && team.CycleAutoAddCompleted {
		if err := add(CategoryCompleted, previous.ID); err != nil {
			return nil, err
		}
	}
	return changes, nil
}

func setIssueCycle(
	ctx context.Context, q *store.Queries, team store.Team, issueID uuid.UUID, cycleID *uuid.UUID,
) (Change, error) {
	if err := q.SetIssueCycle(ctx, store.SetIssueCycleParams{ID: issueID, CycleID: cycleID}); err != nil {
		return Change{}, mapParentTriggerError(err)
	}
	row, err := q.GetIssue(ctx, issueID)
	if err != nil {
		return Change{}, platform.Internal(err)
	}
	return Change{
		EntityType:    "issue",
		EntityID:      issueID,
		Op:            OpUpsert,
		TeamID:        &team.ID,
		Scope:         authz.TeamScope(team.ID, team.Private),
		Payload:       toIssue(store.AsIssueRow(row), team.Key),
		ChangedFields: []string{"cycle_id"},
	}, nil
}

func cycleChange(team store.Team, c model.Cycle) Change {
	return Change{
		EntityType: "cycle", EntityID: c.ID, Op: OpUpsert, TeamID: &team.ID,
		Scope: authz.TeamScope(team.ID, team.Private), Payload: c,
	}
}

func cycleContains(c store.Cycle, now time.Time) bool {
	return !c.StartsAt.After(now) && c.EndsAt.After(now)
}

func endedUncompleted(cycles []store.Cycle, now time.Time) []store.Cycle {
	var out []store.Cycle
	for _, c := range cycles {
		if !c.EndsAt.After(now) && c.CompletedAt == nil {
			out = append(out, c)
		}
	}
	return out
}

func lastByStart(cycles []store.Cycle) *store.Cycle {
	if len(cycles) == 0 {
		return nil
	}
	last := &cycles[0]
	for i := range cycles[1:] {
		if cycles[i+1].StartsAt.After(last.StartsAt) {
			last = &cycles[i+1]
		}
	}
	return last
}

func currentCycleStart(now time.Time, timezone, startDay string) (time.Time, error) {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
	}
	want, ok := cycleWeekdays[startDay]
	if !ok {
		return time.Time{}, platform.Validation("startDay", "start day must be a weekday")
	}
	local := now.In(loc)
	candidate := time.Date(local.Year(), local.Month(), local.Day(), 0, 1, 0, 0, loc)
	for candidate.Weekday() != want || candidate.After(local) {
		candidate = candidate.AddDate(0, 0, -1)
	}
	return candidate, nil
}

func weekDuration(weeks int) time.Duration {
	return time.Duration(weeks) * 7 * 24 * time.Hour
}

func int16ptr(n *int) *int16 {
	if n == nil {
		return nil
	}
	v := int16(*n)
	return &v
}

func validateIssueCycle(ctx context.Context, q *store.Queries, teamID uuid.UUID, cycleID *uuid.UUID) error {
	if cycleID == nil {
		return nil
	}
	row, err := q.GetCycle(ctx, *cycleID)
	if err != nil {
		if store.IsNotFound(err) {
			return platform.Validation("cycleId", "no such cycle")
		}
		return platform.Internal(err)
	}
	if row.TeamID != teamID {
		return platform.Validation("cycleId", "that cycle belongs to another team")
	}
	return nil
}
