import { describe, expect, it } from 'vitest';

import { operatorApplies } from './types';
import { parseFilterParam, toFilterParam } from './url';
import { isValidFilter } from './validate';

/**
 * `in` over prose, which the URL cannot carry.
 *
 * The empty string encodes to nothing, so `title in [""]` and `title in []` are the same
 * bytes — `title.in()` — and the reader has to choose one. It chose the empty list, which is
 * the opposite predicate: the filter somebody built to match a blank title came back
 * matching nothing at all. There is no escape to add, because the grammar's only signal here
 * is the presence of a value, so the pairing itself is what goes.
 */
describe('text fields and the list operators', () => {
  it('does not offer `in` or `notIn` for prose', () => {
    expect(operatorApplies('title', 'in')).toBe(false);
    expect(operatorApplies('title', 'notIn')).toBe(false);
    expect(operatorApplies('description', 'in')).toBe(false);
  });

  it('keeps `contains` and the equalities, which do survive the URL', () => {
    expect(operatorApplies('title', 'contains')).toBe(true);
    expect(operatorApplies('title', 'eq')).toBe(true);
    // `eq` takes exactly one value, so the reader knows an empty pair of parentheses can only
    // be the empty string — the repair `parseFilterParam` already makes.
    const filter = { field: 'title', op: 'eq', values: [''] } as const;
    expect(parseFilterParam(toFilterParam(filter))).toEqual({ conj: 'and', nodes: [filter] });
  });

  /**
   * `customerTier` is text an issue holds a set of, its values are workspace-defined names
   * rather than prose, and none of them is empty — so "tier is any of Enterprise, Pro" is
   * both the natural question and one the URL carries intact.
   */
  it('keeps them for the one text field that holds a set', () => {
    expect(operatorApplies('customerTier', 'in')).toBe(true);
    const filter = { field: 'customerTier', op: 'in', values: ['Enterprise', 'Pro'] } as const;
    expect(isValidFilter(filter)).toBe(true);
    expect(parseFilterParam(toFilterParam(filter))).toEqual({ conj: 'and', nodes: [filter] });
  });

  it('rejects a title `in` rather than reading it back as something else', () => {
    expect(isValidFilter({ field: 'title', op: 'in', values: [''] })).toBe(false);

    let reported: string | null = null;
    expect(parseFilterParam('title.in()', (message) => (reported = message))).toEqual({
      conj: 'and',
      nodes: [],
    });
    // Reported rather than swallowed: the bar says so, which is the whole reason
    // `parseFilterParam` takes a callback.
    expect(reported).not.toBeNull();
  });
});
