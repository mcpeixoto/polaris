/**
 * Timeline layout for the projects page — bars, milestones and dependency lines from the
 * local replica. No server round-trip; dates and links are already on every project row.
 */

import { compareProjectsByPriority } from './projectHelpers';
import { isDependencyViolated, matchesDependencyFilter } from './dependencyHelpers';
import type { ProjectDependencyFilter } from './dependencyHelpers';
import { matchesProjectCustomerFilter, type ProjectCustomerFilter } from './customerFilter';
import type { ProjectTimelineZoom } from './display';
import { ZOOM_PX_PER_DAY } from './display';
import type { Project, ProjectMilestone, Store, UUID } from '~/store';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const RANGE_PAD_DAYS = 14;
const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 28;
const SIDEBAR_WIDTH = 240;
const MIN_BAR_WIDTH = 6;

export interface TimelineMilestone {
  readonly id: UUID;
  readonly name: string;
  readonly day: string;
  readonly x: number;
}

export interface TimelineBar {
  readonly projectId: UUID;
  readonly name: string;
  readonly color: string;
  readonly statusName: string;
  readonly startDay: string;
  readonly endDay: string;
  readonly x: number;
  readonly width: number;
  readonly rowIndex: number;
  readonly milestones: readonly TimelineMilestone[];
}

