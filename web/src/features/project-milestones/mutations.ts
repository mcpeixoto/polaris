/**
 * Milestone writes, in the same bargain as every other mutation here: compute the local
 * row, hand it to `engine.mutate`, return. The store applies the patch in the same frame.
 *
 * A milestone's order is the server's to decide — `CreateProjectMilestoneInput` has no
 * sortOrder field — so the optimistic row is appended with a key that sorts after every
 * milestone this client can see, and the real key arrives with the row.
 */

import {
  byOrderKey,
  orderKeyBetween,
  uuidv7,
  type DateOnly,
  type ProjectMilestone,
  type Store,
  type UUID,
} from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import {
  CREATE_PROJECT_MILESTONE,
  DELETE_PROJECT_MILESTONE,
  UPDATE_PROJECT_MILESTONE,
} from '~/features/projects/operations';

export interface NewProjectMilestone {
  readonly projectId: UUID;
  readonly name: string;
  readonly description?: string | undefined;
  readonly targetDate?: DateOnly | undefined;
}

export async function createProjectMilestone(
  engine: SyncEngine,
  input: NewProjectMilestone,
): Promise<UUID> {
  const store = engine.store;
  const name = input.name.trim();
  if (name === '') return '';

  const now = new Date().toISOString();
  const provisional: ProjectMilestone = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    projectId: input.projectId,
    name,
    ...(input.description === undefined || input.description === ''
      ? null
      : { description: input.description }),
    ...(input.targetDate === undefined || input.targetDate === ''
      ? null
      : { targetDate: input.targetDate }),
    sortOrder: lastSortOrderIn(store, input.projectId),
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{ createProjectMilestone: { milestone: ProjectMilestone } }>({
      mutation: CREATE_PROJECT_MILESTONE,
      variables: {
        input: {
          projectId: input.projectId,
          name,
          ...(input.description === undefined || input.description === ''
            ? null
            : { description: input.description }),
          ...(input.targetDate === undefined || input.targetDate === ''
            ? null
            : { targetDate: input.targetDate }),
        },
      },
      optimistic: [
        { type: 'projectMilestone', id: provisional.id, before: null, after: provisional },
      ],
      reconcile: {
        type: 'projectMilestone',
        provisionalId: provisional.id,
        path: ['createProjectMilestone', 'milestone'],
        // And from the delta stream, which usually gets here first — the socket pushes the
        // row the moment the mutation commits, while the response is still travelling back.
        // Project and name together: names repeat across projects, "Beta" in two of them is
        // two milestones, and matching on the name alone would fold them into one.
        match: ['projectId', 'name'],
      },
    });
    return data.createProjectMilestone.milestone.id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return provisional.id;
    throw error;
  }
}

export interface ProjectMilestoneFields {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  /** `null` takes the date off; `undefined` leaves it alone. */
  readonly targetDate?: DateOnly | null | undefined;
}

export async function updateProjectMilestone(
  engine: SyncEngine,
  id: UUID,
  fields: ProjectMilestoneFields,
): Promise<void> {
  const before = engine.store.get('projectMilestone', id);
  if (before === undefined) return;

  const name = fields.name?.trim();
  const after: ProjectMilestone = {
    ...before,
    ...(name === undefined || name === '' ? null : { name }),
    ...(fields.description === undefined ? null : { description: fields.description }),
    ...(fields.targetDate === undefined
      ? null
      : { targetDate: fields.targetDate === null ? undefined : fields.targetDate }),
    updatedAt: new Date().toISOString(),
  };

  try {
    await engine.mutate({
      mutation: UPDATE_PROJECT_MILESTONE,
      variables: {
        input: {
          id,
          ...(name === undefined || name === '' ? null : { name }),
          ...(fields.description === undefined ? null : { description: fields.description }),
          ...(fields.targetDate === undefined
            ? null
            : fields.targetDate === null
              ? { clearTarget: true }
              : { targetDate: fields.targetDate }),
        },
      },
      optimistic: [{ type: 'projectMilestone', id, before, after }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

/**
 * Moves a milestone within its project — after another one, or to the front.
 *
 * `UpdateProjectMilestoneInput` takes `afterMilestoneId`/`moveToTop` rather than a raw
 * sortOrder, the same shape as `UpdateIssueInput`: the server mints the fractional key, so
 * two people dragging at once cannot pick the same one. The optimistic key is minted here
 * with `orderKeyBetween` so the row moves on the drop rather than a round trip later; the
 * server's key arrives in the delta and replaces it. The two need not agree on the string,
 * only on the order.
 *
 * `afterId` of null means the top.
 */
export async function moveProjectMilestone(
  engine: SyncEngine,
  id: UUID,
  afterId: UUID | null,
): Promise<void> {
  const store = engine.store;
  const before = store.get('projectMilestone', id);
  if (before === undefined || afterId === id) return;

  const siblings = [...store.projectMilestones.values()]
    .filter((row) => row.projectId === before.projectId && row.archivedAt === undefined)
    .sort(byOrderKey('sortOrder'));

  let lower = '';
  let rest = siblings;
  if (afterId !== null) {
    const anchorAt = siblings.findIndex((row) => row.id === afterId);
    if (anchorAt === -1) return;
    lower = siblings[anchorAt]!.sortOrder;
    rest = siblings.slice(anchorAt + 1);
  }
  // The milestone the moved one lands in front of, skipping itself: a row already sitting
  // in that gap is not one of its own neighbours.
  const following = rest.find((row) => row.id !== id);
  const sortOrder = orderKeyBetween(lower, following?.sortOrder ?? '');
  if (sortOrder === null || sortOrder === before.sortOrder) return;

  const after: ProjectMilestone = { ...before, sortOrder, updatedAt: new Date().toISOString() };
  try {
    await engine.mutate({
      mutation: UPDATE_PROJECT_MILESTONE,
      variables: {
        input: { id, ...(afterId === null ? { moveToTop: true } : { afterMilestoneId: afterId }) },
      },
      optimistic: [{ type: 'projectMilestone', id, before, after }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function deleteProjectMilestone(engine: SyncEngine, id: UUID): Promise<void> {
  const before = engine.store.get('projectMilestone', id);
  if (before === undefined) return;

  try {
    await engine.mutate({
      mutation: DELETE_PROJECT_MILESTONE,
      variables: { id },
      optimistic: [{ type: 'projectMilestone', id, before, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

/** A key that sorts after every milestone of this project the replica currently holds. */
function lastSortOrderIn(store: Store, projectId: UUID): string {
  let highest = '';
  for (const id of store.projectMilestoneIdsFor(projectId)) {
    const row = store.projectMilestones.get(id);
    if (row === undefined || row.archivedAt !== undefined) continue;
    if (row.sortOrder > highest) highest = row.sortOrder;
  }
  return `${highest}z`;
}
