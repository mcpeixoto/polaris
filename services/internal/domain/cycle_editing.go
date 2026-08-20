package domain

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/peixotolabs/polaris/services/internal/authz"
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
	"github.com/peixotolabs/polaris/services/internal/store"
)

type UpdateCycleInput struct {
	ID               uuid.UUID
	Name             *string
	Description      *string
	ClearDescription bool
	StartsAt         *time.Time
	EndsAt           *time.Time
}

// UpdateCycle edits a cycle's name, description, and — depending on phase — its dates.
// Past windows are immutable; the current window can only move its end; upcoming windows
// can move both ends. Extending the current cycle eats into the following one.
func (s *Service) UpdateCycle(
	ctx context.Context, p *authz.Principal, in UpdateCycleInput,
) (model.Cycle, int64, error) {
	var out model.Cycle
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		row, err := q.GetCycle(ctx, in.ID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("cycle")
			}
			return platform.Internal(err)
		}
		if row.ArchivedAt != nil {
			return platform.Validation("id", "archived cycles cannot be edited")
		}

		team, err := s.requireTeamAccess(ctx, q, p, row.TeamID, authz.ActionTeamUpdate)
		if err != nil {
			return err
		}
		if in.StartsAt != nil || in.EndsAt != nil {
			if err := refuseInheritedCycleDates(ctx, q, team); err != nil {
				return err
			}
		}

		now := time.Now()
		phase := classifyCyclePhase(row, now)
		if err := validateCycleEdit(in, phase, row, now); err != nil {
			return err
		}

		cycles, err := q.ListCyclesForTeam(ctx, row.TeamID)
		if err != nil {
			return platform.Internal(err)
		}

		touchDesc := in.ClearDescription || in.Description != nil
		var desc *string
		if in.ClearDescription {
			desc = nil
		} else {
			desc = in.Description
		}

		updated, err := q.UpdateCycle(ctx, store.UpdateCycleParams{
			ID:               in.ID,
			Name:             in.Name,
			TouchDescription: &touchDesc,
			Description:      desc,
			StartsAt:         in.StartsAt,
			EndsAt:           in.EndsAt,
		})
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("cycle")
			}
			return platform.Internal(err)
		}

		for i := range cycles {
			if cycles[i].ID == updated.ID {
				cycles[i] = updated
				break
			}
		}

		var extra []Change
		if in.EndsAt != nil || in.StartsAt != nil {
			idx := cycleIndex(cycles, updated.ID)
			if idx >= 0 {
				extra, err = cascadeFollowingCycles(ctx, q, team, cycles, idx)
				if err != nil {
					return err
				}
			}
		}

		out = toCycle(updated)
		changes := append([]Change{cycleChange(team, out)}, extra...)
		if in.EndsAt != nil || in.StartsAt != nil {
			fresh, err := q.GetTeam(ctx, team.ID)
			if err != nil {
				return platform.Internal(err)
			}
			propagated, err := s.propagateCycleSchedule(ctx, q, fresh, now)
			if err != nil {
				return err
			}
			changes = append(changes, propagated...)
		}
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...)
		return err
	})
	return out, version, err
}

// StartCycleToday pulls the next upcoming cycle forward to midnight today in the team's
// timezone. An in-progress cycle is completed immediately and its open issues move into
// the started cycle. Irreversible.
func (s *Service) StartCycleToday(
	ctx context.Context, p *authz.Principal, cycleID uuid.UUID,
) (model.Cycle, int64, error) {
	var out model.Cycle
	var version int64
	err := s.db.InTx(ctx, func(ctx context.Context, q *store.Queries) error {
		target, err := q.GetCycle(ctx, cycleID)
		if err != nil {
			if store.IsNotFound(err) {
				return platform.NotFound("cycle")
			}
			return platform.Internal(err)
		}
		if target.ArchivedAt != nil || target.CompletedAt != nil {
			return platform.Validation("id", "only an upcoming cycle can be started today")
		}

		team, err := s.requireTeamAccess(ctx, q, p, target.TeamID, authz.ActionTeamUpdate)
		if err != nil {
			return err
		}
		if err := refuseInheritedCycleDates(ctx, q, team); err != nil {
			return err
		}
		if !team.CyclesEnabled {
			return platform.Validation("id", "cycles are off for this team")
		}

		now := time.Now()
		if !target.StartsAt.After(now) {
			return platform.Validation("id", "only an upcoming cycle can be started today")
		}

		cycles, err := q.ListCyclesForTeam(ctx, target.TeamID)
		if err != nil {
			return platform.Internal(err)
		}
		if next := firstUpcoming(cycles, now); next == nil || next.ID != target.ID {
			return platform.Validation("id", "only the next cycle can be started today")
		}

		todayStart, err := todayMidnight(team.Timezone, now)
		if err != nil {
			return err
		}

		var changes []Change
		for i := range cycles {
			c := cycles[i]
			if cycleContains(c, now) && c.CompletedAt == nil {
				completed, err := q.CompleteCycle(ctx, store.CompleteCycleParams{
					ID: c.ID, CompletedAt: &now,
				})
				if err != nil {
					return platform.Internal(err)
				}
				moved, err := rollOpenIssues(ctx, q, team, c.ID, target.ID)
				if err != nil {
					return err
				}
				changes = append(changes, moved...)
				changes = append(changes, cycleChange(team, toCycle(completed)))
				break
			}
		}

		duration := weekDuration(int(team.CycleDurationWeeks))
		newEnd := todayStart.Add(duration)
		updated, err := q.UpdateCycle(ctx, store.UpdateCycleParams{
			ID:       target.ID,
			StartsAt: &todayStart,
			EndsAt:   &newEnd,
		})
		if err != nil {
			return platform.Internal(err)
		}
		for i := range cycles {
			if cycles[i].ID == updated.ID {
				cycles[i] = updated
				break
			}
		}

		idx := cycleIndex(cycles, updated.ID)
		rescheduled, err := rescheduleFollowingCycles(ctx, q, team, cycles, idx)
		if err != nil {
			return err
		}
		changes = append(changes, cycleChange(team, toCycle(updated)))
		changes = append(changes, rescheduled...)

		filled, err := ensureCycles(ctx, q, team, now)
		if err != nil {
			return err
		}
		changes = append(changes, filled...)

		fresh, err := q.GetTeam(ctx, team.ID)
		if err != nil {
			return platform.Internal(err)
		}
		propagated, err := s.propagateCycleSchedule(ctx, q, fresh, now)
		if err != nil {
			return err
		}
		changes = append(changes, propagated...)

		out = toCycle(updated)
		version, err = s.em.Emit(ctx, q, p.WorkspaceID, p.Actor(), changes...)
		return err
	})
	return out, version, err
}

