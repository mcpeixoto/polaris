import { fromWire } from '~/gql/enums';
import { uuidv7, type EntityPatch, type ProjectLabel, type ProjectLabelLink, type Store, type UUID } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { DEFAULT_LABEL_COLOR } from '~/features/labels/mutations';
import {
  ADD_PROJECT_LABEL,
  ARCHIVE_PROJECT_LABEL,
  CREATE_PROJECT_LABEL,
  REMOVE_PROJECT_LABEL,
  UPDATE_PROJECT_LABEL,
} from './operations';

export interface NewProjectLabel {
  readonly name: string;
  readonly parentId?: UUID | undefined;
  readonly isGroup?: boolean | undefined;
  readonly color?: string | undefined;
  readonly description?: string | undefined;
}

export async function createProjectLabel(engine: SyncEngine, input: NewProjectLabel): Promise<UUID> {
  const store = engine.store;
  const name = input.name.trim();
  if (name === '') return '';

  const now = new Date().toISOString();
  const provisional: ProjectLabel = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    parentId: input.parentId,
    isGroup: input.isGroup === true,
    name,
    description: input.description,
    color: input.color ?? DEFAULT_LABEL_COLOR,
    position: lastPositionIn(store),
    createdAt: now,
    updatedAt: now,
  };

  const data = await engine.mutate<{ createProjectLabel: { projectLabel: ProjectLabel } }>({
    mutation: CREATE_PROJECT_LABEL,
    variables: {
      input: {
        name,
        ...(input.parentId === undefined ? null : { parentId: input.parentId }),
        ...(input.isGroup === true ? { isGroup: true } : null),
        ...(input.color === undefined ? null : { color: input.color }),
        ...(input.description === undefined || input.description === ''
          ? null
          : { description: input.description }),
      },
    },
    optimistic: [{ type: 'projectLabel', id: provisional.id, before: null, after: provisional }],
  });

  const real = data.createProjectLabel.projectLabel;
  swapLabel(store, provisional.id, real);
  return real.id;
}

export interface ProjectLabelFields {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly color?: string | undefined;
  readonly parentId?: UUID | null | undefined;
}

export async function updateProjectLabel(
  engine: SyncEngine,
  labelId: UUID,
  fields: ProjectLabelFields,
): Promise<void> {
  const before = engine.store.get('projectLabel', labelId);
  if (before === undefined) return;

  const name = fields.name?.trim();
  const after: ProjectLabel = {
    ...before,
    ...(name === undefined || name === '' ? null : { name }),
    ...(fields.description === undefined ? null : { description: fields.description }),
    ...(fields.color === undefined ? null : { color: fields.color }),
    ...(fields.parentId === undefined
      ? null
      : { parentId: fields.parentId === null ? undefined : fields.parentId }),
    updatedAt: new Date().toISOString(),
  };
  if (sameLabel(before, after)) return;

  await engine.mutate({
    mutation: UPDATE_PROJECT_LABEL,
    variables: {
      input: {
        id: labelId,
        ...(after.name === before.name ? null : { name: after.name }),
        ...(after.description === before.description ? null : { description: after.description }),
        ...(after.color === before.color ? null : { color: after.color }),
        ...(fields.parentId === undefined
          ? null
          : fields.parentId === null
            ? { clearParent: true }
            : { parentId: fields.parentId }),
      },
    },
    optimistic: [{ type: 'projectLabel', id: labelId, before, after }],
  });
}

export async function archiveProjectLabel(engine: SyncEngine, labelId: UUID): Promise<void> {
  await engine.mutate({
    mutation: ARCHIVE_PROJECT_LABEL,
    variables: { id: labelId, archived: true },
  });
}

export async function addProjectLabel(
  engine: SyncEngine,
  projectId: UUID,
  labelId: UUID,
): Promise<void> {
  const store = engine.store;
  if (store.projectLabelIdsFor(projectId).has(labelId)) return;

  const provisional: ProjectLabelLink = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    projectId,
    labelId,
    groupId: store.get('projectLabel', labelId)?.parentId,
    createdAt: new Date().toISOString(),
  };

  try {
    const data = await engine.mutate<{ addProjectLabel: { projectLabelLink: ProjectLabelLink } }>({
      mutation: ADD_PROJECT_LABEL,
      variables: { projectId, labelId },
      optimistic: [
        { type: 'projectLabelLink', id: provisional.id, before: null, after: provisional },
      ],
    });
    swapApplication(store, provisional.id, data.addProjectLabel.projectLabelLink);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function removeProjectLabel(
  engine: SyncEngine,
  projectId: UUID,
  labelId: UUID,
): Promise<void> {
  const store = engine.store;
  const before = applicationOf(store, projectId, labelId);
  if (before === undefined) return;

  await engine.mutate({
    mutation: REMOVE_PROJECT_LABEL,
    variables: { projectId, labelId },
    optimistic: [{ type: 'projectLabelLink', id: before.id, before, after: null }],
  });
}

export async function applyProjectLabel(
  engine: SyncEngine,
  projectId: UUID,
  labelId: UUID,
  displaced: readonly UUID[] = [],
): Promise<void> {
  for (const id of displaced) {
    try {
      await removeProjectLabel(engine, projectId, id);
    } catch (error) {
      if (!(error instanceof ApiError && error.isOffline)) throw error;
    }
  }
  await addProjectLabel(engine, projectId, labelId);
}

function applicationOf(store: Store, projectId: UUID, labelId: UUID): ProjectLabelLink | undefined {
  for (const rowId of store.projectLabelLinkIdsFor(projectId)) {
    const row = store.get('projectLabelLink', rowId);
    if (row !== undefined && row.labelId === labelId) return row;
  }
  return undefined;
}

function swapApplication(store: Store, provisionalId: UUID, wire: ProjectLabelLink): void {
  const real = fromWire('projectLabelLink', wire);
  const patch: EntityPatch[] = [
    {
      type: 'projectLabelLink',
      id: real.id,
      before: store.get('projectLabelLink', real.id) ?? null,
      after: real,
    },
  ];
  if (real.id !== provisionalId) {
    patch.unshift({ type: 'projectLabelLink', id: provisionalId, before: null, after: null });
  }
  store.applyOptimistic(patch);
}

function swapLabel(store: Store, provisionalId: UUID, wire: ProjectLabel): void {
  const real = fromWire('projectLabel', wire);
  const patch: EntityPatch[] = [
    {
      type: 'projectLabel',
      id: real.id,
      before: store.get('projectLabel', real.id) ?? null,
      after: real,
    },
  ];
  if (real.id !== provisionalId) {
    patch.unshift({ type: 'projectLabel', id: provisionalId, before: null, after: null });
  }
  store.applyOptimistic(patch);
}

function lastPositionIn(store: Store): string {
  let highest = '';
  for (const label of store.projectLabels.values()) {
    if (label.position > highest) highest = label.position;
  }
  return `${highest}z`;
}

function sameLabel(before: ProjectLabel, after: ProjectLabel): boolean {
  return (
    before.name === after.name &&
    before.description === after.description &&
    before.color === after.color &&
    before.parentId === after.parentId
  );
}
