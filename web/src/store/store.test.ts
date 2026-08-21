import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { dropDatabase, PolarisDB, type EntityRow } from './db';
import type { EntityPatch } from './outbox';
import { subIssueProgress } from './query';
import { sameResult, Store } from './store';
import type {
  Attachment,
  Change,
  Comment,
  Entity,
  Favorite,
  Issue,
  IssueLabel,
  IssueRelation,
  IssueSubscription,
  IssueTemplate,
  AskForm,
  Customer,
  CustomerSubscription,
  Initiative,
  InitiativeSubscription,
  Label,
  Notification,
  Project,
  ProjectSubscription,
  RecurringIssue,
  Team,
  TeamMembership,
  User,
  UUID,
  View,
  ViewPreference,
  ViewSubscription,
  WorkflowState,
  Workspace,
} from './types';

const NOW = '2026-01-01T00:00:00Z';
const ACTOR = { type: 'user', id: 'u1' } as const;

function workspace(): Workspace {
  return {
    id: 'w1',
    name: 'Polaris',
    urlKey: 'polaris',
    plan: 'free',
    projectUpdateReminderIntervalDays: 7,
    projectUpdateReminderWeekday: 3,
    projectUpdateReminderHour: 9,
    pulseEnabled: true,
    customerRequestsEnabled: true,
    customerRevenueUnit: '',
    customerTiers: [],
    pulseDigestCadence: 'daily',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function user(id: UUID, displayName: string): User {
  return {
    id,
    workspaceId: 'w1',
    name: displayName,
    displayName,
    timezone: 'Europe/Lisbon',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function team(id: UUID, key: string): Team {
  return {
    id,
    workspaceId: 'w1',
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
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function membership(id: UUID, teamId: UUID, userId: UUID): TeamMembership {
  return {
    id,
    workspaceId: 'w1',
    teamId,
    userId,
    role: 'member',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function state(id: UUID, teamId: UUID, name: string): WorkflowState {
  return {
    id,
    workspaceId: 'w1',
    teamId,
    name,
    color: '#000000',
    category: 'unstarted',
    position: 'a0',
    isDefault: false,
    isSystem: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function issue(id: UUID, over: Partial<Issue> = {}): Issue {
  return {
    id,
    workspaceId: 'w1',
    teamId: 't1',
    number: 1,
    identifier: 'ENG-1',
    title: 'Fix the login redirect',
    description: '',
    stateId: 's1',
    priority: 0,
    sortOrder: 'a0',
    dueDateSource: 'manual',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function comment(id: UUID, issueId: UUID): Comment {
  return {
    id,
    workspaceId: 'w1',
    issueId,
    body: 'looks good',
    actor: { type: 'user', id: 'u1' },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function attachment(id: UUID, issueId: UUID): Attachment {
  return {
    id,
    workspaceId: 'w1',
    issueId,
    teamId: 't1',
    url: 'https://github.com/acme/app/pull/1',
    title: 'PR 1',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function label(id: UUID, over: Partial<Label> = {}): Label {
  return {
    id,
    workspaceId: 'w1',
    isGroup: false,
    name: id,
    color: '#cc4444',
    position: 'a0',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function issueLabel(id: UUID, issueId: UUID, labelId: UUID, over: Partial<IssueLabel> = {}) {
  const row: IssueLabel = {
    id,
    workspaceId: 'w1',
    issueId,
    labelId,
    teamId: 't1',
    createdAt: NOW,
    ...over,
  };
  return row;
}

function relation(id: UUID, issueId: UUID, relatedIssueId: UUID): IssueRelation {
  return {
    id,
    workspaceId: 'w1',
    issueId,
    relatedIssueId,
    type: 'blocks',
    teamId: 't1',
    relatedTeamId: 't1',
    createdAt: NOW,
  };
}

function subscription(id: UUID, issueId: UUID, userId: UUID): IssueSubscription {
  return {
    id,
    workspaceId: 'w1',
    issueId,
    userId,
    reason: 'created',
    unsubscribed: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function notification(id: UUID, over: Partial<Notification> = {}): Notification {
  return {
    id,
    workspaceId: 'w1',
    userId: 'u1',
    type: 'issue_assigned',
    issueId: 'i1',
    actor: ACTOR,
    changeVersion: 1,
    groupKey: `assign:${id}`,
    count: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

/**
 * The filter AST and the display options are opaque to the store: it holds them, persists
 * them and hands them back untouched. A placeholder is therefore the honest fixture —
 * their shape belongs to the filter module and is tested there.
 */
function view(id: UUID, over: Partial<View> = {}): View {
  return {
    id,
    workspaceId: 'w1',
    name: 'Urgent bugs',
    filter: {} as View['filter'],
    display: {} as View['display'],
    position: 'a0',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function viewPreference(id: UUID, userId: UUID, viewKey: string): ViewPreference {
  return {
    id,
    workspaceId: 'w1',
    userId,
    viewKey,
    display: {} as ViewPreference['display'],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function viewSubscription(id: UUID, viewId: UUID, userId: UUID): ViewSubscription {
  return {
    id,
    workspaceId: 'w1',
    viewId,
    userId,
    added: true,
    completed: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function projectSubscription(
  id: UUID,
  projectId: UUID,
  userId: UUID,
): ProjectSubscription {
  return {
    id,
    workspaceId: 'w1',
    projectId,
    userId,
    issuesAdded: true,
    issuesCompleted: false,
    updates: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function initiativeSubscription(
  id: UUID,
  initiativeId: UUID,
  userId: UUID,
): InitiativeSubscription {
  return {
    id,
    workspaceId: 'w1',
    initiativeId,
    userId,
    issuesAdded: true,
    issuesCompleted: false,
    updates: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function customerSubscription(
  id: UUID,
  customerId: UUID,
  userId: UUID,
): CustomerSubscription {
  return {
    id,
    workspaceId: 'w1',
    customerId,
    userId,
    requestAdded: true,
    requestImportant: false,
    requestCompleted: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function projectRow(id: UUID): Project {
  return {
    id,
    workspaceId: 'w1',
    name: 'Ship',
    description: '',
    color: '#3366ff',
    statusId: 'ps1',
    priority: 0,
    sortOrder: 'a0',
    updateSchedule: 'never',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function initiativeRow(id: UUID): Initiative {
  return {
    id,
    workspaceId: 'w1',
    name: 'Q3',
    description: '',
    status: 'active',
    priority: 0,
    sortOrder: 'a0',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function customerRow(id: UUID): Customer {
  return {
    id,
    workspaceId: 'w1',
    name: 'Acme',
    domains: ['acme.test'],
    status: 'active',
    logoUrl: '',
    sortOrder: 'a0',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function favorite(id: UUID, kind: Favorite['kind'], targetId: UUID): Favorite {
  return {
    id,
    workspaceId: 'w1',
    userId: 'u1',
    kind,
    targetId,
    position: 'a0',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function template(id: UUID, over: Partial<IssueTemplate> = {}): IssueTemplate {
  return {
    id,
    workspaceId: 'w1',
    name: 'Bug report',
    title: 'Bug: ',
    body: 'Steps to reproduce',
    properties: {},
    subIssues: [],
    position: 'a0',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function askForm(id: UUID, over: Partial<AskForm> = {}): AskForm {
  return {
    id,
    workspaceId: 'w1',
    teamId: 't1',
    name: 'IT requests',
    description: '',
    token: 'deadbeef',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function recurring(id: UUID, over: Partial<RecurringIssue> = {}): RecurringIssue {
  return {
    id,
    workspaceId: 'w1',
    teamId: 't1',
    title: 'Weekly report',
    body: '',
    properties: {},
    cadence: 'weekly',
    nextDueDate: '2026-01-08',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: ACTOR, payload: entity } as Change;
}

function remove(v: number, type: Change['type'], id: UUID): Change {
  return { v, type, id, op: 'delete', actor: ACTOR };
}

/** A store with the shape of a small seeded workspace, backed by nothing. */
async function seeded(): Promise<Store> {
  const store = new Store('w1');
  const rows: EntityRow[] = [
    { type: 'workspace', entity: workspace() },
    { type: 'user', entity: user('u1', 'Ada') },
    { type: 'user', entity: user('u2', 'Grace') },
    { type: 'team', entity: team('t1', 'ENG') },
    { type: 'team', entity: team('t2', 'DES') },
    { type: 'teamMembership', entity: membership('m1', 't1', 'u1') },
    { type: 'teamMembership', entity: membership('m2', 't2', 'u1') },
    { type: 'workflowState', entity: state('s1', 't1', 'Todo') },
    { type: 'workflowState', entity: state('s2', 't2', 'Todo') },
    { type: 'issue', entity: issue('i1', { teamId: 't1', stateId: 's1', assigneeId: 'u1' }) },
    { type: 'issue', entity: issue('i2', { teamId: 't2', stateId: 's2', number: 1 }) },
    { type: 'comment', entity: comment('c1', 'i1') },
    { type: 'attachment', entity: attachment('a1', 'i1') },
    // Workspace labels, one team label, and the team-scoped entities that have to follow
    // their team out of the replica when access to it goes.
    { type: 'label', entity: label('bug') },
    { type: 'label', entity: label('regression') },
    { type: 'label', entity: label('eng-only', { teamId: 't1' }) },
    { type: 'issueTemplate', entity: template('tpl1', { teamId: 't1' }) },
    { type: 'askForm', entity: askForm('af1', { teamId: 't1' }) },
    { type: 'recurringIssue', entity: recurring('ri1', { teamId: 't1' }) },
    { type: 'view', entity: view('v1', { teamId: 't1' }) },
    { type: 'viewSubscription', entity: viewSubscription('vs1', 'v1', 'u1') },
    { type: 'viewPreference', entity: viewPreference('vp1', 'u1', 'my-issues') },
    { type: 'favorite', entity: favorite('f1', 'view', 'v1') },
    { type: 'issueSubscription', entity: subscription('sub1', 'i1', 'u1') },
    { type: 'notification', entity: notification('n1', { issueId: 'i1' }) },
  ];
  await store.beginBootstrap();
  store.ingestBootstrapPage(rows);
  await store.finishBootstrap(100);
  return store;
}

describe('sameResult', () => {
  it('compares query results structurally so an unchanged answer is not a re-render', () => {
    expect(sameResult(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameResult(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(
      sameResult(
        { ids: ['a'], groups: [{ key: null, ids: ['a'] }] },
        { ids: ['a'], groups: [{ key: null, ids: ['a'] }] },
      ),
    ).toBe(true);
    expect(sameResult({ ids: ['a'] }, { ids: ['a'], groups: [] })).toBe(false);
  });
});

describe('Store bootstrap', () => {
  it('round-trips through IndexedDB with identical state', async () => {
    const id = crypto.randomUUID();
    const db = await PolarisDB.open(id);
    const store = new Store(id, { db });

    await store.beginBootstrap();
    const issues = Array.from({ length: 200 }, (_, i) =>
      issue(`i${i}`, {
        number: i,
        title: `Issue ${i}`,
        sortOrder: `a${i}`,
        assigneeId: i % 2 === 0 ? 'u1' : undefined,
      }),
    );
    store.ingestBootstrapPage([
      { type: 'team', entity: team('t1', 'ENG') },
      { type: 'workflowState', entity: state('s1', 't1', 'Todo') },
    ]);
    store.ingestBootstrapPage(issues.map((entity) => ({ type: 'issue' as const, entity })));
    await store.finishBootstrap(77);
    const before = store.query({ sortBy: 'sortOrder' });
    await store.close();

    const reopened = await Store.open(id);
    expect(reopened.bootstrapped).toBe(true);
    expect(reopened.version).toBe(77);
    expect(reopened.issues.size).toBe(200);
    expect(reopened.query({ sortBy: 'sortOrder' })).toEqual(before);
    expect(reopened.get('issue', 'i7')).toEqual(issues[7]);
    await reopened.close();
    await dropDatabase(id);
  });

  it('treats a torn snapshot as no snapshot at all', async () => {
    const id = crypto.randomUUID();
    const db = await PolarisDB.open(id);
    const store = new Store(id, { db });
    await store.beginBootstrap();
    store.ingestBootstrapPage([{ type: 'issue', entity: issue('i1') }]);
    // The stream never terminated, so `finishBootstrap` is never reached.
    await store.whenPersisted();
    await store.close();

    const reopened = await Store.open(id);
    if (reopened.bootstrapped || reopened.issues.size !== 0) {
      throw new Error(
        'half a snapshot must hydrate as empty; rendering it shows a workspace with missing teams and is indistinguishable from data loss',
      );
    }
    await reopened.close();
    await dropDatabase(id);
  });
});

describe('Store.applyChanges', () => {
  it('inserts, updates and advances the version', async () => {
    const store = await seeded();
    store.applyChanges([
      upsert(101, 'issue', issue('i3', { teamId: 't1', stateId: 's1', title: 'New work' })),
      upsert(102, 'issue', issue('i1', { teamId: 't1', stateId: 's1', title: 'Renamed' })),
    ]);

    expect(store.version).toBe(102);
    expect(store.issues.size).toBe(3);
    expect(store.get('issue', 'i1')?.title).toBe('Renamed');
    expect([...store.index.search('renamed')]).toEqual(['i1']);
    // The point of this assertion is that a rename DROPS the old title's trigrams — a
    // stale posting would keep the issue matching a title it no longer has. It checks i1
    // specifically rather than an empty result, because the fixture gives i2 the same
    // default title and i2 legitimately still matches.
    expect(store.index.search('login').has('i1')).toBe(false);
    expect(store.index.search('login').has('i2')).toBe(true);
  });

  it('deletes an issue and its comments', async () => {
    const store = await seeded();
    store.applyChanges([{ v: 101, type: 'issue', id: 'i1', op: 'delete', actor: ACTOR }]);

    expect(store.get('issue', 'i1')).toBeUndefined();
    if (store.comments.size !== 0) {
      throw new Error(
        'a comment must not outlive the issue it hangs off; nothing can ever read it again',
      );
    }
    if (store.attachments.size !== 0) {
      throw new Error(
        'an attachment must not outlive the issue it hangs off; a dangling link has nowhere to open',
      );
    }
    expect(store.commentIdsFor('i1').size).toBe(0);
    expect(store.attachmentIdsFor('i1').size).toBe(0);
  });

  it('revokes an entity out of every index, leaving no readable copy', async () => {
    const store = await seeded();
    store.applyChanges([{ v: 101, type: 'issue', id: 'i1', op: 'revoke', actor: ACTOR }]);

    const residues: Array<[string, boolean]> = [
      ['entity map', store.issues.has('i1')],
      ['all', store.index.all().has('i1')],
      ['active', store.index.active().has('i1')],
      ['by team', store.index.byTeam('t1').has('i1')],
      ['by state', store.index.byState('s1').has('i1')],
      ['by assignee', store.index.byAssignee('u1').has('i1')],
      ['by priority', store.index.byPriority(0).has('i1')],
      ['title search', store.index.search('login').has('i1')],
      ['updated order', store.index.updatedOrder().includes('i1')],
      ['query result', store.query().ids.includes('i1')],
    ];
    for (const [where, present] of residues) {
      if (present) {
        throw new Error(
          `a revoked entity must leave no readable copy, and it is still in the ${where}; the user has lost access and any residue is a permanent leak`,
        );
      }
    }
  });

  it('makes revoke and delete indistinguishable in effect', async () => {
    const revoked = await seeded();
    const deleted = await seeded();
    revoked.applyChanges([{ v: 101, type: 'issue', id: 'i1', op: 'revoke', actor: ACTOR }]);
    deleted.applyChanges([{ v: 101, type: 'issue', id: 'i1', op: 'delete', actor: ACTOR }]);

    expect(revoked.query()).toEqual(deleted.query());
    expect([...revoked.issues.keys()]).toEqual([...deleted.issues.keys()]);
    expect([...revoked.comments.keys()]).toEqual([...deleted.comments.keys()]);
  });

  it("deletes a team's contents when the team itself is revoked", async () => {
    const store = await seeded();
    // The server emits one revoke for the team and none for its issues, because a team
    // can hold sixty thousand of them and enumerating those would stall every other
    // writer in the workspace behind the version lock.
    store.applyChanges([{ v: 101, type: 'team', id: 't1', op: 'revoke', actor: ACTOR }]);

    if (store.issues.has('i1') || store.comments.has('c1')) {
      throw new Error(
        "losing a team must remove the team's issues and their comments, or a removed member keeps a readable replica of everything the team was working on",
      );
    }
    expect(store.workflowStates.has('s1')).toBe(false);
    expect(store.teamMemberships.has('m1')).toBe(false);
    expect(store.index.byTeam('t1').size).toBe(0);

    // The other team is untouched.
    expect(store.issues.has('i2')).toBe(true);
    expect(store.workflowStates.has('s2')).toBe(true);
    expect(store.teamMemberships.has('m2')).toBe(true);
  });

  it('ignores an entity type this build does not know rather than stalling the stream', async () => {
    const store = await seeded();
    const unknown = { v: 101, type: 'project', id: 'p1', op: 'upsert', actor: ACTOR, payload: {} };
    store.applyChanges([unknown as unknown as Change, upsert(102, 'issue', issue('i9'))]);

    expect(store.version).toBe(102);
    if (!store.issues.has('i9')) {
      throw new Error(
        'an unknown entity type must not stop the rest of the batch; a newer server would otherwise wedge the whole delta stream',
      );
    }
  });

  it('keeps the recomputed identifier correct when a team key changes', async () => {
    const store = await seeded();
    const before = store.get('issue', 'i1');
    expect(before).toBeDefined();
    expect(store.identifierOf(before as Issue)).toBe('ENG-1');

    store.applyChanges([upsert(101, 'team', { ...team('t1', 'PLAT') })]);
    if (store.identifierOf(before as Issue) !== 'PLAT-1') {
      throw new Error(
        'the identifier is derived from a mutable team key; a cached one keeps showing the old key until the next bootstrap',
      );
    }
  });
});

describe('Store subscriptions', () => {
  it('fires once for a batch of fifty changes, not fifty times', async () => {
    const store = await seeded();
    let calls = 0;
    store.subscribe({
      select: (s) => s.query({ filter: { teamIds: ['t1'] } }).ids,
      onChange: () => {
        calls += 1;
      },
      deps: ['issue'],
    });

    const batch: Change[] = Array.from({ length: 50 }, (_, i) =>
      upsert(200 + i, 'issue', issue(`b${i}`, { teamId: 't1', sortOrder: `b${i}` })),
    );
    store.applyChanges(batch);

    if (calls !== 1) {
      throw new Error(
        `a batch is one render: fifty changes in one frame must notify once, not ${calls} times`,
      );
    }
    expect(store.query({ filter: { teamIds: ['t1'] } }).ids).toHaveLength(51);
  });

  it('does not fire for a change its query result does not depend on', async () => {
    const store = await seeded();
    let calls = 0;
    store.subscribe({
      select: (s) => s.query({ filter: { teamIds: ['t1'] } }).ids,
      onChange: () => {
        calls += 1;
      },
      deps: ['issue'],
    });

    // A different team: same entity type, so `deps` lets it through and only the result
    // comparison can decide.
    store.applyChanges([upsert(101, 'issue', issue('other', { teamId: 't2', stateId: 's2' }))]);
    if (calls !== 0) {
      throw new Error(
        'a view must re-render when its answer changes, not when the store changes; an issue in another team is not this list',
      );
    }

    store.applyChanges([upsert(102, 'issue', issue('mine', { teamId: 't1', sortOrder: 'z' }))]);
    expect(calls).toBe(1);
  });

  it('skips a subscriber whose declared dependencies the batch never touched', async () => {
    const store = await seeded();
    let selections = 0;
    store.subscribe({
      select: (s) => {
        selections += 1;
        return s.query().ids;
      },
      onChange: () => undefined,
      deps: ['issue'],
    });
    const afterSubscribe = selections;

    store.applyChanges([upsert(101, 'user', user('u3', 'Alan'))]);
    if (selections !== afterSubscribe) {
      throw new Error(
        'a batch of users must not re-run an issue list selector; the dependency gate is what keeps a busy workspace from re-querying every open view',
      );
    }
  });

  it('stops calling a subscriber after it unsubscribes, even mid-batch', async () => {
    const store = await seeded();
    let calls = 0;
    const off = store.subscribe({
      select: (s) => s.query().ids,
      onChange: () => {
        calls += 1;
        off();
      },
    });

    store.applyChanges([upsert(101, 'issue', issue('a', { sortOrder: 'a1' }))]);
    store.applyChanges([upsert(102, 'issue', issue('b', { sortOrder: 'a2' }))]);
    expect(calls).toBe(1);
  });
});

describe('Store optimistic writes', () => {
  it('applies and reverts a rejected patch', async () => {
    const store = await seeded();
    const before = store.get('issue', 'i1');
    expect(before).toBeDefined();
    const after: Issue = { ...(before as Issue), priority: 1, updatedAt: '2026-02-01T00:00:00Z' };
    const patch: EntityPatch[] = [{ type: 'issue', id: 'i1', before: before as Issue, after }];

    store.applyOptimistic(patch);
    expect(store.get('issue', 'i1')?.priority).toBe(1);
    expect([...store.index.byPriority(1)]).toEqual(['i1']);

    store.revertOptimistic(patch);
    expect(store.get('issue', 'i1')).toEqual(before);
    expect(store.index.byPriority(1).size).toBe(0);
  });

  it('removes an optimistically created entity when the create is rejected', async () => {
    const store = await seeded();
    const created = issue('draft', { teamId: 't1', title: 'Optimistic' });
    const patch: EntityPatch[] = [{ type: 'issue', id: 'draft', before: null, after: created }];

    store.applyOptimistic(patch);
    expect(store.issues.has('draft')).toBe(true);
    store.revertOptimistic(patch);
    expect(store.issues.has('draft')).toBe(false);
  });

  it('leaves an entity alone if the server has already moved it on', async () => {
    const store = await seeded();
    const before = store.get('issue', 'i1') as Issue;
    const after: Issue = { ...before, priority: 1 };
    const patch: EntityPatch[] = [{ type: 'issue', id: 'i1', before, after }];
    store.applyOptimistic(patch);

    // A teammate's change lands before the rejection does.
    const server: Issue = { ...before, priority: 4, updatedAt: '2026-03-01T00:00:00Z' };
    store.applyChanges([upsert(101, 'issue', server)]);
    store.revertOptimistic(patch);

    if (store.get('issue', 'i1')?.priority !== 4) {
      throw new Error(
        "a rollback must not resurrect a value the server has already superseded; the user would watch a teammate's change disappear",
      );
    }
  });

  it('does not advance the resume version for an unconfirmed write', async () => {
    const store = await seeded();
    const before = store.get('issue', 'i1') as Issue;
    store.applyOptimistic([{ type: 'issue', id: 'i1', before, after: { ...before, priority: 2 } }]);
    if (store.version !== 100) {
      throw new Error(
        'an optimistic write has no workspace version; claiming one makes the client resume from a point the server has never heard of',
      );
    }
  });
});

describe('Store labels', () => {
  it('keeps both labels when two clients add one each in separate frames', async () => {
    const store = await seeded();

    // M1 acceptance test 1, at the store layer. Two people label the same issue a moment
    // apart, so their mutations arrive as two independent delta frames. This is the whole
    // reason an application is a row: a client that held labels as an array on the issue
    // would apply the second frame's whole set over the first's, and one of the two would
    // watch their label disappear with nothing to blame.
    store.applyChanges([upsert(101, 'issueLabel', issueLabel('il-a', 'i1', 'bug'))]);
    store.applyChanges([upsert(102, 'issueLabel', issueLabel('il-b', 'i1', 'regression'))]);

    const labels = [...store.labelIdsFor('i1')].sort();
    if (labels.length !== 2) {
      throw new Error(
        `both labels must survive two independent frames; the issue ended up with ${JSON.stringify(labels)}`,
      );
    }
    expect(labels).toEqual(['bug', 'regression']);
    expect([...store.issueIdsWithLabel('bug')]).toEqual(['i1']);
    expect([...store.issueIdsWithLabel('regression')]).toEqual(['i1']);
    expect(store.issueLabelIdsFor('i1').size).toBe(2);
  });

  it('removes only the application the delete names', async () => {
    const store = await seeded();
    store.applyChanges([
      upsert(101, 'issueLabel', issueLabel('il-a', 'i1', 'bug')),
      upsert(102, 'issueLabel', issueLabel('il-b', 'i1', 'regression')),
    ]);
    store.applyChanges([remove(103, 'issueLabel', 'il-a')]);

    expect([...store.labelIdsFor('i1')]).toEqual(['regression']);
    expect(store.issueIdsWithLabel('bug').size).toBe(0);
  });

  it('filters by label out of the index', async () => {
    const store = await seeded();
    store.applyChanges([
      upsert(101, 'issueLabel', issueLabel('il-a', 'i1', 'bug')),
      upsert(102, 'issueLabel', issueLabel('il-b', 'i2', 'regression', { teamId: 't2' })),
    ]);

    expect(store.query({ filter: { labelIds: ['bug'] } }).ids).toEqual(['i1']);
    expect([...store.query({ filter: { labelIds: ['bug', 'regression'] } }).ids].sort()).toEqual([
      'i1',
      'i2',
    ]);
    // An empty array is "no constraint", not "match nothing" — a user who has just
    // cleared the last chip expects their issues back.
    expect(store.query({ filter: { labelIds: [] } }).ids).toHaveLength(2);
  });

  it('takes an issue’s applications with the issue', async () => {
    const store = await seeded();
    store.applyChanges([upsert(101, 'issueLabel', issueLabel('il-a', 'i1', 'bug'))]);
    store.applyChanges([{ v: 102, type: 'issue', id: 'i1', op: 'revoke', actor: ACTOR }]);

    if (store.issueLabels.has('il-a')) {
      throw new Error(
        'an application must not outlive its issue; nothing can read it, and it keeps the issue in a label filter that can never be opened',
      );
    }
    expect(store.issueIdsWithLabel('bug').size).toBe(0);
    expect(store.labelIdsFor('i1').size).toBe(0);
  });

  it('takes the applications with a deleted label', async () => {
    const store = await seeded();
    store.applyChanges([upsert(101, 'issueLabel', issueLabel('il-a', 'i1', 'bug'))]);
    store.applyChanges([remove(102, 'label', 'bug')]);

    expect(store.issueLabels.has('il-a')).toBe(false);
    expect(store.labelIdsFor('i1').size).toBe(0);
  });
});

describe('Store sub-issues', () => {
  it('rolls a parent’s progress up from its children', async () => {
    const store = await seeded();
    store.applyChanges([
      upsert(101, 'workflowState', { ...state('s-done', 't1', 'Done'), category: 'completed' }),
      upsert(102, 'workflowState', { ...state('s-cut', 't1', 'Cancelled'), category: 'canceled' }),
      upsert(103, 'issue', issue('c1', { parentId: 'i1', stateId: 's-done', number: 10 })),
      upsert(104, 'issue', issue('c2', { parentId: 'i1', stateId: 's1', number: 11 })),
      upsert(105, 'issue', issue('c3', { parentId: 'i1', stateId: 's-cut', number: 12 })),
    ]);

    expect([...store.childIssueIdsFor('i1')].sort()).toEqual(['c1', 'c2', 'c3']);
    // The cancelled child leaves the total rather than counting as outstanding: a parent
    // stuck at "1 of 3" because of work the team dropped reads as unfinished forever.
    expect(subIssueProgress(store, 'i1')).toEqual({ total: 2, completed: 1 });
  });

  it('moves a re-parented issue between rollups', async () => {
    const store = await seeded();
    store.applyChanges([upsert(101, 'issue', issue('c1', { parentId: 'i1', number: 10 }))]);
    store.applyChanges([upsert(102, 'issue', issue('c1', { parentId: 'i2', number: 10 }))]);

    expect(store.childIssueIdsFor('i1').size).toBe(0);
    expect([...store.childIssueIdsFor('i2')]).toEqual(['c1']);
  });

  it('leaves a sub-issue standing when its parent is revoked', async () => {
    const store = await seeded();
    store.applyChanges([upsert(101, 'issue', issue('c1', { parentId: 'i1', number: 10 }))]);
    store.applyChanges([{ v: 102, type: 'issue', id: 'i1', op: 'revoke', actor: ACTOR }]);

    if (!store.issues.has('c1')) {
      throw new Error(
        'a sub-issue may live in a team the user still belongs to; deleting it with its parent removes work nobody has lost access to',
      );
    }
    expect(store.query({ filter: { parentIds: [null] } }).ids).not.toContain('c1');
  });
});

describe('Store relations', () => {
  it('reads one row from both ends, because blocked-by is not a second row', async () => {
    const store = await seeded();
    store.applyChanges([upsert(101, 'issueRelation', relation('r1', 'i1', 'i2'))]);

    expect([...store.relationIdsFrom('i1')]).toEqual(['r1']);
    expect([...store.relationIdsTo('i2')]).toEqual(['r1']);
    expect(store.relationIdsFrom('i2').size).toBe(0);
  });

  it('clears relations in both directions when an issue goes', async () => {
    const store = await seeded();
    store.applyChanges([
      upsert(101, 'issueRelation', relation('r1', 'i1', 'i2')),
      upsert(102, 'issueRelation', relation('r2', 'i2', 'i1')),
    ]);
    store.applyChanges([{ v: 103, type: 'issue', id: 'i1', op: 'delete', actor: ACTOR }]);

    if (store.issueRelations.size !== 0) {
      throw new Error(
        'a relation pointing at a deleted issue shows a blocker that cannot be opened or cleared from either side',
      );
    }
    expect(store.relationIdsTo('i2').size).toBe(0);
    expect(store.relationIdsFrom('i2').size).toBe(0);
  });
});

describe('Store notifications and subscriptions', () => {
  it('counts unread rows and clears the badge when one is read', async () => {
    const store = await seeded();
    expect([...store.unreadNotificationIds()]).toEqual(['n1']);

    const read = { ...(store.get('notification', 'n1') as Notification), readAt: NOW };
    store.applyChanges([upsert(101, 'notification', read)]);

    if (store.unreadNotificationIds().has('n1')) {
      throw new Error('a read notification left in the unread set is a badge that never clears');
    }
  });

  it('takes an unsubscribed person out of the subscribers without dropping the row', async () => {
    const store = await seeded();
    expect([...store.subscriberIdsFor('i1')]).toEqual(['u1']);

    const row = store.get('issueSubscription', 'sub1') as IssueSubscription;
    store.applyChanges([upsert(101, 'issueSubscription', { ...row, unsubscribed: true })]);

    if (store.subscriberIdsFor('i1').has('u1')) {
      throw new Error('an explicit unsubscribe must stop the notifications it was asked to stop');
    }
    if (!store.issueSubscriptions.has('sub1')) {
      throw new Error(
        'the row has to survive the unsubscribe: deleting it lets the next comment re-subscribe the person who just opted out',
      );
    }
    expect(store.subscribersByIssue().get('i1')).toBeUndefined();

    store.applyChanges([upsert(102, 'issueSubscription', { ...row, unsubscribed: false })]);
    expect([...store.subscriberIdsFor('i1')]).toEqual(['u1']);
  });

  it('drops the inbox rows and subscriptions of an issue that goes away', async () => {
    const store = await seeded();
    expect([...store.notificationIdsFor('i1')]).toEqual(['n1']);
    expect([...store.subscriptionIdsForIssue('i1')]).toEqual(['sub1']);

    store.applyChanges([{ v: 101, type: 'issue', id: 'i1', op: 'revoke', actor: ACTOR }]);

    expect(store.notifications.size).toBe(0);
    expect(store.unreadNotificationIds().size).toBe(0);
    expect(store.issueSubscriptions.size).toBe(0);
    expect(store.subscriptionIdsForUser('u1').size).toBe(0);
  });
});

describe('Store views, templates and favourites', () => {
  it("drops a team's labels, templates, schedules and views with the team", async () => {
    const store = await seeded();
    store.applyChanges([{ v: 101, type: 'team', id: 't1', op: 'revoke', actor: ACTOR }]);

    for (const [what, present] of [
      ['team label', store.labels.has('eng-only')],
      ['template', store.issueTemplates.has('tpl1')],
      ['ask form', store.askForms.has('af1')],
      ['recurring', store.recurringIssues.has('ri1')],
      ['view', store.views.has('v1')],
      ['view subscription', store.viewSubscriptions.has('vs1')],
    ] as const) {
      if (present) {
        throw new Error(
          `a ${what} carries the team's scope, so losing the team means losing the right to read it; the server does not enumerate them in the revoke and the client must`,
        );
      }
    }
    // Workspace-scoped labels belong to nobody's team and stay.
    expect(store.labels.has('bug')).toBe(true);
    expect(store.labelIdsForTeam('t1').size).toBe(0);
  });

  it('drops a favourite whose target has gone', async () => {
    const store = await seeded();
    expect([...store.favoriteIdsForTarget('v1')]).toEqual(['f1']);

    store.applyChanges([remove(101, 'view', 'v1')]);
    if (store.favorites.has('f1')) {
      throw new Error(
        'a favourite pointing at something the replica no longer holds is a sidebar row that cannot be opened, renamed or removed',
      );
    }
    if (store.viewSubscriptions.has('vs1')) {
      throw new Error(
        'a watch on a view this replica no longer holds would keep notifying nobody who can open it',
      );
    }
  });

  it('finds a view subscription by user and view together', async () => {
    const store = await seeded();
    expect(store.viewSubscriptionIdFor('u1', 'v1')).toBe('vs1');
    store.applyChanges([upsert(101, 'viewSubscription', viewSubscription('vs2', 'v1', 'u2'))]);
    expect(store.viewSubscriptionIdFor('u1', 'v1')).toBe('vs1');
    expect(store.viewSubscriptionIdFor('u2', 'v1')).toBe('vs2');
  });

  it('finds a view preference by user and key together', async () => {
    const store = await seeded();
    expect(store.viewPreferenceIdFor('u1', 'my-issues')).toBe('vp1');
    // Another person's preference for the same view must not be served to this one.
    store.applyChanges([upsert(101, 'viewPreference', viewPreference('vp2', 'u2', 'my-issues'))]);
    expect(store.viewPreferenceIdFor('u1', 'my-issues')).toBe('vp1');
    expect(store.viewPreferenceIdFor('u2', 'my-issues')).toBe('vp2');
  });

  it('follows a view preference that is repointed at another key', async () => {
    const store = await seeded();
    store.applyChanges([upsert(101, 'viewPreference', viewPreference('vp1', 'u1', 'inbox'))]);

    expect(store.viewPreferenceIdFor('u1', 'my-issues')).toBeUndefined();
    expect(store.viewPreferenceIdFor('u1', 'inbox')).toBe('vp1');
  });

  it('files team-scoped and workspace-scoped entities apart', async () => {
    const store = await seeded();
    expect([...store.labelIdsForTeam('t1')]).toEqual(['eng-only']);
    expect([...store.issueTemplateIdsForTeam('t1')]).toEqual(['tpl1']);
    expect([...store.recurringIssueIdsFor('t1')]).toEqual(['ri1']);
    expect([...store.viewIdsForTeam('t1')]).toEqual(['v1']);
    // A workspace label is offered in every team and therefore sits in no team's bucket.
    expect(store.labelIdsForTeam('t2').size).toBe(0);
  });
});

describe('Store hydration of the M1 entities', () => {
  it('rebuilds every index from IndexedDB', async () => {
    const id = crypto.randomUUID();
    const db = await PolarisDB.open(id);
    const store = new Store(id, { db });

    await store.beginBootstrap();
    store.ingestBootstrapPage([
      { type: 'team', entity: team('t1', 'ENG') },
      { type: 'workflowState', entity: state('s1', 't1', 'Todo') },
      { type: 'label', entity: label('bug') },
      { type: 'issue', entity: issue('i1') },
      { type: 'issue', entity: issue('i2', { number: 2 }) },
      { type: 'issue', entity: issue('c1', { number: 3, parentId: 'i1' }) },
      { type: 'issueLabel', entity: issueLabel('il1', 'i1', 'bug') },
      { type: 'issueRelation', entity: relation('r1', 'i1', 'i2') },
      { type: 'issueSubscription', entity: subscription('sub1', 'i1', 'u1') },
      { type: 'notification', entity: notification('n1', { issueId: 'i1' }) },
      { type: 'view', entity: view('v1', { teamId: 't1' }) },
      { type: 'viewPreference', entity: viewPreference('vp1', 'u1', 'my-issues') },
      { type: 'favorite', entity: favorite('f1', 'view', 'v1') },
      { type: 'issueTemplate', entity: template('tpl1', { teamId: 't1' }) },
    ]);
    await store.finishBootstrap(9);
    await store.close();

    // The indexes are maintained on the delta path and rebuilt on the hydration path. An
    // index correct all day and empty after a reload is the failure this asserts against.
    const reopened = await Store.open(id);
    expect(reopened.version).toBe(9);
    expect([...reopened.labelIdsFor('i1')]).toEqual(['bug']);
    expect([...reopened.issueIdsWithLabel('bug')]).toEqual(['i1']);
    expect([...reopened.childIssueIdsFor('i1')]).toEqual(['c1']);
    expect([...reopened.relationIdsFrom('i1')]).toEqual(['r1']);
    expect([...reopened.relationIdsTo('i2')]).toEqual(['r1']);
    expect([...reopened.subscriptionIdsForIssue('i1')]).toEqual(['sub1']);
    expect([...reopened.unreadNotificationIds()]).toEqual(['n1']);
    expect([...reopened.notificationIdsFor('i1')]).toEqual(['n1']);
    expect([...reopened.viewIdsForTeam('t1')]).toEqual(['v1']);
    expect([...reopened.issueTemplateIdsForTeam('t1')]).toEqual(['tpl1']);
    expect([...reopened.favoriteIdsForTarget('v1')]).toEqual(['f1']);
    expect(reopened.viewPreferenceIdFor('u1', 'my-issues')).toBe('vp1');

    await reopened.close();
    await dropDatabase(id);
  });
});

describe('Store entity subscriptions', () => {
  it('finds a watch by user and target together', () => {
    const store = new Store('w1');
    store.applyChanges([
      upsert(1, 'project', projectRow('p1')),
      upsert(2, 'initiative', initiativeRow('in1')),
      upsert(3, 'customer', customerRow('cu1')),
      upsert(4, 'projectSubscription', projectSubscription('ps1', 'p1', 'u1')),
      upsert(5, 'initiativeSubscription', initiativeSubscription('is1', 'in1', 'u1')),
      upsert(6, 'customerSubscription', customerSubscription('cs1', 'cu1', 'u1')),
    ]);
    expect(store.projectSubscriptionIdFor('u1', 'p1')).toBe('ps1');
    expect(store.initiativeSubscriptionIdFor('u1', 'in1')).toBe('is1');
    expect(store.customerSubscriptionIdFor('u1', 'cu1')).toBe('cs1');
    expect(store.projectSubscriptionIdFor('u2', 'p1')).toBeUndefined();
  });

  it('drops a watch when its target leaves the replica', () => {
    const store = new Store('w1');
    store.applyChanges([
      upsert(1, 'project', projectRow('p1')),
      upsert(2, 'initiative', initiativeRow('in1')),
      upsert(3, 'customer', customerRow('cu1')),
      upsert(4, 'projectSubscription', projectSubscription('ps1', 'p1', 'u1')),
      upsert(5, 'initiativeSubscription', initiativeSubscription('is1', 'in1', 'u1')),
      upsert(6, 'customerSubscription', customerSubscription('cs1', 'cu1', 'u1')),
    ]);
    store.applyChanges([remove(7, 'project', 'p1')]);
    if (store.projectSubscriptions.has('ps1')) {
      throw new Error(
        'a watch on a project this replica no longer holds would keep notifying nobody who can open it',
      );
    }
    store.applyChanges([remove(8, 'initiative', 'in1')]);
    if (store.initiativeSubscriptions.has('is1')) {
      throw new Error(
        'a watch on an initiative this replica no longer holds would keep notifying nobody who can open it',
      );
    }
    store.applyChanges([remove(9, 'customer', 'cu1')]);
    if (store.customerSubscriptions.has('cs1')) {
      throw new Error(
        'a watch on a customer this replica no longer holds would keep notifying nobody who can open it',
      );
    }
  });
});
