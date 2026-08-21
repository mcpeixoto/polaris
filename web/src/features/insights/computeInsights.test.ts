import { describe, expect, it } from 'vitest';

import { EMPTY_FILTER } from '~/filter';
import { Store } from '~/store/store';
import type { Change, Entity, Issue, Label, Team, User, WorkflowState } from '~/store/types';

import { andFilterClause, buildInsights } from './computeInsights';

const NOW = '2026-03-01T12:00:00.000Z';
const ACTOR = { type: 'user', id: 'u1' } as const;

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: ACTOR, payload: entity };
}

function teamRow(): Team {
  return {
    id: 't1',
    workspaceId: 'w',
    key: 'ENG',
    name: 'Engineering',
    timezone: 'UTC',
    private: false,
    estimateScale: 'fibonacci',
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
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function user(id: string, displayName: string): User {
  return {
    id,
    workspaceId: 'w',
    name: displayName.toLowerCase(),
    displayName,
    timezone: 'UTC',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function state(id: string, category: WorkflowState['category']): WorkflowState {
  return {
    id,
    workspaceId: 'w',
    teamId: 't1',
    name: category,
    color: '#888',
    category,
    position: id,
    isDefault: category === 'unstarted',
    isSystem: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function issue(id: string, over: Partial<Issue> = {}): Issue {
  return {
    id,
    workspaceId: 'w',
    teamId: 't1',
    number: Number(id.slice(1)),
    identifier: `ENG-${id.slice(1)}`,
    title: id,
    description: '',
    stateId: 'todo',
    priority: 3,
    sortOrder: id,
    dueDateSource: 'manual',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: NOW,
    ...over,
  };
}

function seed(store: Store): void {
  const bug: Label = {
    id: 'bug',
    workspaceId: 'w',
    name: 'Bug',
    color: '#e5484d',
    position: 'a',
    isGroup: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
  store.applyChanges([
    upsert(1, 'team', teamRow()),
    upsert(2, 'user', user('u1', 'Ada')),
    upsert(3, 'workflowState', state('todo', 'unstarted')),
    upsert(4, 'workflowState', state('done', 'completed')),
    upsert(5, 'label', bug),
    upsert(
      6,
      'issue',
      issue('i1', {
        assigneeId: 'u1',
        priority: 1,
        estimate: 5,
        stateId: 'done',
        startedAt: '2026-02-02T00:00:00.000Z',
        completedAt: '2026-02-12T00:00:00.000Z',
      }),
    ),
    upsert(7, 'issue', issue('i2', { priority: 3, estimate: 2 })),
    upsert(8, 'issueLabel', {
      id: 'il1',
      workspaceId: 'w',
      issueId: 'i1',
      labelId: 'bug',
      teamId: 't1',
      createdAt: NOW,
    }),
  ]);
}

describe('buildInsights', () => {
  it('counts issues per assignee', () => {
    const store = new Store('w');
    seed(store);
    const data = buildInsights(store, ['i1', 'i2'], 'count', 'assignee');
    expect(data.chart).toBe('bar');
    expect(data.total).toBe(2);
    expect(data.buckets.map((bucket) => [bucket.label, bucket.value])).toEqual([
      ['Ada', 1],
      ['Unassigned', 1],
    ]);
    expect(data.buckets[0]!.filter).toEqual({ field: 'assignee', op: 'eq', values: ['u1'] });
    expect(data.buckets[1]!.filter).toEqual({ field: 'assignee', op: 'isNull' });
  });

  it('sums effort per priority', () => {
    const store = new Store('w');
    seed(store);
    const data = buildInsights(store, ['i1', 'i2'], 'effort', 'priority');
    expect(data.total).toBe(7);
    const urgent = data.buckets.find((bucket) => bucket.label === 'Urgent');
    const medium = data.buckets.find((bucket) => bucket.label === 'Medium');
    expect(urgent!.value).toBe(5);
    expect(medium!.value).toBe(2);
  });

  it('measures lead time in days for completed issues', () => {
    const store = new Store('w');
    seed(store);
    const data = buildInsights(store, ['i1', 'i2'], 'leadTime', 'assignee');
    expect(data.chart).toBe('scatter');
    expect(data.buckets).toHaveLength(1);
    expect(data.buckets[0]!.label).toBe('Ada');
    expect(data.buckets[0]!.value).toBe(11);
    expect(data.scatter).toHaveLength(1);
  });

  it('accumulates a burn-up by month', () => {
    const store = new Store('w');
    seed(store);
    const data = buildInsights(store, ['i1', 'i2'], 'burnUp', 'assignee');
    expect(data.chart).toBe('area');
    expect(data.burn).toEqual([{ period: '2026-02', completed: 5 }]);
    expect(data.total).toBe(5);
  });

  it('slices an issue into every label it carries', () => {
    const store = new Store('w');
    seed(store);
    const data = buildInsights(store, ['i1', 'i2'], 'count', 'label');
    expect(data.buckets.map((bucket) => bucket.label).sort()).toEqual(['Bug', 'No label']);
  });

  it('slices by cycle and by originating template', () => {
    const store = new Store('w');
    seed(store);
    store.applyChanges([
      upsert(20, 'cycle', {
        id: 'c1',
        workspaceId: 'w',
        teamId: 't1',
        number: 1,
        name: 'Cycle 1',
        startsAt: '2026-02-01T00:00:00.000Z',
        endsAt: '2026-02-15T00:00:00.000Z',
        createdAt: NOW,
        updatedAt: NOW,
      }),
      upsert(21, 'issueTemplate', {
        id: 'tpl1',
        workspaceId: 'w',
        name: 'Bug report',
        title: '',
        body: '',
        properties: {},
        subIssues: [],
        position: 'a',
        createdAt: NOW,
        updatedAt: NOW,
      }),
      upsert(
        22,
        'issue',
        issue('i3', { cycleId: 'c1', templateId: 'tpl1', priority: 2, estimate: 1 }),
      ),
    ]);
    const byCycle = buildInsights(store, ['i1', 'i3'], 'count', 'cycle');
    expect(byCycle.buckets.map((bucket) => [bucket.label, bucket.value])).toEqual([
      ['Cycle 1', 1],
      ['No cycle', 1],
    ]);
    const byTemplate = buildInsights(store, ['i1', 'i3'], 'count', 'template');
    expect(byTemplate.buckets.map((bucket) => [bucket.label, bucket.filter?.op])).toEqual([
      ['Bug report', 'eq'],
      ['No template', 'isNull'],
    ]);
  });

  it('slices an issue into every customer it is attributed to', () => {
    const store = new Store('w');
    seed(store);
    store.applyChanges([
      upsert(40, 'customer', {
        id: 'acme',
        workspaceId: 'w',
        name: 'Acme',
        domains: ['acme.com'],
        status: 'active',
        tier: 'Enterprise',
        revenue: 120000,
        logoUrl: '',
        sortOrder: 'a',
        createdAt: NOW,
        updatedAt: NOW,
      }),
      upsert(41, 'customer', {
        id: 'beta',
        workspaceId: 'w',
        name: 'Beta Co',
        domains: ['beta.example'],
        status: 'prospect',
        tier: 'Startup',
        revenue: 8000,
        logoUrl: '',
        sortOrder: 'b',
        createdAt: NOW,
        updatedAt: NOW,
      }),
      upsert(42, 'customerRequest', {
        id: 'cr1',
        workspaceId: 'w',
        customerId: 'acme',
        issueId: 'i1',
        body: 'Need SSO',
        important: true,
        createdAt: NOW,
        updatedAt: NOW,
      }),
      upsert(43, 'customerRequest', {
        id: 'cr2',
        workspaceId: 'w',
        customerId: 'beta',
        issueId: 'i1',
        body: 'Also us',
        important: false,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ]);
    const byCustomer = buildInsights(store, ['i1', 'i2'], 'count', 'customer');
    expect(byCustomer.buckets.map((bucket) => [bucket.label, bucket.value, bucket.filter])).toEqual([
      ['Acme', 1, { field: 'customer', op: 'eq', values: ['acme'] }],
      ['Beta Co', 1, { field: 'customer', op: 'eq', values: ['beta'] }],
      ['No customer', 1, { field: 'customerCount', op: 'eq', values: ['0'] }],
    ]);
    const byTier = buildInsights(store, ['i1', 'i2'], 'count', 'customerTier');
    expect(byTier.buckets.map((bucket) => bucket.label).sort()).toEqual([
      'Enterprise',
      'No tier',
      'Startup',
    ]);
    const byRevenue = buildInsights(store, ['i1'], 'count', 'customerRevenue');
    expect(byRevenue.buckets.map((bucket) => [bucket.label, bucket.filter?.values])).toEqual([
      ['120,000', ['120000']],
      ['8,000', ['8000']],
    ]);
  });

  it('can include archived issues and burn up by week', () => {
    const store = new Store('w');
    seed(store);
    store.applyChanges([
      upsert(
        30,
        'issue',
        issue('i9', {
          archivedAt: '2026-02-20T00:00:00.000Z',
          completedAt: '2026-02-18T00:00:00.000Z',
          estimate: 3,
        }),
      ),
    ]);
    const hidden = buildInsights(store, ['i1', 'i9'], 'count', 'priority');
    expect(hidden.total).toBe(1);
    const shown = buildInsights(store, ['i1', 'i9'], 'count', 'priority', Date.parse(NOW), {
      includeArchived: true,
    });
    expect(shown.total).toBe(2);
    const weekly = buildInsights(store, ['i1', 'i9'], 'burnUp', 'assignee', Date.parse(NOW), {
      includeArchived: true,
      burnPeriod: 'week',
    });
    expect(weekly.burn.map((point) => point.period)).toEqual(['2026-02-09', '2026-02-16']);
  });
});

describe('andFilterClause', () => {
  it('appends onto an empty AND group', () => {
    expect(andFilterClause(EMPTY_FILTER, { field: 'priority', op: 'eq', values: ['1'] })).toEqual({
      conj: 'and',
      nodes: [{ field: 'priority', op: 'eq', values: ['1'] }],
    });
  });
});
