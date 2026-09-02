/**
 * Milestones of a project, in order, with the progress each one has made.
 *
 * Progress is computed from the issues attached to the milestone rather than stored: there
 * is no percentage column anywhere, and there should not be — it would be a number that
 * goes stale every time an issue moves. A completed issue counts in full and a started one
 * counts half, which is the weighting the product describes and the reason a milestone
 * whose work is all under way reads as half done rather than as not begun.
 */

import {
  compareOrderKeys,
  type Issue,
  type ProjectMilestone,
  type Store,
  type UUID,
} from '~/store';

export interface MilestoneRow {
  readonly milestone: ProjectMilestone;
  readonly total: number;
  readonly done: number;
  readonly percent: number;
  /**
   * The next milestone with work left. Highlighted as the current focus, which is the one
   * thing a list of checkpoints has to say that a plain list does not.
   */
  readonly current: boolean;
}

export function listProjectMilestones(store: Store, projectId: UUID): MilestoneRow[] {
  const milestones = [...store.projectMilestoneIdsFor(projectId)]
    .map((id) => store.projectMilestones.get(id))
    .filter((row): row is ProjectMilestone => row !== undefined && row.archivedAt === undefined)
    .sort((a, b) => compareOrderKeys(a.sortOrder, b.sortOrder) || a.name.localeCompare(b.name));

  const issues = [...store.index.byProject(projectId)]
    .map((id) => store.issues.get(id))
    .filter((issue): issue is Issue => issue !== undefined && issue.archivedAt === undefined);

  const rows = milestones.map((milestone) => {
    let total = 0;
    let done = 0;
    for (const issue of issues) {
      if (issue.projectMilestoneId !== milestone.id) continue;
      total += 1;
      done += issueWeight(store, issue);
    }
    return {
      milestone,
      total,
      done,
      percent: total === 0 ? 0 : Math.round((done / total) * 100),
      current: false,
    };
  });

  const next = rows.findIndex((row) => row.percent < 100);
  return rows.map((row, index) => (index === next ? { ...row, current: true } : row));
}

function issueWeight(store: Store, issue: Issue): number {
  if (issue.completedAt !== undefined) return 1;
  return store.workflowStates.get(issue.stateId)?.category === 'started' ? 0.5 : 0;
}
