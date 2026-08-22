/**
 * Filter the project list by the customers attributed onto it via requests.
 *
 * Issue views already have the full customer grammar. Project views do not: a project
 * carries requests of its own, not the issues' customers, so this is a small replica
 * predicate rather than a second grammar.
 */

import type { Store, UUID } from '~/store';

export type ProjectCustomerFilter =
  'all' | 'any' | 'none' | `customer:${string}` | `tier:${string}`;

export function matchesProjectCustomerFilter(
  store: Store,
  projectId: UUID,
  filter: ProjectCustomerFilter,
): boolean {
  if (filter === 'all') return true;
  const attributed = attributedProjectCustomers(store, projectId);
  if (filter === 'any') return attributed.length > 0;
  if (filter === 'none') return attributed.length === 0;
  if (filter.startsWith('customer:')) {
    const id = filter.slice('customer:'.length);
    return attributed.some((customer) => customer.id === id);
  }
  if (filter.startsWith('tier:')) {
    const tier = filter.slice('tier:'.length);
    return attributed.some((customer) => customer.tier === tier);
  }
  return true;
}

export function projectCustomerFilterOptions(store: Store): {
  readonly customers: readonly { readonly id: UUID; readonly name: string }[];
  readonly tiers: readonly string[];
} {
  const customers = [...store.customers.values()]
    .filter((customer) => customer.deletedAt === undefined && customer.archivedAt === undefined)
    .map((customer) => ({ id: customer.id, name: customer.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const tiers = [
    ...new Set(
      [...store.customers.values()]
        .map((customer) => customer.tier)
        .filter((tier): tier is string => tier !== undefined && tier !== ''),
    ),
  ].sort((a, b) => a.localeCompare(b));
  return { customers, tiers };
}

function attributedProjectCustomers(store: Store, projectId: UUID) {
  const seen = new Set<UUID>();
  const out: { id: UUID; tier: string | undefined }[] = [];
  for (const requestId of store.customerRequestIdsForProject(projectId)) {
    const request = store.customerRequests.get(requestId);
    const customerId = request?.customerId;
    if (customerId === undefined || seen.has(customerId)) continue;
    const customer = store.customers.get(customerId);
    if (customer === undefined || customer.deletedAt !== undefined) continue;
    seen.add(customerId);
    out.push({ id: customer.id, tier: customer.tier });
  }
  return out;
}
