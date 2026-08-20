import { describe, expect, it } from 'vitest';

import { Store, type Change, type GitHubConnection } from '~/store';

import { DIRECTORY, directoryStatus } from './directory';

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

function github(): GitHubConnection {
  return {
    id: 'ghc1',
    workspaceId: 'w',
    creatorId: 'u1',
    enabled: true,
    branchNameFormat: '{identifier}-{title}',
    linkCommits: false,
    linkbacks: true,
    createdAt: AT,
    updatedAt: AT,
  };
}

describe('directoryStatus', () => {
  it('marks shipped integrations available until the replica has a connection', () => {
    const store = new Store('w');
    const githubEntry = DIRECTORY.find((entry) => entry.id === 'github')!;
    const slack = DIRECTORY.find((entry) => entry.id === 'slack')!;
    expect(directoryStatus(store, githubEntry)).toBe('available');
    expect(directoryStatus(store, slack)).toBe('available');
  });

  it('marks GitHub connected once a workspace install is on the replica', () => {
    const store = new Store('w');
    store.applyChanges([upsert(1, 'githubConnection', github())]);
    const githubEntry = DIRECTORY.find((entry) => entry.id === 'github')!;
    expect(directoryStatus(store, githubEntry)).toBe('connected');
  });

  it('gives every catalogued integration a unique id and a category', () => {
    const ids = DIRECTORY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DIRECTORY.every((entry) => entry.category.length > 0 && entry.summary.length > 0)).toBe(
      true,
    );
  });
});
