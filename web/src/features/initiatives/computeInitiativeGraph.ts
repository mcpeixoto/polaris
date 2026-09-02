/**
 * Initiative graph data — one curve per project, from the local replica.
 *
 * The spec asks for the rate of completed issues within each project, "rising in
 * high-activity periods, flattening afterwards", which is a cumulative completed count
 * plotted per project rather than the burn-up a single project gets.
 *
 * The series shape is `computeProjectGraph`'s: 7-day buckets keyed by the ISO date of the
 * week's start, `completedDelta` beside the running total so a caller can read either the
 * curve or the week's activity without differencing it back out. Counted in issues rather
 * than points, for the reason in `progress.ts` — an initiative crosses teams, and their
 * estimate scales do not add up.
 */

import { descendantProjectIds } from '~/features/initiative-updates/helpers';
import type { Issue, Store, UUID } from '~/store';

export interface InitiativeGraphWeek {
  readonly weekStart: string;
  /** Issues completed in this project up to the end of the week. */
  readonly completed: number;
  /** Issues completed during this week alone. */
  readonly completedDelta: number;
}

export interface InitiativeGraphSeries {
  readonly projectId: UUID;
  readonly name: string;
  readonly weeks: readonly InitiativeGraphWeek[];
  readonly completed: number;
  readonly total: number;
}

export interface InitiativeGraphData {
  readonly weekStarts: readonly string[];
  readonly series: readonly InitiativeGraphSeries[];
  readonly totalCompleted: number;
  readonly totalScope: number;
  /** The tallest point any curve reaches, which is what the y axis has to hold. */
  readonly peak: number;
}

/**
 * Null where there is nothing to draw: no projects, or no issues in any of them. A flat
 * line through zero is not a graph of an initiative that has not started, it is a claim
 * that it is going nowhere.
 */
export function buildInitiativeGraph(store: Store, initiativeId: UUID): InitiativeGraphData | null {
  const projectIds = descendantProjectIds(store, initiativeId);
  if (projectIds.length === 0) return null;

  const byProject = new Map<UUID, Issue[]>();
  let earliest: string | undefined;
  for (const projectId of projectIds) {
    const issues = [...store.index.byProject(projectId)]
      .map((id) => store.issues.get(id))
      .filter((issue): issue is Issue => issue !== undefined && issue.archivedAt === undefined);
    if (issues.length === 0) continue;
    byProject.set(projectId, issues);
    for (const issue of issues) {
      if (earliest === undefined || issue.createdAt < earliest) earliest = issue.createdAt;
    }
  }
  if (earliest === undefined) return null;

  const weekStarts = weeksInRange(earliest, new Date().toISOString());

  const series: InitiativeGraphSeries[] = [];
  let totalCompleted = 0;
  let totalScope = 0;
  let peak = 0;
  for (const [projectId, issues] of byProject) {
    const weeks: InitiativeGraphWeek[] = [];
    let previous = 0;
    for (const weekStart of weekStarts) {
      const end = endOfWeek(weekStart);
      let completed = 0;
      for (const issue of issues) {
        if (issue.completedAt !== undefined && issue.completedAt <= end) completed += 1;
      }
      weeks.push({ weekStart, completed, completedDelta: completed - previous });
      previous = completed;
    }
    const completed = weeks[weeks.length - 1]?.completed ?? 0;
    series.push({
      projectId,
      name: store.projects.get(projectId)?.name ?? 'Untitled project',
      weeks,
      completed,
      total: issues.length,
    });
    totalCompleted += completed;
    totalScope += issues.length;
    peak = Math.max(peak, completed);
  }

  // Busiest first: an initiative with a dozen projects is read for the ones carrying it, and
  // the legend is the only place a curve gets its name.
  series.sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));

  return { weekStarts, series, totalCompleted, totalScope, peak };
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
