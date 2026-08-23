import { fromWire } from '~/gql/enums';
import {
  uuidv7,
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
      // The API mints a label's id, so the stand-in has to be retired when the real row
      // turns up — on the response, or on the socket, which usually gets here first.
      // Declared as data so it survives a reload taken mid-flight; see
      // `web/src/sync/reconcile.ts`.
      reconcile: {
        type: 'initiativeLabel',
        provisionalId: provisional.id,
        path: ['createInitiativeLabel', 'initiativeLabel'],
        // Name and group are what the client chose; the id is the one thing it did not
        // know. Two labels of one name in one group are refused anyway.
        match: ['workspaceId', 'name', 'parentId'],
      },
    },
  );

  return fromWire('initiativeLabel', data.createInitiativeLabel.initiativeLabel).id;
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
    await engine.mutate<{ addInitiativeLabel: { initiativeLabelLink: InitiativeLabelLink } }>({
      mutation: ADD_INITIATIVE_LABEL,
      variables: { initiativeId, labelId },
      optimistic: [
        { type: 'initiativeLabelLink', id: provisional.id, before: null, after: provisional },
      ],
      reconcile: {
        type: 'initiativeLabelLink',
        provisionalId: provisional.id,
        path: ['addInitiativeLabel', 'initiativeLabelLink'],
        // One application row per initiative and label, so this pairing is exact.
        match: ['initiativeId', 'labelId'],
      },
    });
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
