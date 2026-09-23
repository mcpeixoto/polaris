import { describe, expect, it } from 'vitest';

import { EMPTY_FILTER, type FilterNode } from '~/filter';

import { andCategoryTab, applyFilterParam, readFilter } from './filterParam';

describe('readFilter', () => {
  it('rejects a project field when the subject is issues', () => {
    const { filter, error } = readFilter('lead.isNull');
    expect(error).toContain('lead');
    expect(filter).toEqual(EMPTY_FILTER);
  });

  it('accepts a project field when the subject is projects', () => {
    const { filter, error } = readFilter('lead.isNull', 'project');
    expect(error).toBeNull();
    expect(filter).toEqual({ conj: 'and', nodes: [{ field: 'lead', op: 'isNull' }] });
  });
});

describe('andCategoryTab', () => {
  const filter: FilterNode = { field: 'priority', op: 'eq', values: ['1'] };

  it('leaves the filter alone when the tab is all or unknown', () => {
    expect(andCategoryTab(filter, null)).toBe(filter);
    expect(andCategoryTab(filter, 'all')).toBe(filter);
    expect(andCategoryTab(filter, 'nope')).toBe(filter);
  });

  it('ands a real category without replacing the filter', () => {
    expect(andCategoryTab(filter, 'backlog')).toEqual({
      conj: 'and',
      nodes: [{ field: 'stateCategory', op: 'eq', values: ['backlog'] }, filter],
    });
  });
});

describe('applyFilterParam', () => {
  it('deletes the param when the filter matches everything', () => {
    const params = new URLSearchParams('filter=priority.eq(1)&tab=backlog');
    applyFilterParam(params, EMPTY_FILTER);
    expect(params.get('filter')).toBeNull();
    expect(params.get('tab')).toBe('backlog');
  });
});
