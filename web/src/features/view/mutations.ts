/**
 * The writes behind saved views, remembered display options and favourites.
 *
 * The same bargain the rest of the client strikes: compute the change locally, hand it to
 * `engine.mutate` with the mutation, and return. The store applies the patch synchronously,
 * the sidebar re-renders inside the frame, and the network happens afterwards to somebody
 * else's schedule.
 *
 * Three things here are specific to this feature and are the reason it is a file rather than
 * three helpers next to their components.
 *
 * **A view's id is the server's.** `CreateViewInput` has no `id` field, so the local row is a
 * stand-in swapped for the real one when the reply lands. Acceptable for the same reason it
 * is acceptable for a label: a view is saved on a screen by somebody who is watching, not
 * queued behind an hour of tunnel. An issue is the exception that mints its own id, and it
 * earns that by being created offline on a train.
 *
 * **A favourite is removed by what it points at, not by its id.** The API is
 * `removeFavorite(kind, targetId)`, which makes the call idempotent — un-favouriting
 * something that is not favourited is not an error — but means the optimistic patch has to
 * find the local row first. `favoriteIdsForTarget` is the index for that.
 *
 * **`kind` is an enum on the wire and a lower-case union in the store.** Both directions go
 * through `~/gql/enums`; the file there explains what happens when they do not, which is that
 * the value is present, plausible and equal to nothing any reader compares against.
 */

import { fromWire, toWire } from '~/gql/enums';
import {
  uuidv7,
  type EntityPatch,
  type Favorite,
  type FavoriteKind,
  type Store,
  type UUID,
  type View,
  type ViewPreference,
  type ViewSubscription,
} from '~/store';
import type { DisplayOptions, FilterNode } from '~/filter';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import {
  ADD_FAVORITE,
  CREATE_FAVORITE_FOLDER,
  CREATE_VIEW,
  DELETE_VIEW,
  DELETE_VIEW_SUBSCRIPTION,
  MOVE_FAVORITE,
  REMOVE_FAVORITE,
  SET_VIEW_PREFERENCE,
  SET_VIEW_SUBSCRIPTION,
  UPDATE_FAVORITE_FOLDER,
  UPDATE_VIEW,
} from './operations';

export interface NewView {
  readonly name: string;
  readonly filter: FilterNode;
  readonly display?: DisplayOptions | undefined;
  readonly description?: string | undefined;
  /** Absent makes it a workspace view, offered everywhere. */
  readonly teamId?: UUID | undefined;
  /** Attaches the view as a tab on this project. */
  readonly projectId?: UUID | undefined;
  /**
   * Keeps the view to its creator. Can be flipped later with `updateView({ private })`.
   */
  readonly private?: boolean | undefined;
  readonly icon?: string | undefined;
  readonly color?: string | undefined;
  /** The viewer, when it is known. Only used by the optimistic row. */
  readonly ownerId?: UUID | undefined;
}

export interface ViewFields {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly icon?: string | undefined;
  readonly color?: string | undefined;
  readonly filter?: FilterNode | undefined;
  readonly display?: DisplayOptions | undefined;
  readonly afterViewId?: UUID | undefined;
  /**
   * True keeps the view to `ownerId`. False shares it. Omit to leave sharing unchanged.
   *
   * The optimistic row has to match the server's owner_id rule or the sidebar shows the
   * view in the wrong section for one round trip.
   */
  readonly private?: boolean | undefined;
  readonly ownerId?: UUID | undefined;
}

/** Saves the current filter and display options as a named view, returning its local id. */
export async function createView(engine: SyncEngine, input: NewView): Promise<UUID> {
  const store = engine.store;
  const name = input.name.trim();
  if (name === '') return '';

  const now = new Date().toISOString();
  const provisional: View = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    ...(input.teamId === undefined ? null : { teamId: input.teamId }),
    ...(input.projectId === undefined ? null : { projectId: input.projectId }),
    // A private view has an owner; a shared one has none. The optimistic row has to agree
    // with that rule or the sidebar shows the view in the wrong section for one round trip.
    ...(input.private === true && input.ownerId !== undefined ? { ownerId: input.ownerId } : null),
    name,
    ...(input.description === undefined ? null : { description: input.description }),
    ...(input.icon === undefined ? null : { icon: input.icon }),
    ...(input.color === undefined ? null : { color: input.color }),
    filter: input.filter,
    display: input.display ?? {},
    position: lastViewPosition(store, input.teamId, input.projectId),
    ...(input.ownerId === undefined ? null : { createdBy: input.ownerId }),
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{ createView: { view: View } }>({
      mutation: CREATE_VIEW,
      variables: {
        input: {
          name,
          filter: input.filter,
          ...(input.teamId === undefined ? null : { teamId: input.teamId }),
          ...(input.projectId === undefined ? null : { projectId: input.projectId }),
          ...(input.private === undefined ? null : { private: input.private }),
          ...(input.description === undefined ? null : { description: input.description }),
          ...(input.icon === undefined ? null : { icon: input.icon }),
          ...(input.color === undefined ? null : { color: input.color }),
          ...(input.display === undefined ? null : { display: input.display }),
        },
      },
      optimistic: [{ type: 'view', id: provisional.id, before: null, after: provisional }],
      reconcile: {
        type: 'view',
        provisionalId: provisional.id,
        path: ['createView', 'view'],
      },
    });
    return data.createView.view.id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return provisional.id;
    throw error;
  }
}

