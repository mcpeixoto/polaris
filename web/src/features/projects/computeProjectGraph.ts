/**
 * Project graph data from the local replica.
 *
 * v1 is live at 7-day granularity — no hourly snapshot table yet. Scope steps up as issues
 * are filed; completed and started use completedAt and startedAt. Prediction needs at least
 * one week of completed history and a Started project status.
 */

import type { Issue, Project, ProjectStatus, Store, Team, UUID } from '~/store';

export interface ProjectGraphWeek {
  readonly weekStart: string;
  readonly scope: number;
  readonly started: number;
  readonly completed: number;
  /** Points completed during this week (not cumulative). */
  readonly completedDelta: number;
}

export interface ProjectGraphPrediction {
  readonly date: string;
  readonly optimistic: string;
  readonly pessimistic: string;
}

export interface ProjectGraphAssigneeRow {
  readonly assigneeId: UUID | undefined;
  readonly name: string;
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
}

export interface ProjectGraphData {
  readonly weeks: readonly ProjectGraphWeek[];
  readonly unitLabel: 'issues' | 'points';
  readonly totalScope: number;
  readonly totalCompleted: number;
  readonly totalStarted: number;
  readonly targetDate: string | undefined;
  readonly prediction: ProjectGraphPrediction | undefined;
  readonly assignees: readonly ProjectGraphAssigneeRow[];
}

export function buildProjectGraph(store: Store, projectId: UUID): ProjectGraphData | null {
  const project = store.projects.get(projectId);
  if (
    project === undefined ||
    project.archivedAt !== undefined ||
    project.deletedAt !== undefined
  ) {
    return null;
  }

  const status = store.projectStatuses.get(project.statusId);
  if (status === undefined || !graphEligible(status)) return null;

  const issues = [...store.index.byProject(projectId)]
    .map((id) => store.issues.get(id))
    .filter((issue): issue is Issue => issue !== undefined && issue.archivedAt === undefined);

  if (issues.length === 0) return null;

  const pointValue = (issue: Issue) => issuePoints(issue, store.teams.get(issue.teamId));
  const rangeStart = graphStart(project, issues);
  const rangeEnd = graphEnd(project);
  // A project younger than two buckets is not "no graph yet", it is "no history yet", and
  // the two say different things to the person reading them. `null` is reserved for the
  // three answers that ask for an action — put the project in progress, file an issue,
  // pick a project that still exists — so a week-old project keeps its data here and the
  // view says the one true thing it can: come back when there is a second week to plot.
  const weekStarts = weeksInRange(rangeStart, rangeEnd);

  const weeks: ProjectGraphWeek[] = [];
  let previousCompleted = 0;
  for (const weekStart of weekStarts) {
    const end = endOfWeek(weekStart);
    let scope = 0;
    let started = 0;
    let completed = 0;
    for (const issue of issues) {
      if (issue.createdAt > end) continue;
      const weight = pointValue(issue);
      scope += weight;
      if (issue.completedAt !== undefined && issue.completedAt <= end) {
        completed += weight;
      }
      const startedAt = startedTimestamp(issue);
      if (startedAt !== undefined && startedAt <= end) {
        started += weight;
      }
    }
    weeks.push({
      weekStart,
      scope,
      started,
      completed,
      completedDelta: completed - previousCompleted,
    });
    previousCompleted = completed;
  }

  const totalScope = weeks[weeks.length - 1]?.scope ?? 0;
  const totalCompleted = weeks[weeks.length - 1]?.completed ?? 0;
  const totalStarted = weeks[weeks.length - 1]?.started ?? 0;
  const usesPoints = issues.some(
    (issue) => store.teams.get(issue.teamId)?.estimateScale !== 'none',
  );

  const prediction = predictCompletion(weeks, totalScope, totalCompleted, totalStarted);

  return {
    weeks,
    unitLabel: usesPoints ? 'points' : 'issues',
    totalScope,
    totalCompleted,
    totalStarted,
    targetDate: project.targetDate,
    prediction,
    assignees: assigneeBreakdown(store, issues, pointValue),
  };
}

function graphEligible(status: ProjectStatus): boolean {
  return status.category === 'started' || status.category === 'completed';
}

