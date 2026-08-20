import { fromWire } from '~/gql/enums';
import { uuidv7, type EntityOf, type EntityPatch, type UUID } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import {
  CREATE_CUSTOMER,
  CREATE_CUSTOMER_REQUEST,
  DELETE_CUSTOMER_REQUEST,
  UPDATE_CUSTOMER,
  UPDATE_CUSTOMER_REQUEST,
} from './operations';

type Customer = EntityOf<'customer'>;
type CustomerRequest = EntityOf<'customerRequest'>;

export interface NewCustomer {
  readonly name: string;
  readonly domains?: readonly string[] | undefined;
  readonly ownerId?: UUID | undefined;
}

export async function createCustomer(engine: SyncEngine, input: NewCustomer): Promise<UUID> {
  const store = engine.store;
  const id = uuidv7();
  const now = new Date().toISOString();
  const provisional: Customer = {
    id,
    workspaceId: store.workspaceId,
    name: input.name,
    domains: input.domains ?? [],
    status: 'active',
    logoUrl: '',
    sortOrder: 'z',
    ...(input.ownerId === undefined ? null : { ownerId: input.ownerId }),
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{ createCustomer: { customer: Customer } }>({
      mutation: CREATE_CUSTOMER,
      variables: {
        input: {
          name: input.name,
          domains: input.domains ?? [],
          ownerId: input.ownerId,
        },
      },
      optimistic: [{ type: 'customer', id, before: null, after: provisional }],
    });
    const real = fromWire('customer', data.createCustomer.customer as EntityOf<'customer'>);
    const patch: EntityPatch[] = [
      { type: 'customer', id: real.id, before: provisional, after: real },
    ];
    if (real.id !== id) {
      patch.unshift({ type: 'customer', id, before: null, after: null });
    }
    store.applyOptimistic(patch);
    return real.id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return id;
    throw error;
  }
}

export async function updateCustomerName(
  engine: SyncEngine,
  id: UUID,
  name: string,
): Promise<void> {
  const store = engine.store;
  const before = store.get('customer', id);
  if (before === undefined) return;
  const after: Customer = { ...before, name, updatedAt: new Date().toISOString() };
  try {
    const data = await engine.mutate<{ updateCustomer: { customer: Customer } }>({
      mutation: UPDATE_CUSTOMER,
      variables: { input: { id, name } },
      optimistic: [{ type: 'customer', id, before, after }],
    });
    const real = fromWire('customer', data.updateCustomer.customer as EntityOf<'customer'>);
    store.applyOptimistic([{ type: 'customer', id: real.id, before: after, after: real }]);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export interface NewCustomerRequest {
  readonly customerId?: UUID | undefined;
  readonly issueId?: UUID | undefined;
  readonly projectId?: UUID | undefined;
  readonly body: string;
  readonly important?: boolean | undefined;
}

export async function createCustomerRequest(
  engine: SyncEngine,
  input: NewCustomerRequest,
): Promise<UUID> {
  const store = engine.store;
  const id = uuidv7();
  const now = new Date().toISOString();
  const provisional: CustomerRequest = {
    id,
    workspaceId: store.workspaceId,
    body: input.body,
    important: input.important ?? false,
    ...(input.customerId === undefined ? null : { customerId: input.customerId }),
    ...(input.issueId === undefined ? null : { issueId: input.issueId }),
    ...(input.projectId === undefined ? null : { projectId: input.projectId }),
    createdAt: now,
    updatedAt: now,
  };

  try {
    const data = await engine.mutate<{
      createCustomerRequest: { customerRequest: CustomerRequest };
    }>({
      mutation: CREATE_CUSTOMER_REQUEST,
      variables: {
        input: {
          customerId: input.customerId,
          issueId: input.issueId,
          projectId: input.projectId,
          body: input.body,
          important: input.important ?? false,
        },
      },
      optimistic: [{ type: 'customerRequest', id, before: null, after: provisional }],
    });
    const real = fromWire(
      'customerRequest',
      data.createCustomerRequest.customerRequest as EntityOf<'customerRequest'>,
    );
    const patch: EntityPatch[] = [
      { type: 'customerRequest', id: real.id, before: provisional, after: real },
    ];
    if (real.id !== id) {
      patch.unshift({ type: 'customerRequest', id, before: null, after: null });
    }
    store.applyOptimistic(patch);
    return real.id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return id;
    throw error;
  }
}

export async function toggleCustomerRequestImportant(
  engine: SyncEngine,
  id: UUID,
  important: boolean,
): Promise<void> {
  const store = engine.store;
  const before = store.get('customerRequest', id);
  if (before === undefined) return;
  const after: CustomerRequest = { ...before, important, updatedAt: new Date().toISOString() };
  try {
    const data = await engine.mutate<{
      updateCustomerRequest: { customerRequest: CustomerRequest };
    }>({
      mutation: UPDATE_CUSTOMER_REQUEST,
      variables: { input: { id, important } },
      optimistic: [{ type: 'customerRequest', id, before, after }],
    });
    const real = fromWire(
      'customerRequest',
      data.updateCustomerRequest.customerRequest as EntityOf<'customerRequest'>,
    );
    store.applyOptimistic([{ type: 'customerRequest', id: real.id, before: after, after: real }]);
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function deleteCustomerRequest(engine: SyncEngine, id: UUID): Promise<void> {
  const store = engine.store;
  const before = store.get('customerRequest', id);
  if (before === undefined) return;
  try {
    await engine.mutate({
      mutation: DELETE_CUSTOMER_REQUEST,
      variables: { id },
      optimistic: [{ type: 'customerRequest', id, before, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export function formatCustomerStatus(status: Customer['status']): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'prospect':
      return 'Prospect';
    case 'churned':
      return 'Churned';
    default:
      return status;
  }
}