/** Renames a view, or replaces the filter it saved with the one currently on screen. */
export async function updateView(engine: SyncEngine, id: UUID, fields: ViewFields): Promise<void> {
  const store = engine.store;
  const before = store.get('view', id);
  if (before === undefined) return;

  const { ownerId: previousOwner, ...rest } = before;
  const after: View = {
    ...rest,
    ...(fields.private === true && fields.ownerId !== undefined
      ? { ownerId: fields.ownerId }
      : fields.private === false
        ? null
        : previousOwner === undefined
          ? null
          : { ownerId: previousOwner }),
    ...(fields.name === undefined ? null : { name: fields.name.trim() }),
    ...(fields.description === undefined ? null : { description: fields.description }),
    ...(fields.icon === undefined ? null : { icon: fields.icon }),
    ...(fields.color === undefined ? null : { color: fields.color }),
    ...(fields.filter === undefined ? null : { filter: fields.filter }),
    ...(fields.display === undefined ? null : { display: fields.display }),
    updatedAt: new Date().toISOString(),
  };

  await engine.mutate({
    mutation: UPDATE_VIEW,
    variables: {
      input: {
        id,
        ...(fields.name === undefined ? null : { name: fields.name.trim() }),
        ...(fields.description === undefined ? null : { description: fields.description }),
        ...(fields.icon === undefined ? null : { icon: fields.icon }),
        ...(fields.color === undefined ? null : { color: fields.color }),
        ...(fields.filter === undefined ? null : { filter: fields.filter }),
        ...(fields.display === undefined ? null : { display: fields.display }),
        ...(fields.afterViewId === undefined ? null : { afterViewId: fields.afterViewId }),
        ...(fields.private === undefined ? null : { private: fields.private }),
      },
    },
    optimistic: [{ type: 'view', id, before, after }],
  });
}

/**
 * Deletes a saved view.
 *
 * Optimistic, unlike most destructive writes here, because there is nothing to lose that the
 * server holds: a view is a name over a filter, and the filter is still in the URL of the
 * screen the user is standing on. Its favourite goes with it, in the same patch — a sidebar
 * entry pointing at a view that no longer exists is a dead link, and leaving it there for one
 * round trip is a worse answer than removing it and letting the server's delta confirm.
 */
export async function deleteView(engine: SyncEngine, id: UUID): Promise<void> {
  const store = engine.store;
  const before = store.get('view', id);
  if (before === undefined) return;

  const patch: EntityPatch[] = [{ type: 'view', id, before, after: null }];
  for (const favoriteId of store.favoriteIdsForTarget(id)) {
    const favorite = store.get('favorite', favoriteId);
    if (favorite?.kind === 'view') {
      patch.push({ type: 'favorite', id: favoriteId, before: favorite, after: null });
    }
  }

  await engine.mutate({ mutation: DELETE_VIEW, variables: { id }, optimistic: patch });
}

/**
 * Remembers how a screen with no view row of its own should be displayed.
 *
 * `viewKey` is the client's name for the screen — `team:ENG`, `myIssues` — because the thing
 * being remembered has no id. Keep the keys somewhere one screen owns rather than spelling
 * them at call sites: two screens that disagree about a key silently share one preference.
 */
