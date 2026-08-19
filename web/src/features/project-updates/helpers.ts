import type { ProjectUpdate, ProjectUpdateHealth, Store, UUID } from '~/store';

export const PROJECT_UPDATE_HEALTH_LABEL: Readonly<Record<ProjectUpdateHealth, string>> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

export function latestProjectUpdate(
  store: Store,
  projectId: UUID,
): ProjectUpdate | undefined {
  let latest: ProjectUpdate | undefined;
  for (const id of store.projectUpdateIdsFor(projectId)) {
    const update = store.projectUpdates.get(id);
    if (update === undefined || update.deletedAt !== undefined) continue;
    if (latest === undefined || update.createdAt > latest.createdAt) {
      latest = update;
    }
  }
  return latest;
}

export function listProjectUpdates(store: Store, projectId: UUID): readonly ProjectUpdate[] {
  const rows: ProjectUpdate[] = [];
  for (const id of store.projectUpdateIdsFor(projectId)) {
    const update = store.projectUpdates.get(id);
    if (update === undefined || update.deletedAt !== undefined) continue;
    rows.push(update);
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows;
}
