import { describe, expect, it } from 'vitest';

import { Store, type Change, type Team } from '~/store';

import { pathToActiveIssues, pathToBacklogIssues, teamKeyFromPath } from './teamIssuePaths';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';

function team(id: string, key: string, name: string): Team {
  return {
    id,
    workspaceId: WORKSPACE,
    key,
    name,
    timezone: 'Europe/Lisbon',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: false,
    cycleDurationWeeks: 1,
    cycleCooldownWeeks: 0,
    cycleStartDay: 'monday',
    cycleUpcomingCount: 2,
    cycleAutoAddStarted: false,
    cycleAutoAddCompleted: false,
    triageEnabled: false,
    triageRequirePriority: false,
    autoCloseDays: 0,
    autoArchiveDays: 0,
    autoCloseParent: false,
    autoCloseChildren: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function storeWith(...teams: Team[]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    teams.map((row, index): Change => ({
      v: index + 1,
      type: 'team',
      id: row.id,
      op: 'upsert',
      actor: { type: 'system' },
      payload: row,
    })),
  );
  return store;
}

describe('teamKeyFromPath', () => {
  it('reads the team key off a team route and nowhere else', () => {
    expect(teamKeyFromPath('/team/ENG')).toBe('ENG');
    expect(teamKeyFromPath('/team/ENG/cycles')).toBe('ENG');
    expect(teamKeyFromPath('/inbox')).toBeNull();
    expect(teamKeyFromPath('/issue/ENG-1')).toBeNull();
  });
});

describe('pathToActiveIssues / pathToBacklogIssues', () => {
  it('prefers the team the person is already looking at', () => {
    const store = storeWith(team('t-des', 'DES', 'Design'), team('t-eng', 'ENG', 'Engineering'));
    expect(pathToActiveIssues(store, '/team/ENG/triage')).toContain('/team/ENG?');
    expect(pathToBacklogIssues(store, '/team/ENG')).toContain('/team/ENG?');
  });

  it('falls back to the first team by key when the route is not a team', () => {
    const store = storeWith(team('t-des', 'DES', 'Design'), team('t-eng', 'ENG', 'Engineering'));
    expect(pathToActiveIssues(store, '/inbox')).toContain('/team/DES?');
    expect(pathToBacklogIssues(store, '/my-issues')).toContain('/team/DES?');
  });

  it('writes Active as unstarted+started and Backlog as the backlog category', () => {
    const store = storeWith(team('t-eng', 'ENG', 'Engineering'));
    const active = new URL(pathToActiveIssues(store, '/'), 'https://polaris.local');
    const backlog = new URL(pathToBacklogIssues(store, '/'), 'https://polaris.local');
    expect(active.searchParams.get('filter')).toBe('stateCategory.in(unstarted,started)');
    expect(backlog.searchParams.get('filter')).toBe('stateCategory.eq(backlog)');
  });

  it('returns home when there is no team to hang the filter on', () => {
    expect(pathToActiveIssues(new Store(WORKSPACE), '/inbox')).toBe('/');
    expect(pathToBacklogIssues(new Store(WORKSPACE), '/inbox')).toBe('/');
  });
});
