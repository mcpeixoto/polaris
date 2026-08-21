/**
 * Writes the project screens make, with the optimistic patch that goes with them.
 *
 * Same bargain as the issue and label mutations: compute the local row, hand it to
 * `engine.mutate`, return. The store applies the patch in the same frame; the network
 * happens afterwards. Teams and members are individual rows, never a set on the project —
 * two people adding different teams a second apart must both survive.
 */

import { fromWire, toWire } from '~/gql/enums';
import {
  uuidv7,
  type EntityOf,
  type EntityPatch,
  type Project,
  type ProjectMember,
  type ProjectStatus,
  type ProjectStatusCategory,
  type ProjectTeam,
  type ProjectUpdateSchedule,
  type Store,
  type UUID,
} from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import {
  ADD_PROJECT_DEPENDENCY,
  ADD_PROJECT_MEMBER,
  ADD_PROJECT_TEAM,
  ARCHIVE_PROJECT_STATUS,
  CREATE_PROJECT,
  CREATE_PROJECT_STATUS,
  REMOVE_PROJECT_DEPENDENCY,
  UPDATE_PROJECT,
  UPDATE_PROJECT_STATUS,
} from './operations';

export interface NewProject {
  readonly name: string;
  readonly summary?: string | undefined;
  readonly teamIds: readonly UUID[];
  readonly leadId?: UUID | undefined;
  readonly statusId?: UUID | undefined;
  readonly projectTemplateId?: UUID | undefined;
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
    updateSchedule: 'default',
    ...(input.projectTemplateId === undefined
      ? null
      : { projectTemplateId: input.projectTemplateId }),
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
          ...(input.summary === undefined || input.summary === ''
            ? null
            : { summary: input.summary }),
          teamIds: [...input.teamIds],
          ...(input.leadId === undefined ? null : { leadId: input.leadId }),
          ...(input.statusId === undefined ? null : { statusId: input.statusId }),
          ...(input.projectTemplateId === undefined
            ? null
            : { projectTemplateId: input.projectTemplateId }),
        },
      },
      optimistic: [
        { type: 'project', id: provisional.id, before: null, after: provisional },
        ...teamRows,
      ],
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
  readonly updateSchedule?: ProjectUpdateSchedule | undefined;
  readonly updateReminderIntervalDays?: number | undefined;
  readonly updateReminderWeekday?: number | undefined;
  readonly updateReminderHour?: number | undefined;
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
    ...(fields.updateSchedule === undefined ? null : { updateSchedule: fields.updateSchedule }),
    ...(fields.updateReminderIntervalDays === undefined
      ? null
      : { updateReminderIntervalDays: fields.updateReminderIntervalDays }),
    ...(fields.updateReminderWeekday === undefined
      ? null
      : { updateReminderWeekday: fields.updateReminderWeekday }),
    ...(fields.updateReminderHour === undefined
      ? null
      : { updateReminderHour: fields.updateReminderHour }),
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
        ...(fields.updateSchedule === undefined ? null : { updateSchedule: fields.updateSchedule }),
        ...(fields.updateReminderIntervalDays === undefined
          ? null
          : { updateReminderIntervalDays: fields.updateReminderIntervalDays }),
        ...(fields.updateReminderWeekday === undefined
          ? null
          : { updateReminderWeekday: fields.updateReminderWeekday }),
        ...(fields.updateReminderHour === undefined
          ? null
          : { updateReminderHour: fields.updateReminderHour }),
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

export interface NewProjectStatus {
  readonly name: string;
  readonly category: ProjectStatusCategory;
  readonly color: string;
}

/**
 * Adds a project status at the end of its category.
 *
 * The local row is a stand-in with an id the server did not mint, swapped for the real one
 * when the reply lands — same trade as creating a workflow status.
 */
