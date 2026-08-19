/**
 * Writes the project screens make, with the optimistic patch that goes with them.
 *
 * Same bargain as the issue and label mutations: compute the local row, hand it to
 * `engine.mutate`, return. The store applies the patch in the same frame; the network
 * happens afterwards. Teams and members are individual rows, never a set on the project —
 * two people adding different teams a second apart must both survive.
 */

import { fromWire } from '~/gql/enums';
import {
  uuidv7,
  type EntityOf,
  type EntityPatch,
  type Project,
  type ProjectMember,
  type ProjectTeam,
  type Store,
  type UUID,
} from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import {
  ADD_PROJECT_DEPENDENCY,
  ADD_PROJECT_MEMBER,
  ADD_PROJECT_TEAM,
  CREATE_PROJECT,
  REMOVE_PROJECT_DEPENDENCY,
  UPDATE_PROJECT,
} from './operations';

export interface NewProject {
  readonly name: string;
  readonly summary?: string | undefined;
  readonly teamIds: readonly UUID[];
  readonly leadId?: UUID | undefined;
  readonly statusId?: UUID | undefined;
}

export async function createProject(engine: SyncEngine, input: NewProject): Promise<UUID> {
  const store = engine.store;
  const name = input.name.trim();
  if (name === '' || input.teamIds.length === 0) return '';

  const now = new Date().toISOString();
  const statusId = input.statusId ?? defaultProjectStatusId(store);
  if (statusId === undefined) return '';

  const provisional: Project = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    name,
    ...(input.summary === undefined || input.summary === '' ? null : { summary: input.summary }),
    description: '',
    color: store.projectStatuses.get(statusId)?.color ?? '',
    statusId,
    priority: 0,
    leadId: input.leadId,
    creatorId: input.leadId,
    sortOrder: 'z',
    createdAt: now,
    updatedAt: now,
  };

  const teamRows: EntityPatch[] = input.teamIds.map((teamId) => {
    const row: ProjectTeam = {
      id: uuidv7(),
      workspaceId: store.workspaceId,
      projectId: provisional.id,
      teamId,
      createdAt: now,
    };
    return { type: 'projectTeam', id: row.id, before: null, after: row };
  });

  try {
    const data = await engine.mutate<{ createProject: { project: Project } }>({
      mutation: CREATE_PROJECT,
      variables: {
        input: {
          name,
          ...(input.summary === undefined || input.summary === '' ? null : { summary: input.summary }),
          teamIds: [...input.teamIds],
          ...(input.leadId === undefined ? null : { leadId: input.leadId }),
          ...(input.statusId === undefined ? null : { statusId: input.statusId }),
        },
      },
      optimistic: [{ type: 'project', id: provisional.id, before: null, after: provisional }, ...teamRows],
    });
    const created = swapProject(store, provisional.id, data.createProject.project);
    return created;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return provisional.id;
    throw error;
  }
}

function swapProject(store: Store, provisionalId: UUID, wire: Project): UUID {
  const real = fromWire('project', wire);
  const patch: EntityPatch[] = [
    { type: 'project', id: real.id, before: store.get('project', real.id) ?? null, after: real },
  ];
  if (real.id !== provisionalId) {
    patch.unshift({ type: 'project', id: provisionalId, before: null, after: null });
  }
  store.applyOptimistic(patch);
  return real.id;
}

export interface ProjectFields {
  readonly name?: string | undefined;
  readonly summary?: string | undefined;
  readonly statusId?: UUID | undefined;
  readonly leadId?: UUID | null | undefined;
  readonly priority?: number | undefined;
  readonly afterProjectId?: UUID | undefined;
  readonly moveToTop?: boolean | undefined;
}

