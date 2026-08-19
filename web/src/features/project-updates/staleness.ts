import type { Project, Store, UUID, Workspace } from '~/store';

import { latestProjectUpdate } from './helpers';

export type ProjectUpdateStaleness = 'none' | 'due_soon' | 'missing' | 'not_expected';

const MS_PER_DAY = 86_400_000;
const GRACE_DAYS = 3;

export function effectiveReminderIntervalDays(
  project: Pick<Project, 'updateSchedule' | 'updateReminderIntervalDays'>,
  workspace: Pick<Workspace, 'projectUpdateReminderIntervalDays'>,
): number {
  if (project.updateSchedule === 'custom' && project.updateReminderIntervalDays !== undefined) {
    return project.updateReminderIntervalDays;
  }
  return workspace.projectUpdateReminderIntervalDays;
}

export function projectUpdateStaleness(
  store: Store,
  projectId: UUID,
  now: Date = new Date(),
): ProjectUpdateStaleness {
  const project = store.projects.get(projectId);
  if (project === undefined) return 'none';

  const workspace = store.workspaces.get(store.workspaceId);
  if (workspace === undefined) return 'none';

  const status = store.projectStatuses.get(project.statusId);
  if (project.updateSchedule === 'never') return 'not_expected';
  if (status?.category === 'completed' || status?.category === 'canceled') {
    return 'not_expected';
  }
  if (status?.category !== 'started') return 'none';

  const latest = latestProjectUpdate(store, projectId);
  if (latest !== undefined && latest.health !== 'on_track') return 'none';

  const interval = effectiveReminderIntervalDays(project, workspace);
  const anchor = latest?.createdAt ?? project.createdAt;
  const daysSince = (now.getTime() - Date.parse(anchor)) / MS_PER_DAY;

  if (daysSince >= interval + GRACE_DAYS) return 'missing';
  if (daysSince >= interval) return 'due_soon';
  return 'none';
}

export const PROJECT_UPDATE_STALENESS_LABEL: Readonly<Record<ProjectUpdateStaleness, string>> = {
  none: '',
  due_soon: 'Due soon',
  missing: 'Update missing',
  not_expected: 'No update expected',
};
