/**
 * The bridge from the replica to the filter grammar.
 *
 * The filter module deliberately knows nothing about the store: it takes maps and a clock
 * and returns a predicate, which is what lets it be pinned to the server's SQL compiler by
 * a fixture rather than by a running application. This file is the one place that knows
 * both, and it is small on purpose.
 *
 * It is also the hot path. A four-clause filter over five thousand issues is budgeted at
 * 50 ms and measures well under one, so nothing here is debounced — but that headroom
 * exists because the maps below are the indexes themselves rather than copies. Building a
 * `Map` per keystroke would spend the whole budget on garbage before a single clause ran.
 *
 * The customer maps are the one exception, because they are the one thing here the store
 * does not already hold: they are derived from `customerRequests`, six Maps and a Set of
 * them, and this function ran that scan on every filter and display change no matter what
 * the filter asked about. Almost no filter asks about customers. So they are handed over
 * behind getters that build the index on first read and memoise it for the life of the
 * context — the evaluator only touches `context.customerTier` and friends from inside a
 * customer clause's compiled closure, so a filter that never mentions one never pays, and
 * one that does pays exactly once. The rule above is unchanged: what is handed over is
 * still the index itself and never a copy.
 */

import type { FilterContext, TimeContext } from '~/filter';
import type { Store, UUID } from '~/store';

export interface ViewClock {
  /** Injected so tests and the conformance fixture can pin it. Never `Date.now()` inline. */
  readonly now: number;
  /**
   * The zone relative dates and calendar days are reckoned in.
   *
   * The workspace's, not the reader's, wherever the date belongs to the team: "due this
   * week" has to mean the same week for everybody looking at the same board, or two people
   * reading one view disagree about what is overdue.
   */
  readonly timezone: string;
}

/**
 * Builds the context a filter is evaluated against.
 *
 * Every map handed over is the live index. That is safe because `FilterContext` types them
 * as readonly and the evaluator only reads — and it is the difference between this being
 * free and this being the most expensive thing in the frame.
 */
export function filterContextFor(
  store: Store,
  clock: ViewClock,
  opts?: { readonly hideCustomers?: boolean },
): FilterContext {
  const time: TimeContext = { now: clock.now, timezone: clock.timezone };

  // Built at most once per context, and only if something reads one of the getters below.
  let index: CustomerIndex | undefined;
  const customer = (): CustomerIndex => (index ??= customerIndex(store));

  return {
    time,
    states: store.workflowStates,
    labels: store.labelIndex.labelsByIssue(),
    subscribers: store.subscribersByIssue(),
    blockedBy: store.relationIndex.blockedByIssue(),
    blocking: store.relationIndex.blockingByIssue(),
    hideCustomers: opts?.hideCustomers,
    get customers() {
      return customer().customers;
    },
    get customerCount() {
      return customer().counts;
    },
    get customerStatus() {
      return customer().statuses;
    },
    get customerTier() {
      return customer().tiers;
    },
    get customerRevenue() {
      return customer().revenues;
    },
    get customerSize() {
      return customer().sizes;
    },
    get customerImportant() {
      return customer().important;
    },
    // Deliberately absent in every ordinary view.
    //
    // A client's replica does not hold soft-deleted issues at all — the server revokes
    // them — so there is nothing for a `deleted` clause to match and no set to hand over.
    // The trash screen is the exception: it fetches deleted issues explicitly and passes
    // its own set, because those rows exist only for as long as that screen is open.
  };
}

function addToSet(map: Map<UUID, Set<string>>, issueId: UUID, value: string): void {
  const bucket = map.get(issueId);
  if (bucket === undefined) map.set(issueId, new Set([value]));
  else bucket.add(value);
}

function addNumber(map: Map<UUID, number[]>, issueId: UUID, value: number): void {
  const bucket = map.get(issueId);
  if (bucket === undefined) map.set(issueId, [value]);
  else bucket.push(value);
}

/** The seven maps a customer clause reads, built together because one scan yields them all. */
interface CustomerIndex {
  readonly customers: ReadonlyMap<UUID, ReadonlySet<UUID>>;
  readonly counts: ReadonlyMap<UUID, number>;
  readonly statuses: ReadonlyMap<UUID, ReadonlySet<string>>;
  readonly tiers: ReadonlyMap<UUID, ReadonlySet<string>>;
  readonly revenues: ReadonlyMap<UUID, readonly number[]>;
  readonly sizes: ReadonlyMap<UUID, readonly number[]>;
  readonly important: ReadonlySet<UUID>;
}

function customerIndex(store: Store): CustomerIndex {
  const customers = new Map<UUID, Set<UUID>>();
  const counts = new Map<UUID, number>();
  const statuses = new Map<UUID, Set<string>>();
  const tiers = new Map<UUID, Set<string>>();
  const revenues = new Map<UUID, number[]>();
  const sizes = new Map<UUID, number[]>();
  const important = new Set<UUID>();

  for (const request of store.customerRequests.values()) {
    const issueId = request.issueId;
    if (issueId === undefined) continue;
    counts.set(issueId, (counts.get(issueId) ?? 0) + 1);
    if (request.important) important.add(issueId);
    const customerId = request.customerId;
    if (customerId === undefined) continue;
    const customer = store.get('customer', customerId);
    if (customer === undefined || customer.deletedAt !== undefined) continue;
    addToSet(customers, issueId, customer.id);
    addToSet(statuses, issueId, customer.status);
    if (customer.tier !== undefined && customer.tier !== '')
      addToSet(tiers, issueId, customer.tier);
    if (customer.revenue !== undefined) addNumber(revenues, issueId, customer.revenue);
    if (customer.size !== undefined) addNumber(sizes, issueId, customer.size);
  }

  return { customers, counts, statuses, tiers, revenues, sizes, important };
}