export async function updateProject(
  engine: SyncEngine,
  id: UUID,
  fields: ProjectFields,
): Promise<void> {
  const before = engine.store.get('project', id);
  if (before === undefined) return;

  const after: Project = {
    ...before,
    ...(fields.name === undefined ? null : { name: fields.name }),
    ...(fields.summary === undefined ? null : { summary: fields.summary }),
    ...(fields.statusId === undefined ? null : { statusId: fields.statusId }),
    ...(fields.leadId === undefined
      ? null
      : { leadId: fields.leadId === null ? undefined : fields.leadId }),
    ...(fields.priority === undefined ? null : { priority: fields.priority }),
    updatedAt: new Date().toISOString(),
  };

  await engine.mutate({
    mutation: UPDATE_PROJECT,
    variables: {
      input: {
        id,
        ...(fields.name === undefined ? null : { name: fields.name }),
        ...(fields.summary === undefined ? null : { summary: fields.summary }),
        ...(fields.statusId === undefined ? null : { statusId: fields.statusId }),
        ...(fields.leadId === undefined
          ? null
          : fields.leadId === null
            ? { clearLead: true }
            : { leadId: fields.leadId }),
        ...(fields.priority === undefined ? null : { priority: fields.priority }),
        ...(fields.afterProjectId === undefined ? null : { afterProjectId: fields.afterProjectId }),
        ...(fields.moveToTop === undefined ? null : { moveToTop: fields.moveToTop }),
      },
    },
    optimistic: [{ type: 'project', id, before, after }],
  });
}

export async function addProjectTeam(
  engine: SyncEngine,
  projectId: UUID,
  teamId: UUID,
): Promise<void> {
  const now = new Date().toISOString();
  const row: ProjectTeam = {
    id: uuidv7(),
    workspaceId: engine.store.workspaceId,
    projectId,
    teamId,
    createdAt: now,
  };
  await engine.mutate({
    mutation: ADD_PROJECT_TEAM,
    variables: { projectId, teamId },
    optimistic: [{ type: 'projectTeam', id: row.id, before: null, after: row }],
  });
}

export async function addProjectMember(
  engine: SyncEngine,
  projectId: UUID,
  userId: UUID,
): Promise<void> {
  const now = new Date().toISOString();
  const row: ProjectMember = {
    id: uuidv7(),
    workspaceId: engine.store.workspaceId,
    projectId,
    userId,
    createdAt: now,
  };
  await engine.mutate({
    mutation: ADD_PROJECT_MEMBER,
    variables: { projectId, userId },
    optimistic: [{ type: 'projectMember', id: row.id, before: null, after: row }],
  });
}

function defaultProjectStatusId(store: Store): UUID | undefined {
  const statuses = [...store.projectStatuses.values()].filter((s) => s.archivedAt === undefined);
  return statuses.find((s) => s.isDefault)?.id ?? statuses[0]?.id;
}

type ProjectDependency = EntityOf<'projectDependency'>;

export async function addProjectDependency(
  engine: SyncEngine,
  blockingProjectId: UUID,
  blockedProjectId: UUID,
): Promise<void> {
  const store = engine.store;
  const id = uuidv7();
  const now = new Date().toISOString();
  const provisional: ProjectDependency = {
    id,
    workspaceId: store.workspaceId,
    blockingProjectId,
    blockedProjectId,
    createdAt: now,
  };

  try {
    const data = await engine.mutate<{
      addProjectDependency: { projectDependency: ProjectDependency };
    }>({
      mutation: ADD_PROJECT_DEPENDENCY,
      variables: { blockingProjectId, blockedProjectId },
      optimistic: [{ type: 'projectDependency', id, before: null, after: provisional }],
    });
    const real = fromWire(
      'projectDependency',
      data.addProjectDependency.projectDependency as EntityOf<'projectDependency'>,
    );
    const patch: EntityPatch[] = [
      { type: 'projectDependency', id: real.id, before: provisional, after: real },
    ];
    if (real.id !== id) {
      patch.unshift({ type: 'projectDependency', id, before: null, after: null });
    }
    store.applyOptimistic(patch);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

/** Add a blocker for this project — blocking must finish before project may start. */
export async function addBlockedBy(
  engine: SyncEngine,
  projectId: UUID,
  blockingProjectId: UUID,
): Promise<void> {
  await addProjectDependency(engine, blockingProjectId, projectId);
}

/** Mark that this project blocks another — other must wait until this one finishes. */
export async function addBlocking(
  engine: SyncEngine,
  projectId: UUID,
  blockedProjectId: UUID,
): Promise<void> {
  await addProjectDependency(engine, projectId, blockedProjectId);
}

export async function removeProjectDependency(engine: SyncEngine, depId: UUID): Promise<void> {
  const store = engine.store;
  const before = store.get('projectDependency', depId);
  if (before === undefined) return;

  try {
    await engine.mutate({
      mutation: REMOVE_PROJECT_DEPENDENCY,
      variables: { id: depId },
      optimistic: [{ type: 'projectDependency', id: depId, before, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}
