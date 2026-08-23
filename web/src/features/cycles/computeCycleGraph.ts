/**
 * Cycle graph data from the local replica.
 *
 * Live, not a historical snapshot: completed uses completedAt, started uses startedAt,
 * and scope steps up as issues are created. A completed cycle's list may drift from the
 * chart afterwards — that is expected until snapshots land.
 *
 * The target line is even distribution of current total scope across weekdays, flattened
 * over weekends, matching Linear.
 *
 * Reading it is the view's job, and so is deciding whether there is anything to read: this
 * returns the window and the issue count beside the series precisely so the view can say
 * "not yet" without having to ask the store a second question.
 */

import { effortOf } from '~/features/estimate';
import type { Issue, Store, UUID } from '~/store';

export interface CycleGraphPoint {
  readonly day: string;
  readonly scope: number;
  readonly started: number;
  readonly completed: number;
  readonly completedDelta: number;
  readonly target: number;
}

export interface CycleGraphAssigneeRow {
  readonly assigneeId: UUID | undefined;
  readonly name: string;
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
}

export interface CycleGraphData {
  readonly points: readonly CycleGraphPoint[];
  /** The window's start, so the view can tell a planned cycle from a running one. */
  readonly startsAt: string;
  /** Issues in the cycle, which is not `totalScope`: a zero-point issue still counts. */
  readonly issueCount: number;
  readonly successPercent: number;
  readonly unitLabel: 'issues' | 'points';
  readonly totalScope: number;
  readonly totalCompleted: number;
  readonly totalStarted: number;
  readonly assignees: readonly CycleGraphAssigneeRow[];
}

export function buildCycleGraph(store: Store, cycleId: UUID): CycleGraphData | null {
  const cycle = store.cycles.get(cycleId);
  if (cycle === undefined) return null;

  const team = store.teams.get(cycle.teamId);
  if (team === undefined) return null;

  const issues = [...store.index.byCycle(cycleId)]
    .map((id) => store.issues.get(id))
    .filter((issue): issue is Issue => issue !== undefined && issue.archivedAt === undefined);

  const pointValue = (issue: Issue) => effortOf(issue, team);
  const days = daysInRange(cycle.startsAt, cycle.endsAt);
  if (days.length === 0) return null;

  const weekdayCount = days.filter((day) => !isWeekend(day)).length;
  const totalScope = issues.reduce((sum, issue) => sum + pointValue(issue), 0);

  const points: CycleGraphPoint[] = [];
  let previousCompleted = 0;
  let weekdayIndex = 0;
  let lastTarget = 0;

  for (const day of days) {
    const end = endOfDay(day);
    let scope = 0;
    let started = 0;
    let completed = 0;
    for (const issue of issues) {
      if (issue.createdAt > end) continue;
      const weight = pointValue(issue);
      scope += weight;
      if (completedBy(issue, end)) {
        completed += weight;
        started += weight;
      } else if (startedBy(store, issue, end)) {
        started += weight;
      }
    }

    let target = lastTarget;
    if (!isWeekend(day) && weekdayCount > 0) {
      weekdayIndex += 1;
      target = (weekdayIndex / weekdayCount) * totalScope;
    }
    lastTarget = target;

    points.push({
      day,
      scope,
      started,
      completed,
      completedDelta: completed - previousCompleted,
      target,
    });
    previousCompleted = completed;
  }

  const totalCompleted = issues
    .filter((issue) => issue.completedAt !== undefined)
    .reduce((sum, issue) => sum + pointValue(issue), 0);
  const totalStarted = issues
    .filter((issue) => issue.completedAt === undefined && isStarted(store, issue))
    .reduce((sum, issue) => sum + pointValue(issue), 0);

  return {
    points,
    startsAt: cycle.startsAt,
    issueCount: issues.length,
    successPercent: cycleSuccess(issues, store, pointValue),
    unitLabel: team.estimateScale === 'none' ? 'issues' : 'points',
    totalScope,
    totalCompleted,
    totalStarted,
    assignees: assigneeRows(store, issues, pointValue),
  };
}

function completedBy(issue: Issue, end: string): boolean {
  return issue.completedAt !== undefined && issue.completedAt <= end;
}

function startedBy(store: Store, issue: Issue, end: string): boolean {
  if (issue.startedAt !== undefined) return issue.startedAt <= end;
  if (issue.completedAt !== undefined) return issue.completedAt <= end;
  return isStarted(store, issue) && issue.createdAt <= end;
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

function assigneeRows(
  store: Store,
  issues: readonly Issue[],
  pointValue: (issue: Issue) => number,
): CycleGraphAssigneeRow[] {
  const totals = new Map<string, { completed: number; total: number; assigneeId?: UUID }>();
  for (const issue of issues) {
    const key = issue.assigneeId ?? '__unassigned';
    const row = totals.get(key) ?? { completed: 0, total: 0, assigneeId: issue.assigneeId };
    const weight = pointValue(issue);
    row.total += weight;
    if (issue.completedAt !== undefined) row.completed += weight;
    totals.set(key, row);
  }

  const rows: CycleGraphAssigneeRow[] = [];
  for (const [key, row] of totals) {
    const name =
      key === '__unassigned'
        ? 'Unassigned'
        : (store.users.get(row.assigneeId!)?.displayName ?? 'Someone');
    rows.push({
      assigneeId: row.assigneeId,
      name,
      completed: row.completed,
      total: row.total,
      percent: row.total === 0 ? 0 : Math.round((row.completed / row.total) * 100),
    });
  }
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return rows;
}

function daysInRange(startIso: string, endIso: string): string[] {
  const start = startOfDay(startIso);
  const end = startOfDay(endIso);
  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
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

function isWeekend(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}
