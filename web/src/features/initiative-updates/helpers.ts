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

/**
 * Every live project the initiative owns, directly or through a descendant, once each.
 *
 * The spec is explicit that a parent's project list includes all descendants' projects, and
 * this is the one walk that decides what that set is. It was inlined in `linkedProjectHealths`
 * while the overview's own Projects section walked only direct links, so the health strip and
 * the list under it counted different projects on the same screen. Progress, the graph and
 * the strip all read from here now, and a change to the rule moves all three together.
 *
 * `seen` guards the initiative side of the walk — an initiative may have several parents, so
 * a diamond is reachable twice — and `taken` guards the project side, because two
 * sub-initiatives commonly contribute the same project.
 */
export function descendantProjectIds(store: Store, initiativeId: UUID): UUID[] {
  const seen = new Set<UUID>();
  const taken = new Set<UUID>();
  const projectIds: UUID[] = [];
  const walk = (id: UUID) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const linkId of store.initiativeProjectIdsFor(id)) {
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
      if (taken.has(project.id)) continue;
      taken.add(project.id);
      projectIds.push(project.id);
    }
    for (const childId of store.initiativeChildIdsFor(id)) {
      walk(childId);
    }
  };
  walk(initiativeId);
  return projectIds;
}

/** Latest project-update health for each live project linked to the initiative or its descendants. */
export function linkedProjectHealths(store: Store, initiativeId: UUID): LinkedProjectHealth[] {
  const rows: LinkedProjectHealth[] = [];
  for (const projectId of descendantProjectIds(store, initiativeId)) {
    const project = store.projects.get(projectId);
    if (project === undefined) continue;
    rows.push({
      projectId,
      name: project.name,
      health: latestProjectUpdate(store, projectId)?.health ?? null,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
