import { fromWire } from '~/gql/enums';
import {
  uuidv7,
  type EntityPatch,
  type InitiativeLabel,
  type InitiativeLabelLink,
  type Store,
  type UUID,
} from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { DEFAULT_LABEL_COLOR } from '~/features/labels/mutations';
import {
  ADD_INITIATIVE_LABEL,
  ARCHIVE_INITIATIVE_LABEL,
  CREATE_INITIATIVE_LABEL,
  REMOVE_INITIATIVE_LABEL,
  UPDATE_INITIATIVE_LABEL,
} from './operations';

export interface NewInitiativeLabel {
  readonly name: string;
  readonly parentId?: UUID | undefined;
  readonly isGroup?: boolean | undefined;
  readonly color?: string | undefined;
  readonly description?: string | undefined;
}

export async function createInitiativeLabel(
  engine: SyncEngine,
  input: NewInitiativeLabel,
): Promise<UUID> {
  const store = engine.store;
  const name = input.name.trim();
  if (name === '') return '';

  const now = new Date().toISOString();
  const provisional: InitiativeLabel = {
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

  const data = await engine.mutate<{ createInitiativeLabel: { initiativeLabel: InitiativeLabel } }>(
    {
      mutation: CREATE_INITIATIVE_LABEL,
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
      optimistic: [
        { type: 'initiativeLabel', id: provisional.id, before: null, after: provisional },
      ],
    },
  );

  const real = data.createInitiativeLabel.initiativeLabel;
  swapLabel(store, provisional.id, real);
  return real.id;
}

export interface InitiativeLabelFields {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly color?: string | undefined;
  readonly parentId?: UUID | null | undefined;
}

export async function updateInitiativeLabel(
  engine: SyncEngine,
  labelId: UUID,
  fields: InitiativeLabelFields,
): Promise<void> {
  const before = engine.store.get('initiativeLabel', labelId);
  if (before === undefined) return;

  const name = fields.name?.trim();
  const after: InitiativeLabel = {
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
    mutation: UPDATE_INITIATIVE_LABEL,
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
    optimistic: [{ type: 'initiativeLabel', id: labelId, before, after }],
  });
}

export async function archiveInitiativeLabel(engine: SyncEngine, labelId: UUID): Promise<void> {
  await engine.mutate({
    mutation: ARCHIVE_INITIATIVE_LABEL,
    variables: { id: labelId, archived: true },
  });
}

export async function addInitiativeLabel(
  engine: SyncEngine,
  initiativeId: UUID,
  labelId: UUID,
): Promise<void> {
  const store = engine.store;
  if (store.initiativeLabelIdsFor(initiativeId).has(labelId)) return;

  const provisional: InitiativeLabelLink = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    initiativeId,
    labelId,
    groupId: store.get('initiativeLabel', labelId)?.parentId,
    createdAt: new Date().toISOString(),
  };

  try {
    const data = await engine.mutate<{
      addInitiativeLabel: { initiativeLabelLink: InitiativeLabelLink };
    }>({
      mutation: ADD_INITIATIVE_LABEL,
      variables: { initiativeId, labelId },
      optimistic: [
        { type: 'initiativeLabelLink', id: provisional.id, before: null, after: provisional },
      ],
    });
    swapApplication(store, provisional.id, data.addInitiativeLabel.initiativeLabelLink);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function removeInitiativeLabel(
  engine: SyncEngine,
  initiativeId: UUID,
  labelId: UUID,
): Promise<void> {
  const store = engine.store;
  const before = applicationOf(store, initiativeId, labelId);
  if (before === undefined) return;

  await engine.mutate({
    mutation: REMOVE_INITIATIVE_LABEL,
    variables: { initiativeId, labelId },
    optimistic: [{ type: 'initiativeLabelLink', id: before.id, before, after: null }],
  });
}

export async function applyInitiativeLabel(
  engine: SyncEngine,
  initiativeId: UUID,
  labelId: UUID,
  displaced: readonly UUID[] = [],
): Promise<void> {
  for (const id of displaced) {
    try {
      await removeInitiativeLabel(engine, initiativeId, id);
    } catch (error) {
      if (!(error instanceof ApiError && error.isOffline)) throw error;
    }
  }
  await addInitiativeLabel(engine, initiativeId, labelId);
}

function applicationOf(
  store: Store,
  initiativeId: UUID,
  labelId: UUID,
): InitiativeLabelLink | undefined {
  for (const rowId of store.initiativeLabelLinkIdsFor(initiativeId)) {
    const row = store.get('initiativeLabelLink', rowId);
    if (row !== undefined && row.labelId === labelId) return row;
  }
  return undefined;
}

function swapApplication(store: Store, provisionalId: UUID, wire: InitiativeLabelLink): void {
  const real = fromWire('initiativeLabelLink', wire);
  const patch: EntityPatch[] = [
    {
      type: 'initiativeLabelLink',
      id: real.id,
      before: store.get('initiativeLabelLink', real.id) ?? null,
      after: real,
    },
  ];
  if (real.id !== provisionalId) {
    patch.unshift({ type: 'initiativeLabelLink', id: provisionalId, before: null, after: null });
  }
  store.applyOptimistic(patch);
}

function swapLabel(store: Store, provisionalId: UUID, wire: InitiativeLabel): void {
  const real = fromWire('initiativeLabel', wire);
  const patch: EntityPatch[] = [
    {
      type: 'initiativeLabel',
      id: real.id,
      before: store.get('initiativeLabel', real.id) ?? null,
      after: real,
    },
  ];
  if (real.id !== provisionalId) {
    patch.unshift({ type: 'initiativeLabel', id: provisionalId, before: null, after: null });
  }
  store.applyOptimistic(patch);
}

function lastPositionIn(store: Store): string {
  let highest = '';
  for (const label of store.initiativeLabels.values()) {
    if (label.position > highest) highest = label.position;
  }
  return `${highest}z`;
}

function sameLabel(before: InitiativeLabel, after: InitiativeLabel): boolean {
  return (
    before.name === after.name &&
    before.description === after.description &&
    before.color === after.color &&
    before.parentId === after.parentId
  );
}
