import { afterEach, describe, expect, it, vi } from 'vitest';

import { Store, type Change, type Issue, type TeamMembership } from '~/store';

import {
  clearTeamIssueLimitDismissed,
  dismissTeamIssueLimit,
  isMemberOfTeam,
  isTeamIssueLimitDismissed,
  liveIssueCountForTeam,
  TEAM_ISSUE_LIMIT,
  TEAM_ISSUE_WARN_AT,
  teamIssueLimitNotice,
} from './issueLimit';

const AT = '2026-01-01T00:00:00Z';

function issue(id: string, over: Partial<Issue> = {}): Issue {
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
    ...over,
  };
}

function membership(id: string, teamId: string, userId: string): TeamMembership {
  return {
    id,
    workspaceId: 'w',
    teamId,
    userId,
    role: 'member',
    createdAt: AT,
    updatedAt: AT,
  };
}

function seeded(rows: Change[]): Store {
  const store = new Store('w');
  store.applyChanges(rows);
  return store;
}

function upsert(v: number, type: Change['type'], entity: Change['payload']): Change {
  return {
    v,
    type,
    id: (entity as { id: string }).id,
    op: 'upsert',
    actor: { type: 'system' },
    payload: entity,
  };
}

describe('liveIssueCountForTeam', () => {
  it('counts live issues on the team and ignores archived ones and other teams', () => {
    const store = seeded([
      upsert(1, 'issue', issue('live')),
      upsert(2, 'issue', issue('done-but-live', { id: 'done-but-live' })),
      upsert(3, 'issue', issue('archived', { id: 'archived', archivedAt: AT })),
      upsert(4, 'issue', issue('elsewhere', { id: 'elsewhere', teamId: 't2' })),
    ]);
    expect(liveIssueCountForTeam(store, 't1')).toBe(2);
    expect(liveIssueCountForTeam(store, 't2')).toBe(1);
  });
});

describe('isMemberOfTeam', () => {
  it('is true only for a membership on that team', () => {
    const store = seeded([
      upsert(1, 'teamMembership', membership('m1', 't1', 'u1')),
      upsert(2, 'teamMembership', membership('m2', 't2', 'u1')),
    ]);
    expect(isMemberOfTeam(store, 't1', 'u1')).toBe(true);
    expect(isMemberOfTeam(store, 't1', 'u2')).toBe(false);
    expect(isMemberOfTeam(store, 't3', 'u1')).toBe(false);
  });
});

describe('teamIssueLimitNotice', () => {
  it('is silent below the warning line and at a dismissed warning', () => {
    expect(teamIssueLimitNotice(TEAM_ISSUE_WARN_AT - 1, false)).toBeNull();
    expect(teamIssueLimitNotice(TEAM_ISSUE_WARN_AT, true)).toBeNull();
    expect(teamIssueLimitNotice(TEAM_ISSUE_LIMIT, true)).toBeNull();
  });

  it('warns from 90% and switches to the hard cap', () => {
    expect(teamIssueLimitNotice(TEAM_ISSUE_WARN_AT, false)).toBe('warn');
    expect(teamIssueLimitNotice(TEAM_ISSUE_LIMIT - 1, false)).toBe('warn');
    expect(teamIssueLimitNotice(TEAM_ISSUE_LIMIT, false)).toBe('limit');
  });
});

describe('team issue limit dismiss', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('remembers a dismiss for this team only, and forgets it when asked', () => {
    expect(isTeamIssueLimitDismissed('t1')).toBe(false);
    dismissTeamIssueLimit('t1');
    expect(isTeamIssueLimitDismissed('t1')).toBe(true);
    expect(isTeamIssueLimitDismissed('t2')).toBe(false);
    clearTeamIssueLimitDismissed('t1');
    expect(isTeamIssueLimitDismissed('t1')).toBe(false);
  });

  it('survives sessionStorage throwing rather than taking the list down', () => {
    vi.stubGlobal('sessionStorage', {
      getItem() {
        throw new Error('private');
      },
      setItem() {
        throw new Error('private');
      },
      removeItem() {
        throw new Error('private');
      },
    });
    expect(isTeamIssueLimitDismissed('t1')).toBe(false);
    expect(() => dismissTeamIssueLimit('t1')).not.toThrow();
    expect(() => clearTeamIssueLimitDismissed('t1')).not.toThrow();
  });
});
