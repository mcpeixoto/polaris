import { describe, expect, it } from 'vitest';

import { isValidFilter, validateFilter, FilterError } from './validate';

/** The detail of a rejection, without the path prefix. */
function reject(input: unknown): FilterError {
  try {
    validateFilter(input);
  } catch (error) {
    if (error instanceof FilterError) return error;
    throw error;
  }
  throw new Error(`${JSON.stringify(input)} was accepted; it must be rejected`);
}

describe('validateFilter', () => {
  it('accepts the column default and the canonical empty as the same filter', () => {
    // `{}` is what a freshly created view holds. Rejecting it would make that view
    // unopenable, and treating it as anything but "matches everything" would make a new
    // view show nothing.
    expect(validateFilter({})).toEqual({ conj: 'and', nodes: [] });
    expect(validateFilter({ conj: 'and', nodes: [] })).toEqual({ conj: 'and', nodes: [] });
  });

  it('fills in the conjunction so nothing downstream has to remember the default', () => {
    expect(validateFilter({ nodes: [] })).toEqual({ conj: 'and', nodes: [] });
  });

  it('accepts a clause with no values only for the null operators', () => {
    expect(validateFilter({ field: 'assignee', op: 'isNull' })).toEqual({
      field: 'assignee',
      op: 'isNull',
    });
  });

  it('keeps an empty in-list, which means something different from an absent one', () => {
    expect(validateFilter({ field: 'priority', op: 'in', values: [] })).toEqual({
      field: 'priority',
      op: 'in',
      values: [],
    });
  });

  it('names the node that failed, so a view bar can highlight one chip', () => {
    const error = reject({
      conj: 'or',
      nodes: [
        { field: 'assignee', op: 'isNull' },
        { conj: 'and', nodes: [{ field: 'sprint', op: 'eq', values: ['x'] }] },
      ],
    });
    expect(error.path).toBe('nodes[1].nodes[0]');
    expect(error.message).toContain('unknown field');
  });

  it('names the offending value, not just the clause', () => {
    const error = reject({ field: 'assignee', op: 'in', values: [ok(), 'nope'] });
    expect(error.path).toBe('values[1]');
    expect(error.message).toContain('uuid');
  });

  it('rejects a key the grammar does not have, rather than ignoring it', () => {
    // An ignored key is a filter that does something other than what it says. Today it is
    // a typo; the version after next it is a field this build has never heard of, and
    // guessing at that one silently widens the result set.
    expect(reject({ field: 'assignee', op: 'isNull', not: true }).message).toContain('clause');
    expect(reject({ conj: 'and', nodes: [], limit: 10 }).message).toContain('group');
  });

  it('rejects a node that is neither a clause nor a group', () => {
    expect(reject({ wat: true }).message).toContain('clause');
    expect(reject([]).message).toContain('clause');
    expect(reject('assignee = ada').message).toContain('clause');
    expect(reject(null).message).toContain('clause');
  });

  it('rejects an operator the field cannot support', () => {
    expect(reject({ field: 'priority', op: 'contains', values: ['1'] }).message).toContain(
      'operator',
    );
    // `label` is a set, never null: an issue with no labels is an empty set, which
    // `notIn` over the candidates already expresses.
    expect(reject({ field: 'label', op: 'isNull' }).message).toContain('operator');
    expect(reject({ field: 'title', op: 'gt', values: ['a'] }).message).toContain('operator');
    expect(reject({ field: 'archived', op: 'lt', values: ['true'] }).message).toContain('operator');
  });

  it('rejects the wrong number of values', () => {
    expect(reject({ field: 'assignee', op: 'eq' }).message).toContain('values');
    expect(reject({ field: 'assignee', op: 'eq', values: [ok(), ok()] }).message).toContain(
      'values',
    );
    expect(reject({ field: 'assignee', op: 'isNull', values: [ok()] }).message).toContain('values');
    expect(reject({ field: 'assignee', op: 'in', values: 'nope' }).message).toContain('values');
    expect(reject({ field: 'assignee', op: 'in', values: [1] }).message).toContain('values');
  });

  it('checks each value against the field it is compared to', () => {
    expect(reject({ field: 'priority', op: 'eq', values: ['high'] }).message).toContain('number');
    expect(reject({ field: 'estimate', op: 'gt', values: ['3.5'] }).message).toContain('number');
    expect(reject({ field: 'stateCategory', op: 'eq', values: ['frozen'] }).message).toContain(
      'category',
    );
    expect(reject({ field: 'archived', op: 'eq', values: ['yes'] }).message).toContain('boolean');
    expect(reject({ field: 'state', op: 'eq', values: ['c1'] }).message).toContain('uuid');
  });

  it('rejects a date that is not a day', () => {
    // The pattern alone accepts this, and a day that is not a day compares perfectly
    // happily against every stored due date — silently, and wrongly.
    expect(reject({ field: 'dueDate', op: 'eq', values: ['2026-02-31'] }).message).toContain(
      'date',
    );
    expect(reject({ field: 'dueDate', op: 'eq', values: ['2026-13-01'] }).message).toContain(
      'date',
    );
    expect(validateFilter({ field: 'dueDate', op: 'eq', values: ['2028-02-29'] })).toBeDefined();
  });

  it('rejects a timestamp that is not RFC 3339', () => {
    expect(reject({ field: 'createdAt', op: 'gt', values: ['2026-08-01'] }).message).toContain(
      'timestamp',
    );
    expect(
      validateFilter({ field: 'createdAt', op: 'gt', values: ['2026-08-01T09:00:00Z'] }),
    ).toBeDefined();
    expect(
      validateFilter({ field: 'createdAt', op: 'gt', values: ['2026-08-01T09:00:00.5+01:00'] }),
    ).toBeDefined();
  });

  it('accepts a relative token wherever a date or a timestamp is accepted', () => {
    for (const token of ['-7d', '+3d', '-1M', '-2w', '+1y', 'today', 'startOfWeek', 'now']) {
      expect(validateFilter({ field: 'updatedAt', op: 'gte', values: [token] })).toBeDefined();
      expect(validateFilter({ field: 'dueDate', op: 'lte', values: [token] })).toBeDefined();
    }
    expect(reject({ field: 'updatedAt', op: 'gte', values: ['-7 days'] }).message).toContain(
      'timestamp',
    );
    // Unsigned: "7d" reads as both "seven days ago" and "in seven days".
    expect(reject({ field: 'updatedAt', op: 'gte', values: ['7d'] }).message).toContain(
      'timestamp',
    );
  });

  it('rejects a conjunction that is neither and nor or', () => {
    expect(reject({ conj: 'xor', nodes: [] }).message).toContain('conjunction');
    expect(reject({ conj: 'and', nodes: 'nope' }).message).toContain('nodes');
  });

  it('does not resolve a field name through the prototype chain', () => {
    // `FILTER_FIELDS["constructor"]` is a function, not a spec. Indexing without an own
    // property check turns a hostile payload into a clause that compiles to nonsense.
    expect(reject({ field: 'constructor', op: 'eq', values: ['x'] }).message).toContain(
      'unknown field',
    );
    expect(reject({ field: 'toString', op: 'eq', values: ['x'] }).message).toContain(
      'unknown field',
    );
  });

  it('rejects a filter nested beyond the recursion bound instead of overflowing the stack', () => {
    let deep: unknown = { field: 'assignee', op: 'isNull' };
    for (let i = 0; i < 40; i++) deep = { conj: 'and', nodes: [deep] };
    expect(reject(deep).message).toContain('nest');
  });

  it('answers the yes-or-no question for call sites with no error to show', () => {
    expect(isValidFilter({ field: 'priority', op: 'eq', values: ['1'] })).toBe(true);
    expect(isValidFilter({ field: 'sprint', op: 'eq', values: ['1'] })).toBe(false);
  });
});

/** A syntactically valid id, for the cases where the id itself is not what is under test. */
function ok(): string {
  return '01900000-0000-7000-8000-0000000000a1';
}