function graphStart(project: Project, issues: readonly Issue[]): string {
  const candidates = [
    project.startDate === undefined ? undefined : `${project.startDate}T00:00:00.000Z`,
    project.createdAt,
    ...issues.map((issue) => issue.createdAt),
  ].filter((value): value is string => value !== undefined);
  candidates.sort();
  return startOfDay(candidates[0] ?? project.createdAt);
}

function graphEnd(project: Project): string {
  const today = startOfDay(new Date().toISOString());
  if (project.targetDate === undefined) return today;
  const target = startOfDay(`${project.targetDate}T00:00:00.000Z`);
  return target > today ? target : today;
}

function issuePoints(issue: Issue, team: Team | undefined): number {
  if (team?.estimateScale === 'none') return 1;
  return issue.estimate ?? 1;
}

/**
 * When this issue started, or nothing.
 *
 * `updatedAt` used to stand in for an issue sitting in a started state without a
 * `startedAt`, which made the Started line a function of the last edit to the row: renaming
 * an issue moved the moment it began, and a chart of a busy week redrew itself every time
 * somebody fixed a typo. There is no honest proxy for a fact the row does not carry, so an
 * issue with no `startedAt` is not counted as started — except a completed one, which
 * cannot have finished without having begun.
 */
function startedTimestamp(issue: Issue): string | undefined {
  if (issue.startedAt !== undefined) return issue.startedAt;
  return issue.completedAt;
}

function predictCompletion(
  weeks: readonly ProjectGraphWeek[],
  totalScope: number,
  totalCompleted: number,
  totalStarted: number,
): ProjectGraphPrediction | undefined {
  if (weeks.length < 2) return undefined;

  const first = weeks[0]!;
  const last = weeks[weeks.length - 1]!;
  const spanMs =
    new Date(endOfWeek(last.weekStart)).getTime() - new Date(first.weekStart).getTime();
  if (spanMs < 7 * 24 * 60 * 60 * 1000) return undefined;

  const deltas = weeks.map((week) => week.completedDelta).filter((delta) => delta > 0);
  if (deltas.length === 0) return undefined;

  let weightSum = 0;
  let velocity = 0;
  for (let index = 0; index < deltas.length; index++) {
    const weight = index + 1;
    velocity += deltas[index]! * weight;
    weightSum += weight;
  }
  velocity /= weightSum;
  if (velocity <= 0) return undefined;

  const inProgress = Math.max(0, totalStarted - totalCompleted);
  const remaining = Math.max(0, totalScope - totalCompleted - inProgress * 0.25);
  if (remaining <= 0) return undefined;

  const weeksLeft = remaining / velocity;
  const base = addDays(startOfDay(new Date().toISOString()), Math.ceil(weeksLeft * 7));
  const band = Math.max(1, Math.ceil(weeksLeft * 7 * 0.4));

  return {
    date: base,
    optimistic: addDays(base, -band),
    pessimistic: addDays(base, band),
  };
}

function assigneeBreakdown(
  store: Store,
  issues: readonly Issue[],
  pointValue: (issue: Issue) => number,
): ProjectGraphAssigneeRow[] {
  const totals = new Map<string, { completed: number; total: number; assigneeId?: UUID }>();
  for (const issue of issues) {
    const key = issue.assigneeId ?? '__unassigned';
    const row = totals.get(key) ?? { completed: 0, total: 0, assigneeId: issue.assigneeId };
    const weight = pointValue(issue);
    row.total += weight;
    if (issue.completedAt !== undefined) row.completed += weight;
    totals.set(key, row);
  }

  const rows: ProjectGraphAssigneeRow[] = [];
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

function weeksInRange(startIso: string, endIso: string): string[] {
  const start = startOfDay(startIso);
  const end = startOfDay(endIso);
  const weeks: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 7)) {
    weeks.push(cursor);
  }
  return weeks.length > 0 ? weeks : [start];
}

function startOfDay(iso: string): string {
  const date = new Date(iso);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function endOfWeek(weekStart: string): string {
  return `${addDays(weekStart, 6)}T23:59:59.999Z`;
}

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