export async function createProjectStatus(
  engine: SyncEngine,
  input: NewProjectStatus,
): Promise<void> {
  const store = engine.store;
  const name = input.name.trim();
  if (name === '') return;

  const now = new Date().toISOString();
  const provisional: ProjectStatus = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    name,
    color: input.color,
    category: input.category,
    position: lastPositionIn(store, input.category),
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };

  const data = await engine.mutate<{ createProjectStatus: { status: ProjectStatus } }>({
    mutation: CREATE_PROJECT_STATUS,
    variables: {
      input: {
        name,
        category: toWire(input.category),
        color: input.color,
      },
    },
    optimistic: [{ type: 'projectStatus', id: provisional.id, before: null, after: provisional }],
  });

  const real = fromWire('projectStatus', data.createProjectStatus.status);
  const patch: EntityPatch[] = [
    {
      type: 'projectStatus',
      id: real.id,
      before: store.get('projectStatus', real.id) ?? null,
      after: real,
    },
  ];
  if (real.id !== provisional.id) {
    patch.unshift({ type: 'projectStatus', id: provisional.id, before: null, after: null });
  }
  store.applyOptimistic(patch);
}

export interface ProjectStatusFields {
  readonly name?: string | undefined;
  readonly color?: string | undefined;
  readonly makeDefault?: boolean | undefined;
}

/**
 * Renames, recolours, or promotes a project status to the workspace default.
 *
 * The default is exclusive, so promoting one demotes the other in the same patch. Sending
 * only the promotion would leave two statuses drawn as the default until the server's delta
 * arrived to settle the argument.
 */
export async function updateProjectStatus(
  engine: SyncEngine,
  statusId: UUID,
  fields: ProjectStatusFields,
): Promise<void> {
  const store = engine.store;
  const before = store.get('projectStatus', statusId);
  if (before === undefined) return;

  const name = fields.name?.trim();
  const after: ProjectStatus = {
    ...before,
    ...(name === undefined || name === '' ? null : { name }),
    ...(fields.color === undefined ? null : { color: fields.color }),
    ...(fields.makeDefault === true ? { isDefault: true } : null),
    updatedAt: new Date().toISOString(),
  };

  const patch: EntityPatch[] = [{ type: 'projectStatus', id: statusId, before, after }];
  if (fields.makeDefault === true) {
    for (const other of store.projectStatuses.values()) {
      if (other.id === statusId || !other.isDefault || other.archivedAt !== undefined) continue;
      patch.push({
        type: 'projectStatus',
        id: other.id,
        before: other,
        after: { ...other, isDefault: false },
      });
    }
  }

  await engine.mutate({
    mutation: UPDATE_PROJECT_STATUS,
    variables: {
      input: {
        id: statusId,
        ...(after.name === before.name ? null : { name: after.name }),
        ...(after.color === before.color ? null : { color: after.color }),
        ...(fields.makeDefault === true ? { isDefault: true } : null),
      },
    },
    optimistic: patch,
  });
}

/**
 * Retires a project status, and waits to find out whether it was allowed to.
 *
 * Deliberately not optimistic. The server refuses the workspace default, and a status that
 * vanished and came back would be a puzzle; a status that stays put with the refusal beside
 * it is an instruction.
 */
export async function archiveProjectStatus(engine: SyncEngine, statusId: UUID): Promise<void> {
  await engine.mutate({
    mutation: ARCHIVE_PROJECT_STATUS,
    variables: { id: statusId, archived: true },
  });
}

function defaultProjectStatusId(store: Store): UUID | undefined {
  const statuses = [...store.projectStatuses.values()].filter((s) => s.archivedAt === undefined);
  return statuses.find((s) => s.isDefault)?.id ?? statuses[0]?.id;
}

function lastPositionIn(store: Store, category: ProjectStatusCategory): string {
  let highest = '';
  for (const status of store.projectStatuses.values()) {
    if (status.archivedAt !== undefined || status.category !== category) continue;
    if (status.position > highest) highest = status.position;
  }
  return `${highest}z`;
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