export interface TimelineDependency {
  readonly depId: UUID;
  readonly blockingProjectId: UUID;
  readonly blockedProjectId: UUID;
  readonly violated: boolean;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface TimelineMonth {
  readonly label: string;
  readonly x: number;
}

export interface UnscheduledProject {
  readonly id: UUID;
  readonly name: string;
  readonly color: string;
  readonly statusName: string;
}

export interface ProjectTimelineData {
  readonly rangeStart: string;
  readonly rangeEnd: string;
  readonly pxPerDay: number;
  readonly totalWidth: number;
  readonly totalHeight: number;
  readonly sidebarWidth: number;
  readonly headerHeight: number;
  readonly rowHeight: number;
  readonly bars: readonly TimelineBar[];
  readonly dependencies: readonly TimelineDependency[];
  readonly months: readonly TimelineMonth[];
  readonly unscheduled: readonly UnscheduledProject[];
}

export function buildProjectTimeline(
  store: Store,
  teamId: UUID | undefined,
  depFilter: ProjectDependencyFilter,
  zoom: ProjectTimelineZoom,
  showMilestones: boolean,
  showDependencies: boolean,
  customerFilter: ProjectCustomerFilter = 'all',
): ProjectTimelineData {
  const pxPerDay = ZOOM_PX_PER_DAY[zoom];
  const projects = listTimelineProjects(store, teamId, depFilter, customerFilter);

  const dated: { project: Project; startDay: string; endDay: string }[] = [];
  const unscheduled: UnscheduledProject[] = [];

  for (const project of projects) {
    const span = projectSpan(project);
    if (span === null) {
      const status = store.projectStatuses.get(project.statusId);
      unscheduled.push({
        id: project.id,
        name: project.name,
        color: project.color,
        statusName: status?.name ?? 'No status',
      });
      continue;
    }
    dated.push({ project, ...span });
  }

  const today = todayUtc();
  let rangeStart = addDays(today, -30);
  let rangeEnd = addDays(today, 90);

  if (dated.length > 0) {
    rangeStart = dated.reduce(
      (min, row) => (row.startDay < min ? row.startDay : min),
      dated[0]!.startDay,
    );
    rangeEnd = dated.reduce((max, row) => (row.endDay > max ? row.endDay : max), dated[0]!.endDay);
    rangeStart = addDays(rangeStart, -RANGE_PAD_DAYS);
    rangeEnd = addDays(rangeEnd, RANGE_PAD_DAYS);
  }

  const rangeDays = Math.max(1, daysBetween(rangeStart, rangeEnd) + 1);
  const totalWidth = Math.ceil(rangeDays * pxPerDay);
  const rowCount = dated.length + (unscheduled.length > 0 ? unscheduled.length + 1 : 0);

  const dayX = (day: string) => daysBetween(rangeStart, day) * pxPerDay;

  const bars: TimelineBar[] = dated.map((row, rowIndex) => {
    const x = dayX(row.startDay);
    const rawWidth = (daysBetween(row.startDay, row.endDay) + 1) * pxPerDay;
    const width = Math.max(MIN_BAR_WIDTH, rawWidth);
    const status = store.projectStatuses.get(row.project.statusId);

    const milestones: TimelineMilestone[] = [];
    if (showMilestones) {
      for (const milestoneId of store.projectMilestoneIdsFor(row.project.id)) {
        const milestone = store.projectMilestones.get(milestoneId);
        if (milestone === undefined || milestone.archivedAt !== undefined) continue;
        const day = parseDay(milestone.targetDate);
        if (day === null) continue;
        if (day < rangeStart || day > rangeEnd) continue;
        milestones.push({
          id: milestone.id,
          name: milestone.name,
          day,
          x: dayX(day) - x,
        });
      }
      milestones.sort((a, b) => a.day.localeCompare(b.day));
    }

    return {
      projectId: row.project.id,
      name: row.project.name,
      color: row.project.color,
      statusName: status?.name ?? 'No status',
      startDay: row.startDay,
      endDay: row.endDay,
      x,
      width,
      rowIndex,
      milestones,
    };
  });

  const barByProject = new Map(bars.map((bar) => [bar.projectId, bar]));

  const dependencies: TimelineDependency[] = [];
  if (showDependencies) {
    for (const dep of store.projectDependencies.values()) {
      const blocking = barByProject.get(dep.blockingProjectId);
      const blocked = barByProject.get(dep.blockedProjectId);
      if (blocking === undefined || blocked === undefined) continue;
      if (!projects.some((p) => p.id === dep.blockingProjectId)) continue;
      if (!projects.some((p) => p.id === dep.blockedProjectId)) continue;

      dependencies.push({
        depId: dep.id,
        blockingProjectId: dep.blockingProjectId,
        blockedProjectId: dep.blockedProjectId,
        violated: isDependencyViolated(store, dep),
        x1: blocking.x + blocking.width,
        y1: HEADER_HEIGHT + blocking.rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2,
        x2: blocked.x,
        y2: HEADER_HEIGHT + blocked.rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2,
      });
    }
  }

  return {
    rangeStart,
    rangeEnd,
    pxPerDay,
    totalWidth,
    totalHeight:
      rowCount === 0 ? HEADER_HEIGHT + ROW_HEIGHT : HEADER_HEIGHT + rowCount * ROW_HEIGHT,
    sidebarWidth: SIDEBAR_WIDTH,
    headerHeight: HEADER_HEIGHT,
    rowHeight: ROW_HEIGHT,
    bars,
    dependencies,
    months: monthHeaders(rangeStart, rangeEnd, pxPerDay),
    unscheduled,
  };
}

function listTimelineProjects(
  store: Store,
  teamId: UUID | undefined,
  depFilter: ProjectDependencyFilter,
  customerFilter: ProjectCustomerFilter,
): Project[] {
  const projects: Project[] = [];
  for (const project of store.projects.values()) {
    if (project.archivedAt !== undefined || project.deletedAt !== undefined) continue;
    if (!matchesDependencyFilter(store, project.id, depFilter)) continue;
    if (!matchesProjectCustomerFilter(store, project.id, customerFilter)) continue;
    if (teamId !== undefined) {
      const onTeam = [...store.projectTeamIdsFor(project.id)].some(
        (id) => store.projectTeams.get(id)?.teamId === teamId,
      );
      if (!onTeam) continue;
    }
    projects.push(project);
  }
  projects.sort(compareProjectsByPriority);
  return projects;
}

function projectSpan(project: Project): { startDay: string; endDay: string } | null {
  const start = parseDay(project.startDate);
  const end = parseDay(project.targetDate);
  if (start === null && end === null) return null;
  if (start !== null && end !== null) {
    return start <= end ? { startDay: start, endDay: end } : { startDay: end, endDay: start };
  }
  const day = start ?? end!;
  return { startDay: day, endDay: day };
}

function parseDay(date: string | undefined): string | null {
  if (date === undefined) return null;
  return DAY.test(date) ? date : null;
}

function dayIndex(day: string): number {
  return Math.floor(new Date(`${day}T00:00:00.000Z`).getTime() / DAY_MS);
}

function addDays(day: string, count: number): string {
  const date = new Date(dayIndex(day) * DAY_MS);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return dayIndex(end) - dayIndex(start);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthHeaders(rangeStart: string, rangeEnd: string, pxPerDay: number): TimelineMonth[] {
  const months: TimelineMonth[] = [];
  let cursor = rangeStart.slice(0, 8) + '01';
  if (cursor < rangeStart) cursor = rangeStart;

  while (cursor <= rangeEnd) {
    const x = daysBetween(rangeStart, cursor) * pxPerDay;
    const date = new Date(`${cursor}T00:00:00.000Z`);
    months.push({
      label: date.toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
      x,
    });
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const next = new Date(Date.UTC(year, month + 1, 1));
    cursor = next.toISOString().slice(0, 10);
  }
  return months;
}

/** Exported for tests — bar anchor for a project on the timeline grid. */
export function barEndX(bar: Pick<TimelineBar, 'x' | 'width'>): number {
  return bar.x + bar.width;
}

/** Exported for tests — milestone row lookup. */
export function milestonesForProject(store: Store, projectId: UUID): readonly ProjectMilestone[] {
  const rows: ProjectMilestone[] = [];
  for (const id of store.projectMilestoneIdsFor(projectId)) {
    const milestone = store.projectMilestones.get(id);
    if (milestone !== undefined && milestone.archivedAt === undefined) rows.push(milestone);
  }
  return rows;
}
