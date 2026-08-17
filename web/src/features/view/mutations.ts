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
} from '~/store';
import type { DisplayOptions, FilterNode } from '~/filter';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import {
  ADD_FAVORITE,
  CREATE_VIEW,
  DELETE_VIEW,
  REMOVE_FAVORITE,
  SET_VIEW_PREFERENCE,
  UPDATE_VIEW,
} from './operations';

export interface NewView {
  readonly name: string;
  readonly filter: FilterNode;
  readonly display?: DisplayOptions | undefined;
  readonly description?: string | undefined;
  /** Absent makes it a workspace view, offered everywhere. */
  readonly teamId?: UUID | undefined;
  /**
   * Keeps the view to its creator.
   *
   * Decided at creation and never afterwards: `UpdateViewInput` has no `private` field, so a
   * view cannot be flipped between shared and private. The dialog says so rather than letting
   * somebody find out by looking for the switch.
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
    // A private view has an owner; a shared one has none. The optimistic row has to agree
    // with that rule or the sidebar shows the view in the wrong section for one round trip.
    ...(input.private === true && input.ownerId !== undefined ? { ownerId: input.ownerId } : null),
    name,
    ...(input.description === undefined ? null : { description: input.description }),
    ...(input.icon === undefined ? null : { icon: input.icon }),
    ...(input.color === undefined ? null : { color: input.color }),
    filter: input.filter,
    display: input.display ?? {},
    position: lastViewPosition(store, input.teamId),
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
          ...(input.private === undefined ? null : { private: input.private }),
          ...(input.description === undefined ? null : { description: input.description }),
          ...(input.icon === undefined ? null : { icon: input.icon }),
          ...(input.color === undefined ? null : { color: input.color }),
          ...(input.display === undefined ? null : { display: input.display }),
        },
      },
      optimistic: [{ type: 'view', id: provisional.id, before: null, after: provisional }],
    });
    return swapView(store, provisional.id, data.createView.view);
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

  const after: View = {
    ...before,
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
    const data = await engine.mutate<{ addFavorite: { favorite: Favorite } }>({
      mutation: ADD_FAVORITE,
      // `toWire`: the argument is declared `FavoriteKind!`, whose values are `VIEW`, `TEAM`,
      // `ISSUE`, `LABEL`. A GraphQL enum value is case-sensitive.
      variables: { kind: toWire(kind), targetId, afterFavoriteId: null },
      optimistic: [{ type: 'favorite', id: provisional.id, before: null, after: provisional }],
    });
    swapFavorite(store, provisional.id, data.addFavorite.favorite);
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

  await engine.mutate({
    mutation: REMOVE_FAVORITE,
    variables: { kind: toWire(kind), targetId },
    optimistic: [{ type: 'favorite', id: before.id, before, after: null }],
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

/**
 * Puts the server's row in place of the stand-in, in one store write.
 *
 * One write rather than two because every subscribed row re-renders between them otherwise,
 * and a sidebar entry that vanishes for a frame on its way to being replaced by itself is the
 * exact flicker an optimistic create is supposed to prevent.
 */
function swapView(store: Store, provisionalId: UUID, wire: View): UUID {
  const real = fromWire('view', wire);
  const patch: EntityPatch[] = [
    { type: 'view', id: real.id, before: store.get('view', real.id) ?? null, after: real },
  ];
  if (real.id !== provisionalId) {
    patch.unshift({ type: 'view', id: provisionalId, before: null, after: null });
  }
  store.applyOptimistic(patch);
  return real.id;
}

function swapFavorite(store: Store, provisionalId: UUID, wire: Favorite): void {
  const real = fromWire('favorite', wire);
  const patch: EntityPatch[] = [
    { type: 'favorite', id: real.id, before: store.get('favorite', real.id) ?? null, after: real },
  ];
  if (real.id !== provisionalId) {
    patch.unshift({ type: 'favorite', id: provisionalId, before: null, after: null });
  }
  store.applyOptimistic(patch);
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

/**
 * A fractional position after every view in the same scope.
 *
 * The same idiom the labels and statuses use: scan for the highest string and append a
 * character that sorts after it. Cheap, correct under `COLLATE "C"`, and it never needs to
 * renumber anything.
 */
function lastViewPosition(store: Store, teamId: UUID | undefined): string {
  let highest = '';
  for (const view of store.views.values()) {
    if (view.teamId !== teamId) continue;
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
