import type { ProjectUpdate, ProjectUpdateHealth, Store, UUID } from '~/store';

export const PROJECT_UPDATE_HEALTH_LABEL: Readonly<Record<ProjectUpdateHealth, string>> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

/**
 * The colour each health reads in, as a token name.
 *
 * One table rather than the two identical ones that used to sit in `ProjectHealthBadge`
 * and in `ActiveProjectsHealth` — a badge and a roll-up dot for the same fact, free to
 * drift apart, which is how "at risk" ends up amber in a list and orange in a header.
 *
 * There is no health ramp in the token file, so these borrow: completed's green for on
 * track, and the priority ramp's amber and red for the two kinds of trouble. That is the
 * cross-ramp borrowing `08-ui-composition.md` warns about, and it is recorded here rather
 * than spread over two components so that adding `--health-*` tokens is one edit. Until
 * then, every use of these pairs the colour with the word — see `PROJECT_UPDATE_HEALTH_LABEL`
 * — because the colour is not allowed to be the only thing carrying the meaning.
 */
export const PROJECT_UPDATE_HEALTH_TOKEN: Readonly<Record<ProjectUpdateHealth, string>> = {
  on_track: '--state-completed',
  at_risk: '--priority-medium',
  off_track: '--priority-urgent',
};

export function latestProjectUpdate(store: Store, projectId: UUID): ProjectUpdate | undefined {
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
