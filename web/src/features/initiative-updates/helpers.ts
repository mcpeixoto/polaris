import { latestProjectUpdate } from '~/features/project-updates/helpers';
import type { InitiativeUpdate, ProjectUpdateHealth, Store, UUID } from '~/store';

export const INITIATIVE_UPDATE_HEALTH_LABEL: Readonly<Record<ProjectUpdateHealth, string>> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

export function latestInitiativeUpdate(
  store: Store,
  initiativeId: UUID,
): InitiativeUpdate | undefined {
  let latest: InitiativeUpdate | undefined;
  for (const id of store.initiativeUpdateIdsFor(initiativeId)) {
    const update = store.initiativeUpdates.get(id);
    if (update === undefined || update.deletedAt !== undefined) continue;
    if (latest === undefined || update.createdAt > latest.createdAt) {
      latest = update;
    }
  }
  return latest;
}

export function listInitiativeUpdates(
  store: Store,
  initiativeId: UUID,
): readonly InitiativeUpdate[] {
  const rows: InitiativeUpdate[] = [];
  for (const id of store.initiativeUpdateIdsFor(initiativeId)) {
    const update = store.initiativeUpdates.get(id);
    if (update === undefined || update.deletedAt !== undefined) continue;
    rows.push(update);
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows;
}

export interface LinkedProjectHealth {
  readonly projectId: UUID;
  readonly name: string;
  readonly health: ProjectUpdateHealth | null;
}

/** Latest project-update health for each live project linked to the initiative. */
export function linkedProjectHealths(store: Store, initiativeId: UUID): LinkedProjectHealth[] {
  const rows: LinkedProjectHealth[] = [];
  for (const linkId of store.initiativeProjectIdsFor(initiativeId)) {
    const link = store.initiativeProjects.get(linkId);
    if (link === undefined) continue;
    const project = store.projects.get(link.projectId);
    if (
      project === undefined ||
      project.archivedAt !== undefined ||
      project.deletedAt !== undefined
    ) {
      continue;
    }
    rows.push({
      projectId: project.id,
      name: project.name,
      health: latestProjectUpdate(store, project.id)?.health ?? null,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
