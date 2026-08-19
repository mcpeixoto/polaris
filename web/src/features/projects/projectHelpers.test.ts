import { describe, expect, it } from 'vitest';

import type { Project } from '~/store';

import { compareProjectsByPriority } from './projectHelpers';

function project(id: string, priority: number, sortOrder: string): Project {
  return {
    id,
    workspaceId: 'w',
    name: id,
    description: '',
    color: '#000',
    statusId: 'ps',
    priority,
    sortOrder,
    updateSchedule: 'default',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('compareProjectsByPriority', () => {
  it('ranks urgent above none regardless of sortOrder', () => {
    expect(compareProjectsByPriority(project('a', 1, 'z'), project('b', 0, 'a'))).toBeLessThan(0);
  });

  it('orders by sortOrder within the same band', () => {
    expect(compareProjectsByPriority(project('a', 2, 'a0'), project('b', 2, 'a1'))).toBeLessThan(0);
  });
});
