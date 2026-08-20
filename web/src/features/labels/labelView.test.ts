import { describe, expect, it } from 'vitest';

import { Store, type Change, type Issue, type IssueLabel, type Label } from '~/store';

import { issueIdsForLabelView, labelViewPath, labelViewTitle, userViewPath } from './labelView';

const AT = '2026-01-01T00:00:00Z';

function upsert(v: number, type: Change['type'], entity: { id: string }): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'system' },
    payload: entity as never,
  };
}

function label(id: string, over: Partial<Label> = {}): Label {
  return {
    id,
    workspaceId: 'w',
    name: id,
    color: '#e11',
    isGroup: false,
    position: 'a0',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function issue(id: string): Issue {
  return {
    id,
    workspaceId: 'w',
    teamId: 't1',
    number: 1,
    identifier: 'ENG-1',
    title: id,
    description: '',
    stateId: 's1',
    priority: 0,
    sortOrder: 'a0',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issueLabel(id: string, issueId: string, labelId: string): IssueLabel {
  return { id, workspaceId: 'w', issueId, labelId, teamId: 't1', createdAt: AT };
}

function seeded(rows: Change[]): Store {
  const store = new Store('w');
  store.applyChanges(rows);
  return store;
}

describe('labelViewPath', () => {
  it('is a stable deep link per label', () => {
    expect(labelViewPath('lab-1')).toBe('/label/lab-1');
    expect(userViewPath('u-1')).toBe('/user/u-1');
  });
});

describe('labelViewTitle', () => {
  it('names a group on its own and prefixes children with the group', () => {
    const store = seeded([
      upsert(1, 'label', label('priority', { name: 'Priority', isGroup: true })),
      upsert(2, 'label', label('p0', { name: 'P0', parentId: 'priority' })),
      upsert(3, 'label', label('bug', { name: 'bug' })),
    ]);
    expect(labelViewTitle(store, 'priority')).toBe('Priority');
    expect(labelViewTitle(store, 'p0')).toBe('Priority: P0');
    expect(labelViewTitle(store, 'bug')).toBe('bug');
    expect(labelViewTitle(store, 'missing')).toBeNull();
  });
});

describe('issueIdsForLabelView', () => {
  it('lists issues on a label, and unions children for a group', () => {
    const store = seeded([
      upsert(1, 'label', label('priority', { name: 'Priority', isGroup: true })),
      upsert(2, 'label', label('p0', { name: 'P0', parentId: 'priority' })),
      upsert(3, 'label', label('p1', { name: 'P1', parentId: 'priority' })),
      upsert(4, 'issue', issue('i-p0')),
      upsert(5, 'issue', issue('i-p1')),
      upsert(6, 'issue', issue('i-both')),
      upsert(7, 'issueLabel', issueLabel('il1', 'i-p0', 'p0')),
      upsert(8, 'issueLabel', issueLabel('il2', 'i-p1', 'p1')),
      upsert(9, 'issueLabel', issueLabel('il3', 'i-both', 'p0')),
      upsert(10, 'issueLabel', issueLabel('il4', 'i-both', 'p1')),
    ]);

    expect([...issueIdsForLabelView(store, 'p0')].sort()).toEqual(['i-both', 'i-p0']);
    expect([...issueIdsForLabelView(store, 'priority')].sort()).toEqual(['i-both', 'i-p0', 'i-p1']);
    expect(issueIdsForLabelView(store, 'missing').size).toBe(0);
  });
});
