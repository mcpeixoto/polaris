package domain

import (
	"context"
	"time"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

// Sub-teams do not own a cycle cadence. If the parent runs cycles, the child's windows
// follow that schedule: same duration, cooldown, start day, upcoming count, and the same
// start/end instants. Past child cycles stay put; a live current that does not match is
// closed; upcoming remap onto the parent's live windows.
//
// Cadence still lives on the child row — the replica has no parent join — so the Cycles
// page and the picker keep reading the team they already have. The lock is the refusal
// to UpdateTeamCycles / move dates / start-today while the parent still has cycles on.

func cycleScheduleParent(ctx context.Context, q *store.Queries, team store.Team) (store.Team, bool, error) {
	if team.ParentTeamID == nil {
		return store.Team{}, false, nil
	}
	parent, err := q.GetTeam(ctx, *team.ParentTeamID)
	if err != nil {
		if store.IsNotFound(err) {
			return store.Team{}, false, nil
		}
		return store.Team{}, false, platform.Internal(err)
	}
	if !parent.CyclesEnabled {
		return store.Team{}, false, nil
	}
	return parent, true, nil
}

func refuseInheritedCycleCadence(ctx context.Context, q *store.Queries, team store.Team) error {
	if _, ok, err := cycleScheduleParent(ctx, q, team); err != nil {
		return err
	} else if ok {
		return platform.Validation("teamId", "this sub-team inherits its parent's cycle schedule")
	}
	return nil
}

func refuseInheritedCycleDates(ctx context.Context, q *store.Queries, team store.Team) error {
	if _, ok, err := cycleScheduleParent(ctx, q, team); err != nil {
		return err
	} else if ok {
		return platform.Validation("startsAt", "this sub-team inherits its parent's cycle schedule")
	}
	return nil
}

// applyInheritedCycleSchedule copies the parent's cadence onto child and aligns live
// windows. The team upsert is included so a create/move/propagate emit stays one step.
func applyInheritedCycleSchedule(
	ctx context.Context, q *store.Queries, parent, child store.Team, now time.Time,
) (store.Team, []Change, error) {
	child, err := copyCycleCadence(ctx, q, parent, child)
	if err != nil {
		return store.Team{}, nil, err
	}
	changes := []Change{teamUpsertChange(child)}
	if !parent.CyclesEnabled {
		extra, err := disableCycles(ctx, q, child, now)
		if err != nil {
			return store.Team{}, nil, err
		}
		return child, append(changes, extra...), nil
	}
	extra, err := alignChildCyclesToParent(ctx, q, parent, child, now)
	if err != nil {
		return store.Team{}, nil, err
	}
	added, err := autoAddIssues(ctx, q, child, now)
	if err != nil {
		return store.Team{}, nil, err
	}
	return child, append(changes, append(extra, added...)...), nil
}

func (s *Service) propagateCycleSchedule(
	ctx context.Context, q *store.Queries, parent store.Team, now time.Time,
) ([]Change, error) {
	ids, err := s.collectDescendantTeamIDs(ctx, q, parent.ID)
	if err != nil {
		return nil, err
	}
	var changes []Change
	for _, id := range ids {
		child, err := q.GetTeam(ctx, id)
		if err != nil {
			return nil, platform.Internal(err)
		}
		_, extra, err := applyInheritedCycleSchedule(ctx, q, parent, child, now)
		if err != nil {
			return nil, err
		}
		changes = append(changes, extra...)
	}
	return changes, nil
}

func copyCycleCadence(ctx context.Context, q *store.Queries, parent, child store.Team) (store.Team, error) {
	duration := parent.CycleDurationWeeks
	cooldown := parent.CycleCooldownWeeks
	upcoming := parent.CycleUpcomingCount
	enabled := parent.CyclesEnabled
	start := parent.CycleStartDay
	autoStarted := parent.CycleAutoAddStarted
	autoCompleted := parent.CycleAutoAddCompleted
	row, err := q.UpdateTeamCycles(ctx, store.UpdateTeamCyclesParams{
		ID:                    child.ID,
		CyclesEnabled:         &enabled,
		CycleDurationWeeks:    &duration,
		CycleCooldownWeeks:    &cooldown,
		CycleStartDay:         &start,
		CycleUpcomingCount:    &upcoming,
		CycleAutoAddStarted:   &autoStarted,
		CycleAutoAddCompleted: &autoCompleted,
	})
	if err != nil {
		return store.Team{}, platform.Internal(err)
	}
	return row, nil
}

func alignChildCyclesToParent(
	ctx context.Context, q *store.Queries, parent, child store.Team, now time.Time,
) ([]Change, error) {
	parentCycles, err := q.ListCyclesForTeam(ctx, parent.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}
	childCycles, err := q.ListCyclesForTeam(ctx, child.ID)
	if err != nil {
		return nil, platform.Internal(err)
	}

	live := liveCycleWindows(parentCycles, now)

	var changes []Change
	var toComplete []store.Cycle
	var toDelete []store.Cycle
	matched := make([]store.Cycle, 0, len(live))

	for _, c := range childCycles {
		if c.CompletedAt != nil {
			continue
		}
		if want := cycleWithStart(live, c.StartsAt); want != nil {
			kept := c
			if !c.EndsAt.Equal(want.EndsAt) {
				ends := want.EndsAt
				updated, err := q.UpdateCycle(ctx, store.UpdateCycleParams{ID: c.ID, EndsAt: &ends})
				if err != nil {
					return nil, platform.Internal(err)
				}
				kept = updated
				changes = append(changes, cycleChange(child, toCycle(updated)))
			}
			matched = append(matched, kept)
			continue
		}
		if c.StartsAt.After(now) {
			toDelete = append(toDelete, c)
			continue
		}
		toComplete = append(toComplete, c)
	}

	for _, want := range live {
		if cycleWithStart(matched, want.StartsAt) != nil {
			continue
		}
		created, err := insertCycle(ctx, q, child, want.StartsAt, want.EndsAt)
		if err != nil {
			return nil, err
		}
		changes = append(changes, created)
		matched = append(matched, store.Cycle{
			ID: created.EntityID, StartsAt: want.StartsAt, EndsAt: want.EndsAt,
		})
	}

	dest := inheritedDestination(live, matched, now)

	for _, c := range toComplete {
		completed, err := q.CompleteCycle(ctx, store.CompleteCycleParams{ID: c.ID, CompletedAt: &now})
		if err != nil {
			if store.IsNotFound(err) {
				continue
			}
			return nil, platform.Internal(err)
		}
		changes = append(changes, cycleChange(child, toCycle(completed)))
		if dest != nil {
			moved, err := rollOpenIssues(ctx, q, child, c.ID, dest.ID)
			if err != nil {
				return nil, err
			}
			changes = append(changes, moved...)
		}
	}

	for _, c := range toDelete {
		target := nearestLiveChild(matched, c.StartsAt)
		if target == nil {
			target = dest
		}
		if target != nil {
			moved, err := rollOpenIssues(ctx, q, child, c.ID, target.ID)
			if err != nil {
				return nil, err
			}
			changes = append(changes, moved...)
		}
		id, err := q.DeleteCycle(ctx, c.ID)
		if err != nil {
			return nil, platform.Internal(err)
		}
		changes = append(changes, Change{
			EntityType: "cycle", EntityID: id, Op: OpDelete, TeamID: &child.ID,
			Scope: authz.TeamScope(child.ID, child.Private),
		})
	}

	return changes, nil
}

func liveCycleWindows(cycles []store.Cycle, now time.Time) []store.Cycle {
	var out []store.Cycle
	for _, c := range cycles {
		if c.CompletedAt != nil {
			continue
		}
		if cycleContains(c, now) || c.StartsAt.After(now) {
			out = append(out, c)
		}
	}
	return out
}

func inheritedDestination(parentLive, matched []store.Cycle, now time.Time) *store.Cycle {
	for _, p := range parentLive {
		if cycleContains(p, now) {
			if child := cycleWithStart(matched, p.StartsAt); child != nil {
				return child
			}
		}
	}
	var next *store.Cycle
	for _, p := range parentLive {
		if !p.StartsAt.After(now) {
			continue
		}
		child := cycleWithStart(matched, p.StartsAt)
		if child == nil {
			continue
		}
		if next == nil || child.StartsAt.Before(next.StartsAt) {
			next = child
		}
	}
	return next
}

func nearestLiveChild(matched []store.Cycle, at time.Time) *store.Cycle {
	var best *store.Cycle
	var bestDelta time.Duration
	for i := range matched {
		c := &matched[i]
		delta := c.StartsAt.Sub(at)
		if delta < 0 {
			delta = -delta
		}
		if best == nil || delta < bestDelta {
			best = c
			bestDelta = delta
		}
	}
	return best
}

func cycleWithStart(cycles []store.Cycle, start time.Time) *store.Cycle {
	for i := range cycles {
		if cycles[i].StartsAt.Equal(start) {
			return &cycles[i]
		}
	}
	return nil
}

func teamUpsertChange(row store.Team) Change {
	return Change{
		EntityType: "team", EntityID: row.ID, Op: OpUpsert, TeamID: &row.ID,
		Scope: authz.TeamScope(row.ID, row.Private), Payload: toTeam(row),
	}
}
