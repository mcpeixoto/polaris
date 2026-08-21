import { describe, expect, it } from 'vitest';

import { Store, type Change, type Entity, type Project } from '~/store';

import { matchesProjectCustomerFilter, projectCustomerFilterOptions } from './customerFilter';

const NOW = '2026-03-01T12:00:00.000Z';
const ACTOR = { type: 'user', id: 'u1' } as const;

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: ACTOR, payload: entity };
}

function project(id: string): Project {
  return {
    id,
    workspaceId: 'w',
    name: id,
    description: '',
    color: '#888',
    statusId: 's1',
    priority: 2,
    sortOrder: id,
    updateSchedule: 'default',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function seeded(): Store {
  const store = new Store('w');
  store.applyChanges([
    upsert(1, 'project', project('p1')),
    upsert(2, 'project', project('p2')),
    upsert(3, 'customer', {
      id: 'acme',
      workspaceId: 'w',
      name: 'Acme',
      domains: ['acme.com'],
      status: 'active',
      tier: 'Enterprise',
      logoUrl: '',
      sortOrder: 'a',
      createdAt: NOW,
      updatedAt: NOW,
    }),
    upsert(4, 'customerRequest', {
      id: 'cr1',
      workspaceId: 'w',
      customerId: 'acme',
      projectId: 'p1',
      body: 'SSO',
      important: false,
      createdAt: NOW,
      updatedAt: NOW,
    }),
  ]);
  return store;
}

describe('matchesProjectCustomerFilter', () => {
  it('keeps every project when the filter is all', () => {
    const store = seeded();
    expect(matchesProjectCustomerFilter(store, 'p1', 'all')).toBe(true);
    expect(matchesProjectCustomerFilter(store, 'p2', 'all')).toBe(true);
  });

  it('splits projects that carry a request from those that do not', () => {
    const store = seeded();
    expect(matchesProjectCustomerFilter(store, 'p1', 'any')).toBe(true);
    expect(matchesProjectCustomerFilter(store, 'p2', 'any')).toBe(false);
    expect(matchesProjectCustomerFilter(store, 'p1', 'none')).toBe(false);
    expect(matchesProjectCustomerFilter(store, 'p2', 'none')).toBe(true);
  });

  it('matches a named customer and its tier', () => {
    const store = seeded();
    expect(matchesProjectCustomerFilter(store, 'p1', 'customer:acme')).toBe(true);
    expect(matchesProjectCustomerFilter(store, 'p2', 'customer:acme')).toBe(false);
    expect(matchesProjectCustomerFilter(store, 'p1', 'tier:Enterprise')).toBe(true);
    expect(matchesProjectCustomerFilter(store, 'p2', 'tier:Enterprise')).toBe(false);
  });

  it('offers live customers and tiers for the picker', () => {
    const store = seeded();
    expect(projectCustomerFilterOptions(store)).toEqual({
      customers: [{ id: 'acme', name: 'Acme' }],
      tiers: ['Enterprise'],
    });
  });
});
