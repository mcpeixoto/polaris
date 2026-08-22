import { fromWire } from '~/gql/enums';
import {
  uuidv7,
  type CustomerSubscription,
  type EntityPatch,
  type InitiativeSubscription,
  type ProjectSubscription,
  type UUID,
} from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import {
  DELETE_CUSTOMER_SUBSCRIPTION,
  DELETE_INITIATIVE_SUBSCRIPTION,
  DELETE_PROJECT_SUBSCRIPTION,
  SET_CUSTOMER_SUBSCRIPTION,
  SET_INITIATIVE_SUBSCRIPTION,
  SET_PROJECT_SUBSCRIPTION,
} from './operations';

export { report } from '~/features/issue/mutations';

export interface ProjectSubscriptionChange {
  readonly projectId: UUID;
  readonly userId: UUID;
  readonly issuesAdded: boolean;
  readonly issuesCompleted: boolean;
  readonly updates: boolean;
}

export async function setProjectSubscription(
  engine: SyncEngine,
  input: ProjectSubscriptionChange,
): Promise<void> {
  const store = engine.store;
  const existingId = store.projectSubscriptionIdFor(input.userId, input.projectId);
  const before =
    existingId === undefined ? null : (store.get('projectSubscription', existingId) ?? null);

  if (!input.issuesAdded && !input.issuesCompleted && !input.updates) {
    if (before === null) return;
    await engine.mutate({
      mutation: DELETE_PROJECT_SUBSCRIPTION,
      variables: { projectId: input.projectId },
      optimistic: [{ type: 'projectSubscription', id: before.id, before, after: null }],
    });
    return;
  }

  const now = new Date().toISOString();
  const after: ProjectSubscription = {
    id: before?.id ?? uuidv7(),
    workspaceId: store.workspaceId,
    projectId: input.projectId,
    userId: input.userId,
    issuesAdded: input.issuesAdded,
    issuesCompleted: input.issuesCompleted,
    updates: input.updates,
    createdAt: before?.createdAt ?? now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{
      setProjectSubscription: { projectSubscription: ProjectSubscription };
    }>({
      mutation: SET_PROJECT_SUBSCRIPTION,
      variables: {
        input: {
          projectId: input.projectId,
          issuesAdded: input.issuesAdded,
          issuesCompleted: input.issuesCompleted,
          updates: input.updates,
        },
      },
      optimistic: [{ type: 'projectSubscription', id: after.id, before, after }],
    });
    swapRow(
      store,
      'projectSubscription',
      after.id,
      data.setProjectSubscription.projectSubscription,
    );
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export interface InitiativeSubscriptionChange {
  readonly initiativeId: UUID;
  readonly userId: UUID;
  readonly issuesAdded: boolean;
  readonly issuesCompleted: boolean;
  readonly updates: boolean;
}

export async function setInitiativeSubscription(
  engine: SyncEngine,
  input: InitiativeSubscriptionChange,
): Promise<void> {
  const store = engine.store;
  const existingId = store.initiativeSubscriptionIdFor(input.userId, input.initiativeId);
  const before =
    existingId === undefined ? null : (store.get('initiativeSubscription', existingId) ?? null);

  if (!input.issuesAdded && !input.issuesCompleted && !input.updates) {
    if (before === null) return;
    await engine.mutate({
      mutation: DELETE_INITIATIVE_SUBSCRIPTION,
      variables: { initiativeId: input.initiativeId },
      optimistic: [{ type: 'initiativeSubscription', id: before.id, before, after: null }],
    });
    return;
  }

  const now = new Date().toISOString();
  const after: InitiativeSubscription = {
    id: before?.id ?? uuidv7(),
    workspaceId: store.workspaceId,
    initiativeId: input.initiativeId,
    userId: input.userId,
    issuesAdded: input.issuesAdded,
    issuesCompleted: input.issuesCompleted,
    updates: input.updates,
    createdAt: before?.createdAt ?? now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{
      setInitiativeSubscription: { initiativeSubscription: InitiativeSubscription };
    }>({
      mutation: SET_INITIATIVE_SUBSCRIPTION,
      variables: {
        input: {
          initiativeId: input.initiativeId,
          issuesAdded: input.issuesAdded,
          issuesCompleted: input.issuesCompleted,
          updates: input.updates,
        },
      },
      optimistic: [{ type: 'initiativeSubscription', id: after.id, before, after }],
    });
    swapRow(
      store,
      'initiativeSubscription',
      after.id,
      data.setInitiativeSubscription.initiativeSubscription,
    );
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export interface CustomerSubscriptionChange {
  readonly customerId: UUID;
  readonly userId: UUID;
  readonly requestAdded: boolean;
  readonly requestImportant: boolean;
  readonly requestCompleted: boolean;
}

export async function setCustomerSubscription(
  engine: SyncEngine,
  input: CustomerSubscriptionChange,
): Promise<void> {
  const store = engine.store;
  const existingId = store.customerSubscriptionIdFor(input.userId, input.customerId);
  const before =
    existingId === undefined ? null : (store.get('customerSubscription', existingId) ?? null);

  if (!input.requestAdded && !input.requestImportant && !input.requestCompleted) {
    if (before === null) return;
    await engine.mutate({
      mutation: DELETE_CUSTOMER_SUBSCRIPTION,
      variables: { customerId: input.customerId },
      optimistic: [{ type: 'customerSubscription', id: before.id, before, after: null }],
    });
    return;
  }

  const now = new Date().toISOString();
  const after: CustomerSubscription = {
    id: before?.id ?? uuidv7(),
    workspaceId: store.workspaceId,
    customerId: input.customerId,
    userId: input.userId,
    requestAdded: input.requestAdded,
    requestImportant: input.requestImportant,
    requestCompleted: input.requestCompleted,
    createdAt: before?.createdAt ?? now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{
      setCustomerSubscription: { customerSubscription: CustomerSubscription };
    }>({
      mutation: SET_CUSTOMER_SUBSCRIPTION,
      variables: {
        input: {
          customerId: input.customerId,
          requestAdded: input.requestAdded,
          requestImportant: input.requestImportant,
          requestCompleted: input.requestCompleted,
        },
      },
      optimistic: [{ type: 'customerSubscription', id: after.id, before, after }],
    });
    swapRow(
      store,
      'customerSubscription',
      after.id,
      data.setCustomerSubscription.customerSubscription,
    );
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

function swapRow<
  T extends 'projectSubscription' | 'initiativeSubscription' | 'customerSubscription',
>(
  store: SyncEngine['store'],
  type: T,
  provisionalId: UUID,
  wire: Parameters<typeof fromWire<T>>[1],
): void {
  const real = fromWire(type, wire);
  const patch: EntityPatch[] = [
    {
      type,
      id: real.id,
      before: store.get(type, real.id) ?? null,
      after: real,
    },
  ];
  if (real.id !== provisionalId) {
    patch.unshift({ type, id: provisionalId, before: null, after: null });
  }
  store.applyOptimistic(patch);
}
