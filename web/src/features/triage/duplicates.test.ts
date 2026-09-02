/**
 * The two questions the duplicate menu asks: what to offer before anything is typed, and
 * what a typed word means. The second one is the reason this file exists — a search that
 * only ever saw the forty most recently updated rows in one team could not find the older
 * report a duplicate almost always points at.
 */

import { describe, expect, it } from 'vitest';

import {
  Store,
  type Change,
  type Entity,
  type EntityType,
  type Issue,
  type Team,
  type WorkflowState,
} from '~/store';

import { duplicateCandidates } from './duplicates';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const OTHER_TEAM = '01900000-0000-7000-8000-00000000000a';
const TODO = '01900000-0000-7000-8000-000000000003';
const AT = '2026-01-01T00:00:00.000Z';
const NONE = new Set<string>();

describe('duplicateCandidates', () => {
  it('offers the team’s own work by recency when nothing has been typed', () => {
    const store = seeded([
      issue('i1', TEAM, 'Older', { updatedAt: '2026-01-01T00:00:00.000Z' }),
      issue('i2', TEAM, 'Newer', { updatedAt: '2026-05-01T00:00:00.000Z' }),
      issue('i3', OTHER_TEAM, 'Elsewhere', { updatedAt: '2026-06-01T00:00:00.000Z' }),
    ]);
    const rows = duplicateCandidates(store, { query: '', teamId: TEAM, exclude: NONE });
    expect(rows.map((row) => row.id)).toEqual(['i2', 'i1']);
  });

  it('finds an old issue that recency had pushed out of reach', () => {
    const filler = Array.from({ length: 60 }, (_, n) =>
      issue(`f${n}`, TEAM, `Filler ${n}`, { updatedAt: '2026-05-01T00:00:00.000Z' }),
    );
    const store = seeded([
      ...filler,
      issue('old', TEAM, 'Login redirect loops', { updatedAt: '2024-01-01T00:00:00.000Z' }),
    ]);

    const byRecency = duplicateCandidates(store, { query: '', teamId: TEAM, exclude: NONE });
    expect(byRecency.map((row) => row.id)).not.toContain('old');

    const found = duplicateCandidates(store, {
      query: 'login redirect',
      teamId: TEAM,
      exclude: NONE,
    });
    expect(found.map((row) => row.id)).toEqual(['old']);
  });

  it('searches across teams, and says which team an outside match is in', () => {
    const store = seeded([
      issue('mine', TEAM, 'Unrelated'),
      issue('theirs', OTHER_TEAM, 'Login redirect loops'),
    ]);
    const rows = duplicateCandidates(store, { query: 'redirect', teamId: TEAM, exclude: NONE });
    expect(rows.map((row) => row.id)).toEqual(['theirs']);
    expect(rows[0]?.teamKey).toBe('DES');
  });

  it('ranks the row’s own team above a match somewhere else', () => {
    const store = seeded([
      issue('theirs', OTHER_TEAM, 'Login redirect', { updatedAt: '2026-06-01T00:00:00.000Z' }),
      issue('mine', TEAM, 'Login redirect', { updatedAt: '2024-01-01T00:00:00.000Z' }),
    ]);
    const rows = duplicateCandidates(store, { query: 'login', teamId: TEAM, exclude: NONE });
    expect(rows.map((row) => row.id)).toEqual(['mine', 'theirs']);
  });

  it('matches an identifier, folds accents and narrows on a second word', () => {
    const store = seeded([
      // The number is pinned because the identifier the search matches is derived from the
      // team key and the number, not from the field this fixture sets.
      issue('a', TEAM, 'Ação falhou', { number: 1 }),
      issue('b', TEAM, 'Something else entirely'),
    ]);
    expect(
      duplicateCandidates(store, { query: 'ENG-1', teamId: TEAM, exclude: NONE }).map((r) => r.id),
    ).toEqual(['a']);
    expect(
      duplicateCandidates(store, { query: 'acao', teamId: TEAM, exclude: NONE }).map((r) => r.id),
    ).toEqual(['a']);
    expect(
      duplicateCandidates(store, { query: 'acao entirely', teamId: TEAM, exclude: NONE }),
    ).toEqual([]);
  });

  it('never offers the rows being merged, or archived work', () => {
    const store = seeded([
      issue('self', TEAM, 'Login redirect'),
      issue('gone', TEAM, 'Login redirect', { archivedAt: AT }),
      issue('keep', TEAM, 'Login redirect'),
    ]);
    const rows = duplicateCandidates(store, {
      query: 'login',
      teamId: TEAM,
      exclude: new Set(['self']),
    });
    expect(rows.map((row) => row.id)).toEqual(['keep']);
  });

  it('has nothing to offer before a team is known and nothing is typed', () => {
    const store = seeded([issue('i1', TEAM, 'Anything')]);
    expect(duplicateCandidates(store, { query: '', teamId: undefined, exclude: NONE })).toEqual([]);
  });
});

function seeded(issues: readonly Issue[]): Store {
  const store = new Store(WORKSPACE);
  const changes: Change[] = [
    change(1, 'team', TEAM, team(TEAM, 'ENG')),
    change(2, 'team', OTHER_TEAM, team(OTHER_TEAM, 'DES')),
    change(3, 'workflowState', TODO, state(TODO, 'Todo', 'unstarted')),
  ];
  issues.forEach((entity, index) => {
    changes.push(change(4 + index, 'issue', entity.id, entity));
  });
  store.applyChanges(changes);
  return store;
}

function change(v: number, type: EntityType, id: string, payload: Entity): Change {
  return { v, type, id, op: 'upsert', actor: { type: 'system' }, payload };
}

function team(id: string, key: string): Team {
  return {
    id,
    workspaceId: WORKSPACE,
    key,
    name: key,
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
    triageEnabled: true,
    triageRequirePriority: false,
    autoCloseDays: 0,
    autoArchiveDays: 0,
    autoCloseParent: false,
    autoCloseChildren: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function state(id: string, name: string, category: WorkflowState['category']): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    color: '#5e6ad2',
    category,
    position: 'V',
    isDefault: true,
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

let nextNumber = 1;

function issue(id: string, teamId: string, title: string, extra: Partial<Issue> = {}): Issue {
  const number = nextNumber++;
  return {
    id,
    workspaceId: WORKSPACE,
    teamId,
    number,
    identifier: `${teamId === TEAM ? 'ENG' : 'DES'}-${number}`,
    title,
    description: '',
    stateId: TODO,
    priority: 0,
    sortOrder: 'V',
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  };
}
