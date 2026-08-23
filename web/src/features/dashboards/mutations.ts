import { fromWire, toWire } from '~/gql/enums';
import { uuidv7, type EntityOf, type UUID } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';
import type { FilterNode } from '~/filter';
import { EMPTY_FILTER } from '~/filter';

import {
  CREATE_DASHBOARD,
  CREATE_DASHBOARD_TILE,
  DELETE_DASHBOARD,
  DELETE_DASHBOARD_TILE,
  UPDATE_DASHBOARD,
  UPDATE_DASHBOARD_TILE,
} from './operations';

type Dashboard = EntityOf<'dashboard'>;
type DashboardTile = EntityOf<'dashboardTile'>;

export interface NewDashboard {
  readonly name: string;
  readonly description?: string | undefined;
  readonly private?: boolean | undefined;
  readonly teamId?: UUID | undefined;
  readonly ownerId?: UUID | undefined;
}

export async function createDashboard(engine: SyncEngine, input: NewDashboard): Promise<UUID> {
  const store = engine.store;
  const id = uuidv7();
  const now = new Date().toISOString();
  const provisional: Dashboard = {
    id,
    workspaceId: store.workspaceId,
    name: input.name,
    description: input.description ?? '',
    filter: EMPTY_FILTER,
    sortOrder: 'z',
    ...(input.private === true && input.ownerId !== undefined ? { ownerId: input.ownerId } : null),
    ...(input.teamId === undefined ? null : { teamId: input.teamId }),
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{ createDashboard: { dashboard: Dashboard } }>({
      mutation: CREATE_DASHBOARD,
      variables: {
        input: {
          name: input.name,
          description: input.description,
          private: input.private,
          teamId: input.teamId,
        },
      },
      optimistic: [{ type: 'dashboard', id, before: null, after: provisional }],
      reconcile: {
        type: 'dashboard',
        provisionalId: id,
        path: ['createDashboard', 'dashboard'],
        // And from the delta stream, which usually gets here first — the socket pushes the
        // row the moment the mutation commits, while the response is still travelling back.
        // Scope and name.
        match: ['teamId', 'name'],
      },
    });
    return data.createDashboard.dashboard.id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return id;
    throw error;
  }
}

export async function renameDashboard(engine: SyncEngine, id: UUID, name: string): Promise<void> {
  const store = engine.store;
  const before = store.get('dashboard', id);
  if (before === undefined) return;
  const after: Dashboard = { ...before, name, updatedAt: new Date().toISOString() };
  try {
    const data = await engine.mutate<{ updateDashboard: { dashboard: Dashboard } }>({
      mutation: UPDATE_DASHBOARD,
      variables: { input: { id, name } },
      optimistic: [{ type: 'dashboard', id, before, after }],
    });
    const real = fromWire('dashboard', data.updateDashboard.dashboard as EntityOf<'dashboard'>);
    store.applyOptimistic([{ type: 'dashboard', id: real.id, before: after, after: real }]);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function deleteDashboard(engine: SyncEngine, id: UUID): Promise<void> {
  const store = engine.store;
  const before = store.get('dashboard', id);
  if (before === undefined) return;
  try {
    await engine.mutate({
      mutation: DELETE_DASHBOARD,
      variables: { id },
      optimistic: [{ type: 'dashboard', id, before, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export interface NewDashboardTile {
  readonly dashboardId: UUID;
  readonly title?: string | undefined;
  readonly measure?: DashboardTile['measure'] | undefined;
  readonly slice?: DashboardTile['slice'] | undefined;
  readonly display?: DashboardTile['display'] | undefined;
  readonly filter?: FilterNode | undefined;
}

export async function createDashboardTile(
  engine: SyncEngine,
  input: NewDashboardTile,
): Promise<UUID> {
  const store = engine.store;
  const id = uuidv7();
  const now = new Date().toISOString();
  const provisional: DashboardTile = {
    id,
    workspaceId: store.workspaceId,
    dashboardId: input.dashboardId,
    title: input.title ?? '',
    measure: input.measure ?? 'count',
    slice: input.slice ?? 'assignee',
    display: input.display ?? 'chart',
    filter: input.filter ?? EMPTY_FILTER,
    sortOrder: 'z',
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{
      createDashboardTile: { dashboardTile: DashboardTile };
    }>({
      mutation: CREATE_DASHBOARD_TILE,
      variables: {
        input: {
          dashboardId: input.dashboardId,
          title: input.title,
          measure: input.measure === undefined ? undefined : toWire(input.measure),
          slice: input.slice === undefined ? undefined : toWire(input.slice),
          display: input.display === undefined ? undefined : toWire(input.display),
          filter: input.filter,
        },
      },
      optimistic: [{ type: 'dashboardTile', id, before: null, after: provisional }],
      reconcile: {
        type: 'dashboardTile',
        provisionalId: id,
        path: ['createDashboardTile', 'dashboardTile'],
        // And from the delta stream, which usually gets here first — the socket pushes the
        // row the moment the mutation commits, while the response is still travelling back.
        // The dashboard and the tile's title.
        match: ['dashboardId', 'title'],
      },
    });
    return data.createDashboardTile.dashboardTile.id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return id;
    throw error;
  }
}

export async function updateDashboardTile(
  engine: SyncEngine,
  id: UUID,
  patch: {
    readonly title?: string;
    readonly measure?: DashboardTile['measure'];
    readonly slice?: DashboardTile['slice'];
    readonly display?: DashboardTile['display'];
  },
): Promise<void> {
  const store = engine.store;
  const before = store.get('dashboardTile', id);
  if (before === undefined) return;
  const after: DashboardTile = {
    ...before,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  try {
    const data = await engine.mutate<{
      updateDashboardTile: { dashboardTile: DashboardTile };
    }>({
      mutation: UPDATE_DASHBOARD_TILE,
      variables: {
        input: {
          id,
          title: patch.title,
          measure: patch.measure === undefined ? undefined : toWire(patch.measure),
          slice: patch.slice === undefined ? undefined : toWire(patch.slice),
          display: patch.display === undefined ? undefined : toWire(patch.display),
        },
      },
      optimistic: [{ type: 'dashboardTile', id, before, after }],
    });
    const real = fromWire(
      'dashboardTile',
      data.updateDashboardTile.dashboardTile as EntityOf<'dashboardTile'>,
    );
    store.applyOptimistic([{ type: 'dashboardTile', id: real.id, before: after, after: real }]);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function deleteDashboardTile(engine: SyncEngine, id: UUID): Promise<void> {
  const store = engine.store;
  const before = store.get('dashboardTile', id);
  if (before === undefined) return;
  try {
    await engine.mutate({
      mutation: DELETE_DASHBOARD_TILE,
      variables: { id },
      optimistic: [{ type: 'dashboardTile', id, before, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}
