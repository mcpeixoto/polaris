/**
 * The projects list's filters, which used to be local state: the layout survived a reload
 * and the filters silently did not, so a shared "violated dependencies" link opened on
 * everything. They are query-string values now, and these are the rules for reading them.
 */

import { describe, expect, it } from 'vitest';

import {
  activeProjectFilterCount,
  DEFAULT_PROJECT_FILTERS,
  matchesProjectStatusFilter,
  resolveProjectFilters,
  toProjectFilterParams,
  type ProjectFilterOptions,
} from './display';

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe('project list filters in the URL', () => {
  it('defaults to everything when the query string is empty', () => {
    expect(resolveProjectFilters(params(''))).toEqual(DEFAULT_PROJECT_FILTERS);
  });

  it('round-trips every filter', () => {
    const filters: ProjectFilterOptions = {
      dependency: 'violated',
      customer: 'tier:Enterprise',
      status: 'started',
    };
    expect(
      resolveProjectFilters(params(new URLSearchParams(toProjectFilterParams(filters)).toString())),
    ).toEqual(filters);
  });

  it('writes nothing for a filter that is not narrowing anything', () => {
    expect(toProjectFilterParams(DEFAULT_PROJECT_FILTERS)).toEqual({});
    expect(activeProjectFilterCount(DEFAULT_PROJECT_FILTERS)).toBe(0);
    expect(
      activeProjectFilterCount({ dependency: 'blocking', customer: 'any', status: 'all' }),
    ).toBe(2);
  });

  it('ignores a value it does not recognise rather than filtering on it', () => {
    expect(resolveProjectFilters(params('dependency=sideways&status=nowhere'))).toEqual(
      DEFAULT_PROJECT_FILTERS,
    );
  });

  /**
   * `customer:` and `tier:` name open sets, so a filter pointing at a customer that has
   * since been deleted is kept and matches nothing. Resetting it to "all" would quietly
   * widen the list under somebody who asked to narrow it.
   */
  it('keeps a customer filter whose subject may no longer exist', () => {
    expect(resolveProjectFilters(params('customer=customer%3Agone')).customer).toBe(
      'customer:gone',
    );
  });
});

describe('matchesProjectStatusFilter', () => {
  const store = {
    projects: new Map([
      ['p1', { statusId: 's-started' }],
      ['p2', { statusId: 's-done' }],
    ]),
    projectStatuses: new Map([
      ['s-started', { category: 'started' }],
      ['s-done', { category: 'completed' }],
    ]),
  } as unknown as Parameters<typeof matchesProjectStatusFilter>[0];

  it('lets everything through on "all"', () => {
    expect(matchesProjectStatusFilter(store, 'p1', 'all')).toBe(true);
    expect(matchesProjectStatusFilter(store, 'p2', 'all')).toBe(true);
  });

  it('keeps only the projects whose status is in the chosen category', () => {
    expect(matchesProjectStatusFilter(store, 'p1', 'started')).toBe(true);
    expect(matchesProjectStatusFilter(store, 'p2', 'started')).toBe(false);
  });

  it('excludes a project the replica does not have', () => {
    expect(matchesProjectStatusFilter(store, 'missing', 'started')).toBe(false);
  });
});
