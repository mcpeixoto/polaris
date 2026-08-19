/**
 * Client-side dependency semantics — end→start only.
 *
 * Violation is computed from project dates in the replica: the blocking project's target
 * end must be on or before the blocked project's start. Completed blocking projects
 * satisfy their outgoing links regardless of dates.
 */

import type { Project, ProjectDependency, ProjectStatusCategory, Store, UUID } from '~/store';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(date: string): string | null {
  return DAY.test(date) ? date : null;
}

function projectStatusCategory(store: Store, project: Project): ProjectStatusCategory | undefined {
  return store.projectStatuses.get(project.statusId)?.category;
}

function isCompleted(store: Store, project: Project): boolean {
  const category = projectStatusCategory(store, project);
  return category === 'completed';
}

/** Blocking end date — target date of the blocking project. */
function blockingEnd(store: Store, blockingId: UUID): string | null {
  const project = store.projects.get(blockingId);
  if (project?.targetDate === undefined) return null;
  return parseDay(project.targetDate);
}

/** Blocked start date — start date, falling back to target date. */
function blockedStart(store: Store, blockedId: UUID): string | null {
  const project = store.projects.get(blockedId);
  if (project === undefined) return null;
  const start = project.startDate ?? project.targetDate;
  if (start === undefined) return null;
  return parseDay(start);
}

export function isDependencyViolated(store: Store, dep: ProjectDependency): boolean {
  const blocking = store.projects.get(dep.blockingProjectId);
  if (blocking === undefined) return false;
  if (isCompleted(store, blocking)) return false;

  const end = blockingEnd(store, dep.blockingProjectId);
  const start = blockedStart(store, dep.blockedProjectId);
  if (end === null || start === null) return false;
  return end > start;
}

export function projectHasDependencies(store: Store, projectId: UUID): boolean {
  return (
    store.projectDependencyBlockingIdsFor(projectId).size > 0 ||
    store.projectDependencyBlockedByIdsFor(projectId).size > 0
  );
}

export function projectHasBlockingDependency(store: Store, projectId: UUID): boolean {
  return store.projectDependencyBlockingIdsFor(projectId).size > 0;
}

export function projectHasBlockedByDependency(store: Store, projectId: UUID): boolean {
  return store.projectDependencyBlockedByIdsFor(projectId).size > 0;
}

export function projectHasViolatedDependency(store: Store, projectId: UUID): boolean {
  for (const id of store.projectDependencyBlockingIdsFor(projectId)) {
    const dep = store.projectDependencies.get(id);
    if (dep !== undefined && isDependencyViolated(store, dep)) return true;
  }
  for (const id of store.projectDependencyBlockedByIdsFor(projectId)) {
    const dep = store.projectDependencies.get(id);
    if (dep !== undefined && isDependencyViolated(store, dep)) return true;
  }
  return false;
}

export interface DependencyRow {
  readonly depId: UUID;
  readonly projectId: UUID;
  readonly name: string;
  readonly color: string;
  readonly violated: boolean;
}

export function listBlockedBy(store: Store, projectId: UUID): DependencyRow[] {
  const rows: DependencyRow[] = [];
  for (const depId of store.projectDependencyBlockedByIdsFor(projectId)) {
    const dep = store.projectDependencies.get(depId);
    if (dep === undefined) continue;
    const other = store.projects.get(dep.blockingProjectId);
    if (other === undefined) continue;
    rows.push({
      depId,
      projectId: other.id,
      name: other.name,
      color: other.color,
      violated: isDependencyViolated(store, dep),
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export function listBlocking(store: Store, projectId: UUID): DependencyRow[] {
  const rows: DependencyRow[] = [];
  for (const depId of store.projectDependencyBlockingIdsFor(projectId)) {
    const dep = store.projectDependencies.get(depId);
    if (dep === undefined) continue;
    const other = store.projects.get(dep.blockedProjectId);
    if (other === undefined) continue;
    rows.push({
      depId,
      projectId: other.id,
      name: other.name,
      color: other.color,
      violated: isDependencyViolated(store, dep),
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export type ProjectDependencyFilter =
  'all' | 'has-dependencies' | 'blocking' | 'blocked-by' | 'violated';

export function matchesDependencyFilter(
  store: Store,
  projectId: UUID,
  filter: ProjectDependencyFilter,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'has-dependencies':
      return projectHasDependencies(store, projectId);
    case 'blocking':
      return projectHasBlockingDependency(store, projectId);
    case 'blocked-by':
      return projectHasBlockedByDependency(store, projectId);
    case 'violated':
      return projectHasViolatedDependency(store, projectId);
  }
}
