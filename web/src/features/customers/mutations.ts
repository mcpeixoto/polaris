import { fromWire, toWire } from '~/gql/enums';
import { uuidv7, type CustomerStatus, type EntityOf, type UUID } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import {
  ARCHIVE_CUSTOMER,
  CREATE_CUSTOMER,
  CREATE_CUSTOMER_REQUEST,
  DELETE_CUSTOMER_REQUEST,
  MERGE_CUSTOMERS,
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
      reconcile: {
        type: 'customer',
        provisionalId: id,
        path: ['createCustomer', 'customer'],
        // And from the delta stream, which usually gets here first — the socket pushes the
        // row the moment the mutation commits, while the response is still travelling back.
        // A workspace holds one customer per name.
        match: ['name'],
      },
    });
    return data.createCustomer.customer.id;
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return id;
    throw error;
  }
}

export interface CustomerFields {
  readonly name?: string | undefined;
  readonly domains?: readonly string[] | undefined;
  readonly status?: CustomerStatus | undefined;
  readonly ownerId?: UUID | null | undefined;
  readonly tier?: string | null | undefined;
  readonly revenue?: number | null | undefined;
  readonly size?: number | null | undefined;
  readonly logoUrl?: string | undefined;
}

export async function updateCustomer(
  engine: SyncEngine,
  id: UUID,
  fields: CustomerFields,
): Promise<void> {
  const store = engine.store;
  const before = store.get('customer', id);
  if (before === undefined) return;
  const after: Customer = {
    ...before,
    ...(fields.name === undefined ? null : { name: fields.name }),
    ...(fields.domains === undefined ? null : { domains: fields.domains }),
    ...(fields.status === undefined ? null : { status: fields.status }),
    ...(fields.ownerId === undefined
      ? null
      : { ownerId: fields.ownerId === null ? undefined : fields.ownerId }),
    ...(fields.tier === undefined
      ? null
      : { tier: fields.tier === null ? undefined : fields.tier }),
    ...(fields.revenue === undefined
      ? null
      : { revenue: fields.revenue === null ? undefined : fields.revenue }),
    ...(fields.size === undefined
      ? null
      : { size: fields.size === null ? undefined : fields.size }),
    ...(fields.logoUrl === undefined ? null : { logoUrl: fields.logoUrl }),
    updatedAt: new Date().toISOString(),
  };
  try {
    await engine.mutate({
      mutation: UPDATE_CUSTOMER,
      variables: {
        input: {
          id,
          ...(fields.name === undefined ? null : { name: fields.name }),
          ...(fields.domains === undefined ? null : { domains: [...fields.domains] }),
          ...(fields.status === undefined ? null : { status: toWire(fields.status) }),
          ...(fields.ownerId === undefined
            ? null
            : fields.ownerId === null
              ? { clearOwner: true }
              : { ownerId: fields.ownerId }),
          ...(fields.tier === undefined
            ? null
            : fields.tier === null
              ? { clearTier: true }
              : { tier: fields.tier }),
          ...(fields.revenue === undefined
            ? null
            : fields.revenue === null
              ? { clearRevenue: true }
              : { revenue: fields.revenue }),
          ...(fields.size === undefined
            ? null
            : fields.size === null
              ? { clearSize: true }
              : { size: fields.size }),
          ...(fields.logoUrl === undefined ? null : { logoUrl: fields.logoUrl }),
        },
      },
      optimistic: [{ type: 'customer', id, before, after }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

export async function archiveCustomer(engine: SyncEngine, id: UUID): Promise<void> {
  const before = engine.store.get('customer', id);
  if (before === undefined) return;
  try {
    await engine.mutate({
      mutation: ARCHIVE_CUSTOMER,
      variables: { id, archived: true },
      optimistic: [{ type: 'customer', id, before, after: null }],
    });
  } catch (error) {
    if (error instanceof ApiError && error.isOffline) return;
    throw error;
  }
}

/**
 * Fold one customer into another. The source is archived; domains and requests move.
 *
 * Not optimistic: the server rewrites every request and the domain uniqueness table, and
 * a local guess would be wrong the moment both rows claimed overlapping domains.
 */
export async function mergeCustomers(
  engine: SyncEngine,
  sourceId: UUID,
  intoId: UUID,
): Promise<void> {
  if (sourceId === intoId) return;
  await engine.mutate({
    mutation: MERGE_CUSTOMERS,
    variables: { sourceId, intoId },
  });
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
      reconcile: {
        type: 'customerRequest',
        provisionalId: id,
        path: ['createCustomerRequest', 'customerRequest'],
        // And from the delta stream, which usually gets here first — the socket pushes the
        // row the moment the mutation commits, while the response is still travelling back.
        // The customer and the words typed, which nobody sends twice in one second by accident.
        match: ['customerId', 'body'],
      },
    });
    return data.createCustomerRequest.customerRequest.id;
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
