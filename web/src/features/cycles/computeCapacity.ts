/**
 * Capacity for a not-yet-started cycle: trailing three-cycle velocity, or a member-count
 * guess when the team has no completed windows yet.
 */

import { effortOf } from '~/features/estimate';
import type { Cycle, Issue, Store, UUID } from '~/store';

export interface CycleCapacity {
  readonly scoped: number;
  readonly capacity: number;
  readonly percent: number;
  readonly unitLabel: 'issues' | 'points';
  readonly source: 'velocity' | 'members';
  readonly cyclesSampled: number;
}

const POINTS_PER_MEMBER_WEEK = 5;
const VELOCITY_WINDOW = 3;

export function cycleCapacity(store: Store, cycleId: UUID, now = Date.now()): CycleCapacity | null {
  const cycle = store.cycles.get(cycleId);
  if (cycle === undefined) return null;

  const team = store.teams.get(cycle.teamId);
  if (team === undefined) return null;

  const pointValue = (issue: Issue) => effortOf(issue, team);
  const scoped = issuesOf(store, cycleId).reduce((sum, issue) => sum + pointValue(issue), 0);

  const completed = completedCycles(store, cycle.teamId, now).slice(0, VELOCITY_WINDOW);
  let capacity = 0;
  let source: CycleCapacity['source'] = 'members';

  if (completed.length > 0) {
    const totals = completed.map((window) =>
      issuesOf(store, window.id)
        .filter((issue) => issue.completedAt !== undefined)
        .reduce((sum, issue) => sum + pointValue(issue), 0),
    );
    capacity = Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length);
    source = 'velocity';
  }

  if (capacity <= 0) {
    const members = store.membershipIdsForTeam(cycle.teamId).size;
    const weeks = Math.max(cycleDurationWeeks(cycle, team.cycleDurationWeeks), 1);
    capacity = Math.max(members, 1) * weeks * POINTS_PER_MEMBER_WEEK;
    source = 'members';
  }

  return {
    scoped,
    capacity,
    percent: capacity === 0 ? 0 : Math.round((scoped / capacity) * 100),
    unitLabel: team.estimateScale === 'none' ? 'issues' : 'points',
    source,
    cyclesSampled: source === 'velocity' ? completed.length : 0,
  };
}

function issuesOf(store: Store, cycleId: UUID): Issue[] {
  const issues: Issue[] = [];
  for (const id of store.index.byCycle(cycleId)) {
    const issue = store.issues.get(id);
    if (issue === undefined || issue.archivedAt !== undefined) continue;
    issues.push(issue);
  }
  return issues;
}

function completedCycles(store: Store, teamId: UUID, now: number): Cycle[] {
  const cycles: Cycle[] = [];
  for (const id of store.cycleIdsFor(teamId)) {
    const cycle = store.cycles.get(id);
    if (cycle === undefined || cycle.archivedAt !== undefined) continue;
    const ended = cycle.completedAt !== undefined || Date.parse(cycle.endsAt) <= now;
    if (!ended) continue;
    cycles.push(cycle);
  }
  cycles.sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt));
  return cycles;
}

function cycleDurationWeeks(cycle: Cycle, fallback: number): number {
  const ms = Date.parse(cycle.endsAt) - Date.parse(cycle.startsAt);
  if (!(ms > 0)) return fallback;
  return Math.max(1, Math.round(ms / (7 * 24 * 60 * 60 * 1000)));
}