export async function setViewPreference(
  engine: SyncEngine,
  userId: UUID,
  viewKey: string,
  display: DisplayOptions,
): Promise<void> {
  const store = engine.store;
  const existingId = store.viewPreferenceIdFor(userId, viewKey);
  const before =
    existingId === undefined ? null : (store.get('viewPreference', existingId) ?? null);

  const now = new Date().toISOString();
  const after: ViewPreference = {
    id: before?.id ?? uuidv7(),
    workspaceId: store.workspaceId,
    userId,
    viewKey,
    display,
    createdAt: before?.createdAt ?? now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{ setViewPreference: { preference: ViewPreference } }>({
      mutation: SET_VIEW_PREFERENCE,
      variables: { viewKey, display },
      optimistic: [{ type: 'viewPreference', id: after.id, before, after }],
    });
    swapPreference(store, after.id, data.setViewPreference.preference);
  } catch (error) {
    // Swallowed rather than surfaced: this is a preference, written as a side effect of
    // changing a menu the user is already looking at. A toast saying the grouping could not
    // be remembered would be more interruption than the fact is worth, and the next change
    // retries it anyway.
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export interface ViewSubscriptionChange {
  readonly viewId: UUID;
  readonly userId: UUID;
  readonly added: boolean;
  readonly completed: boolean;
}

/**
 * Upserts the viewer's watch on a saved view, or removes it when both flags are off.
 *
 * Both-false is unsubscribe rather than a validation error because that is the Subscribe
 * menu's off state. The unique (view, user) row is what makes two tabs honest.
 */
export async function setViewSubscription(
  engine: SyncEngine,
  input: ViewSubscriptionChange,
): Promise<void> {
  const store = engine.store;
  const existingId = store.viewSubscriptionIdFor(input.userId, input.viewId);
  const before =
    existingId === undefined ? null : (store.get('viewSubscription', existingId) ?? null);

  if (!input.added && !input.completed) {
    if (before === null) return;
    await engine.mutate({
      mutation: DELETE_VIEW_SUBSCRIPTION,
      variables: { viewId: input.viewId },
      optimistic: [{ type: 'viewSubscription', id: before.id, before, after: null }],
    });
    return;
  }

  const now = new Date().toISOString();
  const after: ViewSubscription = {
    id: before?.id ?? uuidv7(),
    workspaceId: store.workspaceId,
    viewId: input.viewId,
    userId: input.userId,
    added: input.added,
    completed: input.completed,
    createdAt: before?.createdAt ?? now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{
      setViewSubscription: { viewSubscription: ViewSubscription };
    }>({
      mutation: SET_VIEW_SUBSCRIPTION,
      variables: {
        input: { viewId: input.viewId, added: input.added, completed: input.completed },
      },
      optimistic: [{ type: 'viewSubscription', id: after.id, before, after }],
    });
    swapViewSubscription(store, after.id, data.setViewSubscription.viewSubscription);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

/** Whether this person has favourited that thing. */
export function isFavorite(
  store: Store,
  userId: UUID,
  kind: FavoriteKind,
  targetId: UUID,
): boolean {
  return favoriteOf(store, userId, kind, targetId) !== undefined;
}

export async function addFavorite(
  engine: SyncEngine,
  userId: UUID,
  kind: FavoriteKind,
  targetId: UUID,
): Promise<void> {
  const store = engine.store;
  if (isFavorite(store, userId, kind, targetId)) return;

  const now = new Date().toISOString();
  const provisional: Favorite = {
    id: uuidv7(),
    workspaceId: store.workspaceId,
    userId,
    kind,
    targetId,
    position: lastFavoritePosition(store, userId),
    createdAt: now,
    updatedAt: now,
  };

  try {
    await engine.mutate<{ addFavorite: { favorite: Favorite } }>({
      mutation: ADD_FAVORITE,
      // `toWire`: the argument is declared `FavoriteKind!`, whose values are `VIEW`, `TEAM`,
      // `ISSUE`, `LABEL`. A GraphQL enum value is case-sensitive.
      variables: { kind: toWire(kind), targetId, afterFavoriteId: null },
      optimistic: [{ type: 'favorite', id: provisional.id, before: null, after: provisional }],
      reconcile: {
        type: 'favorite',
        provisionalId: provisional.id,
        path: ['addFavorite', 'favorite'],
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function removeFavorite(
  engine: SyncEngine,
  userId: UUID,
  kind: FavoriteKind,
  targetId: UUID,
): Promise<void> {
  const store = engine.store;
  const before = favoriteOf(store, userId, kind, targetId);
  if (before === undefined) return;

  const optimistic: EntityPatch[] = [{ type: 'favorite', id: before.id, before, after: null }];
  if (kind === 'folder') {
    const now = new Date().toISOString();
    for (const row of store.favorites.values()) {
      if (row.folderId !== before.id) continue;
      optimistic.push({
        type: 'favorite',
        id: row.id,
        before: row,
        after: { ...row, folderId: undefined, updatedAt: now },
      });
    }
  }

  await engine.mutate({
    mutation: REMOVE_FAVORITE,
    variables: { kind: toWire(kind), targetId },
    optimistic,
  });
}

export async function createFavoriteFolder(
  engine: SyncEngine,
  userId: UUID,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === '') return;

  const store = engine.store;
  const now = new Date().toISOString();
  const id = uuidv7();
  const provisional: Favorite = {
    id,
    workspaceId: store.workspaceId,
    userId,
    kind: 'folder',
    targetId: id,
    name: trimmed,
    position: lastFavoritePosition(store, userId),
    createdAt: now,
    updatedAt: now,
  };

  try {
    await engine.mutate<{ createFavoriteFolder: { favorite: Favorite } }>({
      mutation: CREATE_FAVORITE_FOLDER,
      variables: { name: trimmed, afterFavoriteId: null },
      optimistic: [{ type: 'favorite', id, before: null, after: provisional }],
      reconcile: {
        type: 'favorite',
        provisionalId: id,
        path: ['createFavoriteFolder', 'favorite'],
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function renameFavoriteFolder(
  engine: SyncEngine,
  folderId: UUID,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === '') return;
  const before = engine.store.get('favorite', folderId);
  if (before === undefined || before.kind !== 'folder' || before.name === trimmed) return;

  const after: Favorite = { ...before, name: trimmed, updatedAt: new Date().toISOString() };
  await engine.mutate({
    mutation: UPDATE_FAVORITE_FOLDER,
    variables: { id: folderId, name: trimmed },
    optimistic: [{ type: 'favorite', id: folderId, before, after }],
  });
}

export async function moveFavorite(
  engine: SyncEngine,
  favoriteId: UUID,
  folderId: UUID | null,
): Promise<void> {
  const before = engine.store.get('favorite', favoriteId);
  if (before === undefined) return;
  if (before.kind === 'folder') return;
  const current = before.folderId ?? null;
  if (current === folderId) return;

  const after: Favorite = {
    ...before,
    folderId: folderId ?? undefined,
    updatedAt: new Date().toISOString(),
  };
  await engine.mutate({
    mutation: MOVE_FAVORITE,
    variables: {
      input: {
        id: favoriteId,
        ...(folderId === null ? { clearFolder: true } : { folderId }),
      },
    },
    optimistic: [{ type: 'favorite', id: favoriteId, before, after }],
  });
}

/** Adds or removes, whichever the current state calls for. What a star actually does. */
export async function toggleFavorite(
  engine: SyncEngine,
  userId: UUID,
  kind: FavoriteKind,
  targetId: UUID,
): Promise<void> {
  return isFavorite(engine.store, userId, kind, targetId)
    ? removeFavorite(engine, userId, kind, targetId)
    : addFavorite(engine, userId, kind, targetId);
}

function favoriteOf(
  store: Store,
  userId: UUID,
  kind: FavoriteKind,
  targetId: UUID,
): Favorite | undefined {
  for (const id of store.favoriteIdsForTarget(targetId)) {
    const row = store.get('favorite', id);
    // Filtered on all three: the index is by target alone, and a workspace where one person
    // has favourited a team and another has favourited an issue with the same id is not a
    // case worth being wrong about.
    if (row !== undefined && row.userId === userId && row.kind === kind) return row;
  }
  return undefined;
}

function swapPreference(store: Store, provisionalId: UUID, wire: ViewPreference): void {
  const real = fromWire('viewPreference', wire);
  const patch: EntityPatch[] = [
    {
      type: 'viewPreference',
      id: real.id,
      before: store.get('viewPreference', real.id) ?? null,
      after: real,
    },
  ];
  if (real.id !== provisionalId) {
    patch.unshift({ type: 'viewPreference', id: provisionalId, before: null, after: null });
  }
  store.applyOptimistic(patch);
}

function swapViewSubscription(store: Store, provisionalId: UUID, wire: ViewSubscription): void {
  const real = fromWire('viewSubscription', wire);
  const patch: EntityPatch[] = [
    {
      type: 'viewSubscription',
      id: real.id,
      before: store.get('viewSubscription', real.id) ?? null,
      after: real,
    },
  ];
  if (real.id !== provisionalId) {
    patch.unshift({ type: 'viewSubscription', id: provisionalId, before: null, after: null });
  }
  store.applyOptimistic(patch);
}

/**
 * A fractional position after every view in the same scope.
 *
 * The same idiom the labels and statuses use: scan for the highest string and append a
 * character that sorts after it. Cheap, correct under `COLLATE "C"`, and it never needs to
 * renumber anything.
 */
function lastViewPosition(
  store: Store,
  teamId: UUID | undefined,
  projectId: UUID | undefined,
): string {
  let highest = '';
  for (const view of store.views.values()) {
    if (projectId !== undefined) {
      if (view.projectId !== projectId) continue;
    } else if (view.projectId !== undefined) {
      continue;
    } else if (view.teamId !== teamId) {
      continue;
    }
    if (view.position > highest) highest = view.position;
  }
  return `${highest}z`;
}

function lastFavoritePosition(store: Store, userId: UUID): string {
  let highest = '';
  for (const favorite of store.favorites.values()) {
    if (favorite.userId !== userId) continue;
    if (favorite.position > highest) highest = favorite.position;
  }
  return `${highest}z`;
}
