/**
 * Cycle graph data from the local replica.
 *
 * v1 is live, not a historical snapshot: completed uses completedAt; scope is the current
 * cycle total stepped up as issues were created. Started-over-time needs issue history and
 * stays out until that is on the stream.
 */

import type { Cycle, Issue, Store, Team, UUID } from '~/store';

export interface CycleGraphPoint {
  readonly day: string;
  readonly scope: number;
  readonly completed: number;
}

export interface CycleGraphData {
  readonly points: readonly CycleGraphPoint[];
  readonly successPercent: number;
  readonly unitLabel: 'issues' | 'points';
  readonly totalScope: number;
  readonly totalCompleted: number;
  readonly totalStarted: number;
}

export function buildCycleGraph(store: Store, cycleId: UUID): CycleGraphData | null {
  const cycle = store.cycles.get(cycleId);
  if (cycle === undefined) return null;

  const team = store.teams.get(cycle.teamId);
  if (team === undefined) return null;

  const issues = [...store.index.byCycle(cycleId)]
    .map((id) => store.issues.get(id))
    .filter((issue): issue is Issue => issue !== undefined && issue.archivedAt === undefined);

  const pointValue = (issue: Issue) => issuePoints(issue, team);
  const days = daysInRange(cycle.startsAt, cycle.endsAt);
  if (days.length === 0) return null;

  const points: CycleGraphPoint[] = [];
  for (const day of days) {
    const end = endOfDay(day);
    let scope = 0;
    let completed = 0;
    for (const issue of issues) {
      if (issue.createdAt > end) continue;
      scope += pointValue(issue);
      if (issue.completedAt !== undefined && issue.completedAt <= end) {
        completed += pointValue(issue);
      }
    }
    points.push({ day, scope, completed });
  }

  const totalScope = issues.reduce((sum, issue) => sum + pointValue(issue), 0);
  const totalCompleted = issues
    .filter((issue) => issue.completedAt !== undefined)
    .reduce((sum, issue) => sum + pointValue(issue), 0);
  const totalStarted = issues
    .filter((issue) => issue.completedAt === undefined && isStarted(store, issue))
    .reduce((sum, issue) => sum + pointValue(issue), 0);

  const successPercent = cycleSuccess(issues, store, pointValue);

  return {
    points,
    successPercent,
    unitLabel: team.estimateScale === 'none' ? 'issues' : 'points',
    totalScope,
    totalCompleted,
    totalStarted,
  };
}

function issuePoints(issue: Issue, team: Team): number {
  if (team.estimateScale === 'none') return 1;
  return issue.estimate ?? 1;
}

function isStarted(store: Store, issue: Issue): boolean {
  const state = store.workflowStates.get(issue.stateId);
  return state?.category === 'started';
}

/** Cycle Success: completed full weight, started 25%, per Linear's docs. */
function cycleSuccess(
  issues: readonly Issue[],
  store: Store,
  pointValue: (issue: Issue) => number,
): number {
  if (issues.length === 0) return 0;
  let score = 0;
  let total = 0;
  for (const issue of issues) {
    const weight = pointValue(issue);
    total += weight;
    if (issue.completedAt !== undefined) {
      score += weight;
    } else if (isStarted(store, issue)) {
      score += weight * 0.25;
    }
  }
  if (total === 0) return 0;
  return Math.round((score / total) * 100);
}

function daysInRange(startIso: string, endIso: string): string[] {
  const start = startOfDay(startIso);
  const end = startOfDay(endIso);
  const today = startOfDay(new Date().toISOString());
  const last = end < today ? end : today;
  const days: string[] = [];
  for (let cursor = start; cursor <= last; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  return days.length > 0 ? days : [start];
}

function startOfDay(iso: string): string {
  const date = new Date(iso);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function endOfDay(day: string): string {
  return `${day}T23:59:59.999Z`;
}

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