type editPhase int

const (
	editPhasePast editPhase = iota
	editPhaseCurrent
	editPhaseUpcoming
)

func classifyCyclePhase(c store.Cycle, now time.Time) editPhase {
	if c.CompletedAt != nil || !c.EndsAt.After(now) {
		return editPhasePast
	}
	if cycleContains(c, now) {
		return editPhaseCurrent
	}
	return editPhaseUpcoming
}

func validateCycleEdit(
	in UpdateCycleInput, phase editPhase, row store.Cycle, now time.Time,
) error {
	if in.StartsAt != nil || in.EndsAt != nil {
		if phase == editPhasePast {
			return platform.Validation("startsAt", "past cycle dates cannot be changed")
		}
		if phase == editPhaseCurrent && in.StartsAt != nil {
			return platform.Validation("startsAt", "the current cycle's start cannot be moved")
		}
	}

	starts := row.StartsAt
	ends := row.EndsAt
	if in.StartsAt != nil {
		starts = *in.StartsAt
	}
	if in.EndsAt != nil {
		ends = *in.EndsAt
	}
	if !ends.After(starts) {
		return platform.Validation("endsAt", "end must be after start")
	}
	if phase == editPhaseUpcoming && in.StartsAt != nil && !starts.After(now) {
		return platform.Validation("startsAt", "upcoming cycles cannot start in the past")
	}
	if phase == editPhaseCurrent && in.EndsAt != nil && !ends.After(now) {
		return platform.Validation("endsAt", "the current cycle cannot end in the past")
	}
	if in.Name != nil && strings.TrimSpace(*in.Name) == "" {
		return platform.Validation("name", "name cannot be blank")
	}
	return nil
}

func cascadeFollowingCycles(
	ctx context.Context,
	q *store.Queries,
	team store.Team,
	cycles []store.Cycle,
	fromIndex int,
) ([]Change, error) {
	var changes []Change
	cooldown := weekDuration(int(team.CycleCooldownWeeks))
	duration := weekDuration(int(team.CycleDurationWeeks))

	for i := fromIndex + 1; i < len(cycles); i++ {
		prev := cycles[i-1]
		c := cycles[i]
		if c.CompletedAt != nil || !c.StartsAt.After(time.Now()) {
			continue
		}
		minStart := prev.EndsAt.Add(cooldown)
		if !c.StartsAt.Before(minStart) {
			continue
		}
		newStart := minStart
		newEnd := c.EndsAt
		if !newEnd.After(newStart) {
			newEnd = newStart.Add(duration)
		}
		row, err := q.UpdateCycle(ctx, store.UpdateCycleParams{
			ID: c.ID, StartsAt: &newStart, EndsAt: &newEnd,
		})
		if err != nil {
			return nil, platform.Internal(err)
		}
		cycles[i] = row
		changes = append(changes, cycleChange(team, toCycle(row)))
	}
	return changes, nil
}

func rescheduleFollowingCycles(
	ctx context.Context,
	q *store.Queries,
	team store.Team,
	cycles []store.Cycle,
	fromIndex int,
) ([]Change, error) {
	var changes []Change
	cooldown := weekDuration(int(team.CycleCooldownWeeks))
	duration := weekDuration(int(team.CycleDurationWeeks))
	anchor := cycles[fromIndex]

	for i := fromIndex + 1; i < len(cycles); i++ {
		c := cycles[i]
		if c.CompletedAt != nil {
			continue
		}
		newStart := anchor.EndsAt.Add(cooldown)
		newEnd := newStart.Add(duration)
		row, err := q.UpdateCycle(ctx, store.UpdateCycleParams{
			ID: c.ID, StartsAt: &newStart, EndsAt: &newEnd,
		})
		if err != nil {
			return nil, platform.Internal(err)
		}
		cycles[i] = row
		anchor = row
		changes = append(changes, cycleChange(team, toCycle(row)))
	}
	return changes, nil
}

func cycleIndex(cycles []store.Cycle, id uuid.UUID) int {
	for i, c := range cycles {
		if c.ID == id {
			return i
		}
	}
	return -1
}

func firstUpcoming(cycles []store.Cycle, now time.Time) *store.Cycle {
	var next *store.Cycle
	for i := range cycles {
		c := &cycles[i]
		if c.CompletedAt != nil || !c.StartsAt.After(now) {
			continue
		}
		if next == nil || c.StartsAt.Before(next.StartsAt) {
			next = c
		}
	}
	return next
}

func todayMidnight(timezone string, now time.Time) (time.Time, error) {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
	}
	local := now.In(loc)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc), nil
}
