import { describe, expect, it, vi } from 'vitest';

import { compileFilter } from '~/filter';
import { Store, type Issue } from '~/store';

import { filterContextFor } from './context';

/**
 * The scan that ran whether or not anybody asked for it.
 *
 * `filterContextFor` is called on every filter and display change, and it built seven
 * customer indexes off `customerRequests` each time — six Maps and a Set, allocated for a
 * question almost no filter asks. Everything else it hands over is the store's own live
 * index, so this was the only real work in the function.
 *
 * The observable is the store's `customerRequests` accessor: nothing else reads it.
 */

const WORKSPACE = '00000000-0000-4000-8000-000000000001';
const CLOCK = { now: Date.parse('2026-01-01T00:00:00Z'), timezone: 'Europe/Lisbon' };

function watched(): { store: Store; reads: () => number } {
  const store = new Store(WORKSPACE);
  const spy = vi.spyOn(store, 'customerRequests', 'get');
  return { store, reads: () => spy.mock.calls.length };
}

/** The two fields the default gates read, which is all a compiled predicate needs here. */
function issue(): Issue {
  return { id: 'i1', stateId: 's1', priority: 1 } as unknown as Issue;
}

describe('the customer index', () => {
  it('is not built by building a context', () => {
    const { store, reads } = watched();

    filterContextFor(store, CLOCK);

    expect(reads()).toBe(0);
  });

  it('is not built by a filter that never mentions a customer', () => {
    const { store, reads } = watched();

    const matches = compileFilter(
      { conj: 'and', nodes: [{ field: 'priority', op: 'eq', values: ['1'] }] },
      filterContextFor(store, CLOCK),
    );
    matches(issue());

    expect(reads()).toBe(0);
  });

  it('is built once, however many clauses and rows read it', () => {
    const { store, reads } = watched();

    const matches = compileFilter(
      {
        conj: 'and',
        nodes: [
          { field: 'customerCount', op: 'gt', values: ['0'] },
          { field: 'customerTier', op: 'in', values: ['Enterprise'] },
        ],
      },
      filterContextFor(store, CLOCK),
    );
    matches(issue());
    matches(issue());

    // One scan for the whole context, not one per clause and not one per row: the getters
    // memoise, which is what makes reading them from inside the inner loop free.
    expect(reads()).toBe(1);
  });
});
