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
 */

import type { FilterContext, TimeContext } from '~/filter';
import type { Store } from '~/store';

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
export function filterContextFor(store: Store, clock: ViewClock): FilterContext {
  const time: TimeContext = { now: clock.now, timezone: clock.timezone };

  return {
    time,
    states: store.workflowStates,
    labels: store.labelIndex.labelsByIssue(),
    subscribers: store.subscribersByIssue(),
    blockedBy: store.relationIndex.blockedByIssue(),
    blocking: store.relationIndex.blockingByIssue(),
    // Deliberately absent in every ordinary view.
    //
    // A client's replica does not hold soft-deleted issues at all — the server revokes
    // them — so there is nothing for a `deleted` clause to match and no set to hand over.
    // The trash screen is the exception: it fetches deleted issues explicitly and passes
    // its own set, because those rows exist only for as long as that screen is open.
  };
}
