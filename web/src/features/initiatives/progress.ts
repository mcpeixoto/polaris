/**
 * How far along an initiative is, counted in issues.
 *
 * An initiative is a curated set of projects, so its progress is its projects' progress and
 * nothing else — there is no separate unit of initiative work to count. Issues rather than
 * points: an initiative spans teams, and a team with an estimate scale and a team without
 * one cannot be added together honestly. `computeProjectGraph` weights by points because a
 * project belongs to one team and that team has one answer; this does not.
 *
 * Completed is `completedAt`, the same fact the project graph plots. Canceled work is left
 * in the denominator: an initiative that cancelled half its scope has not thereby delivered
 * it, and a percentage that climbs when work is dropped is a number nobody can trust.
 */

import { latestProjectUpdate } from '~/features/project-updates/helpers';
import { descendantProjectIds } from '~/features/initiative-updates/helpers';
import { personName } from '~/features/prefs/prefs';
import type { Issue, ProjectStatusCategory, ProjectUpdateHealth, Store, UUID } from '~/store';

export interface Progress {
  readonly completed: number;
  readonly total: number;
  /** 0-100, rounded. Zero scope is 0% rather than 100%: nothing done is not everything done. */
  readonly percent: number;
}

export interface InitiativeProjectRow {
  readonly projectId: UUID;
  readonly name: string;
  readonly statusCategory: ProjectStatusCategory;
  readonly statusName: string;
  readonly health: ProjectUpdateHealth | null;
  readonly leadId: UUID | undefined;
  readonly leadName: string | null;
  readonly targetDate: string | undefined;
  readonly progress: Progress;
  /**
   * Linked to this initiative itself rather than inherited from a sub-initiative. Only a
   * direct link can be removed here — unlinking an inherited project would have to reach
   * into the initiative that actually owns it, which is not what a Remove button beside it
   * looks like it does.
   */
  readonly direct: boolean;
}

function ratio(completed: number, total: number): Progress {
  return { completed, total, percent: total === 0 ? 0 : Math.round((completed / total) * 100) };
}

function liveIssues(store: Store, projectId: UUID): Issue[] {
  return [...store.index.byProject(projectId)]
    .map((id) => store.issues.get(id))
    .filter((issue): issue is Issue => issue !== undefined && issue.archivedAt === undefined);
}

/** Completed versus total issues in one project. */
export function projectProgress(store: Store, projectId: UUID): Progress {
  const issues = liveIssues(store, projectId);
  return ratio(issues.filter((issue) => issue.completedAt !== undefined).length, issues.length);
}

/** Completed versus total issues across every project the initiative reaches. */
export function initiativeProgress(store: Store, initiativeId: UUID): Progress {
  let completed = 0;
  let total = 0;
  for (const projectId of descendantProjectIds(store, initiativeId)) {
    const issues = liveIssues(store, projectId);
    total += issues.length;
    completed += issues.filter((issue) => issue.completedAt !== undefined).length;
  }
  return ratio(completed, total);
}

/**
 * The initiative's projects with everything a row of the Projects section shows.
 *
 * Same set as the health strip above it, because both come from `descendantProjectIds`.
 */
export function listInitiativeProjectRows(
  store: Store,
  initiativeId: UUID,
): InitiativeProjectRow[] {
  const direct = new Set<UUID>();
  for (const linkId of store.initiativeProjectIdsFor(initiativeId)) {
    const link = store.initiativeProjects.get(linkId);
    if (link !== undefined) direct.add(link.projectId);
  }

  const rows: InitiativeProjectRow[] = [];
  for (const projectId of descendantProjectIds(store, initiativeId)) {
    const project = store.projects.get(projectId);
    if (project === undefined) continue;
    const status = store.projectStatuses.get(project.statusId);
    const lead = project.leadId === undefined ? undefined : store.users.get(project.leadId);
    rows.push({
      projectId,
      name: project.name,
      statusCategory: status?.category ?? 'backlog',
      statusName: status?.name ?? 'No status',
      health: latestProjectUpdate(store, projectId)?.health ?? null,
      leadId: project.leadId,
      leadName: lead === undefined ? null : personName(lead),
      targetDate: project.targetDate,
      progress: projectProgress(store, projectId),
      direct: direct.has(projectId),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
