/**
 * What a group heading can do to the issues under it.
 *
 * The agreement rule is the part worth pinning without a list on screen: a status list is
 * only honest when every issue can take it, and a group that spans teams cannot.
 */

import { describe, expect, it } from 'vitest';

import { Store, type Change, type Issue, type Team, type WorkflowState } from '~/store';

import { groupMenuItems, readGroupStatusOffer } from './groupMenu';

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const OTHER = 'team-2';
const AT = '2026-01-01T00:00:00Z';

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

function state(
  id: string,
  teamId: string,
  name: string,
  category: WorkflowState['category'],
  position: string,
  overrides: Partial<WorkflowState> = {},
): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId,
    name,
    color: '#5e6ad2',
    category,
    position,
    isDefault: false,
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function issue(id: string, teamId: string, stateId: string): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId,
    number: 1,
    identifier: `${id}`,
    title: id,
    dueDateSource: 'manual',
    description: '',
    stateId,
    priority: 0,
    sortOrder: 'V',
    createdAt: AT,
    updatedAt: AT,
  };
}

function storeOf(entities: (Team | WorkflowState | Issue)[]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    entities.map((entity, index) => ({
      v: index + 1,
      type: entityType(entity),
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as Change[],
  );
  return store;
}

function entityType(entity: Team | WorkflowState | Issue): string {
  if ('key' in entity && 'timezone' in entity) return 'team';
  if ('category' in entity && 'position' in entity) return 'workflowState';
  return 'issue';
}

describe('readGroupStatusOffer', () => {
  const backlog = state('s-backlog', TEAM, 'Backlog', 'backlog', 'a');
  const todo = state('s-todo', TEAM, 'Todo', 'unstarted', 'b');
  const doing = state('s-doing', TEAM, 'In Progress', 'started', 'c');
  const duplicate = state('s-dup', TEAM, 'Duplicate', 'duplicate', 'd', { isSystem: true });

  it('lists one team’s statuses, in workflow order, and ticks the one they share', () => {
    const store = storeOf([
      team(TEAM, 'ENG'),
      backlog,
      doing,
      todo,
      duplicate,
      issue('i1', TEAM, 's-backlog'),
      issue('i2', TEAM, 's-backlog'),
    ]);

    const offer = readGroupStatusOffer(store, ['i1', 'i2']);

    expect(offer.reason).toBe('ok');
    expect(offer.stateId).toBe('s-backlog');
    expect(offer.states.map((state) => state.name)).toEqual(['Backlog', 'Todo', 'In Progress']);
  });

  it('ticks nothing when the issues do not share a status', () => {
    const store = storeOf([
      team(TEAM, 'ENG'),
      backlog,
      todo,
      issue('i1', TEAM, 's-backlog'),
      issue('i2', TEAM, 's-todo'),
    ]);

    const offer = readGroupStatusOffer(store, ['i1', 'i2']);

    expect(offer.reason).toBe('ok');
    expect(offer.stateId).toBeUndefined();
    expect(offer.states).toHaveLength(2);
  });

  it('refuses a group that spans teams', () => {
    const store = storeOf([
      team(TEAM, 'ENG'),
      team(OTHER, 'DES'),
      backlog,
      state('s-des', OTHER, 'Todo', 'unstarted', 'a'),
      issue('i1', TEAM, 's-backlog'),
      issue('i2', OTHER, 's-des'),
    ]);

    expect(readGroupStatusOffer(store, ['i1', 'i2'])).toEqual({
      reason: 'teams',
      stateId: undefined,
      states: [],
    });
  });

  it('has nothing to offer for a heading with no issues', () => {
    const store = storeOf([team(TEAM, 'ENG'), backlog]);

    expect(readGroupStatusOffer(store, [])).toEqual({
      reason: 'empty',
      stateId: undefined,
      states: [],
    });
  });
});

describe('groupMenuItems', () => {
  const offer = {
    reason: 'ok' as const,
    stateId: 's-backlog',
    states: [
      { id: 's-backlog', name: 'Backlog', category: 'backlog' as const },
      { id: 's-todo', name: 'Todo', category: 'unstarted' as const },
    ],
  };

  it('puts Select all and the statuses in one list, with the current one ticked', () => {
    const items = groupMenuItems({
      count: 11,
      offer,
      onSelectAll: () => {},
      onSetStatus: () => {},
    });

    expect(items.map((item) => ('label' in item ? item.label : item.kind))).toEqual([
      'Select all',
      'separator',
      'Backlog',
      'Todo',
    ]);
    const backlog = items[2];
    expect(backlog && 'selected' in backlog && backlog.selected).toBe(true);
    const selectAll = items[0];
    expect(selectAll && 'hint' in selectAll && selectAll.hint).toBe('11');
  });

  it('says why a mixed-team group has no statuses', () => {
    const items = groupMenuItems({
      count: 2,
      offer: { reason: 'teams', stateId: undefined, states: [] },
      onSelectAll: () => {},
      onSetStatus: () => {},
    });

    const refused = items.find((item) => 'id' in item && item.id === 'status-teams');
    expect(refused && 'disabled' in refused && refused.disabled).toBe(true);
  });
});
