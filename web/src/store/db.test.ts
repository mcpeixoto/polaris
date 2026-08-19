import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import {
  CLIENT_SCHEMA,
  databaseName,
  dropDatabase,
  PolarisDB,
  type EntityRow,
  type Meta,
} from './db';
import { ENTITY_TYPES } from './types';
import type {
  Attachment,
  Comment,
  Favorite,
  Issue,
  IssueLabel,
  IssueRelation,
  IssueSubscription,
  IssueTemplate,
  Label,
  Notification,
  Team,
  UUID,
  View,
  ViewPreference,
  Workspace,
} from './types';

const NOW = '2026-01-01T00:00:00Z';

function workspaceId(): UUID {
  return crypto.randomUUID();
}

function team(id: UUID, key: string): Team {
  return {
    id,
    workspaceId: 'w',
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

function issue(id: UUID, over: Partial<Issue> = {}): Issue {
  return {
    id,
    workspaceId: 'w',
    teamId: 't1',
    number: 1,
    identifier: 'ENG-1',
    title: 'Something to do',
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
    workspaceId: 'w',
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
    workspaceId: 'w',
    issueId,
    teamId: 't1',
    url: 'https://github.com/acme/app/pull/1',
    title: 'PR 1',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function complete(version: number): Meta {
  return { version, bootstrapAt: NOW, clientSchema: CLIENT_SCHEMA };
}

/**
 * One row of every replicated type.
 *
 * Built from a literal per type rather than a loop over `ENTITY_TYPES`, because the point
 * is to write a real row into every object store: a type present in `ENTITY_TYPES` but
 * missing from the schema throws `NotFoundError` on the write, which is exactly the
 * failure this is here to catch before a bootstrap hits it on a user's machine.
 */
function oneOfEach(): EntityRow[] {
  const workspace: Workspace = blankWorkspace();
  const user = {
    id: 'u1',
    workspaceId: 'w',
    name: 'Ada',
    displayName: 'Ada',
    timezone: 'UTC',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: NOW,
    updatedAt: NOW,
  } as const;
  const label: Label = {
    id: 'l1',
    workspaceId: 'w',
    isGroup: false,
    name: 'bug',
    color: '#cc4444',
    position: 'a0',
    createdAt: NOW,
    updatedAt: NOW,
  };
  const issueTemplate: IssueTemplate = {
    id: 'tpl1',
    workspaceId: 'w',
    name: 'Bug report',
    title: 'Bug: ',
    body: '',
    properties: {},
    position: 'a0',
    createdAt: NOW,
    updatedAt: NOW,
  };
  const issueLabel: IssueLabel = {
    id: 'il1',
    workspaceId: 'w',
    issueId: 'i1',
    labelId: 'l1',
    teamId: 't1',
    createdAt: NOW,
  };
  const issueRelation: IssueRelation = {
    id: 'r1',
    workspaceId: 'w',
    issueId: 'i1',
    relatedIssueId: 'i2',
    type: 'blocks',
    teamId: 't1',
    relatedTeamId: 't1',
    createdAt: NOW,
  };
  const issueSubscription: IssueSubscription = {
    id: 'sub1',
    workspaceId: 'w',
    issueId: 'i1',
    userId: 'u1',
    reason: 'created',
    unsubscribed: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const notification: Notification = {
    id: 'n1',
    workspaceId: 'w',
    userId: 'u1',
    type: 'issue_assigned',
    issueId: 'i1',
    actor: { type: 'user', id: 'u2' },
    changeVersion: 1,
    groupKey: 'assign:i1',
    count: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
  // Opaque to this layer: the replica stores the filter AST and the display options and
  // hands them back untouched, so their shape is the filter module's business.
  const view: View = {
    id: 'v1',
    workspaceId: 'w',
    name: 'Urgent',
    filter: {} as View['filter'],
    display: {} as View['display'],
    position: 'a0',
    createdAt: NOW,
    updatedAt: NOW,
  };
  const viewPreference: ViewPreference = {
    id: 'vp1',
    workspaceId: 'w',
    userId: 'u1',
    viewKey: 'my-issues',
    display: {} as ViewPreference['display'],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const favorite: Favorite = {
    id: 'f1',
    workspaceId: 'w',
    userId: 'u1',
    kind: 'view',
    targetId: 'v1',
    position: 'a0',
    createdAt: NOW,
    updatedAt: NOW,
  };

  return [
    { type: 'workspace', entity: workspace },
    { type: 'user', entity: user },
    { type: 'team', entity: team('t1', 'ENG') },
    {
      type: 'teamMembership',
      entity: {
        id: 'm1',
        workspaceId: 'w',
        teamId: 't1',
        userId: 'u1',
        role: 'member',
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    {
      type: 'workflowState',
      entity: {
        id: 's1',
        workspaceId: 'w',
        teamId: 't1',
        name: 'Todo',
        color: '#888888',
        category: 'unstarted',
        position: 'a0',
        isDefault: true,
        isSystem: false,
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    { type: 'label', entity: label },
    { type: 'issueTemplate', entity: issueTemplate },
    {
      type: 'projectStatus',
      entity: {
        id: 'ps1',
        workspaceId: 'w',
        name: 'Backlog',
        color: '#bec2c8',
        category: 'backlog',
        position: 'a0',
        isDefault: true,
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    {
      type: 'project',
      entity: {
        id: 'p1',
        workspaceId: 'w',
        name: 'Shipping',
        description: '',
        color: '#5e6ad2',
        statusId: 'ps1',
        priority: 0,
        sortOrder: 'a0',
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    {
      type: 'projectTeam',
      entity: {
        id: 'pt1',
        workspaceId: 'w',
        projectId: 'p1',
        teamId: 't1',
        createdAt: NOW,
      },
    },
    {
      type: 'projectMember',
      entity: {
        id: 'pm1',
        workspaceId: 'w',
        projectId: 'p1',
        userId: 'u1',
        createdAt: NOW,
      },
    },
    {
      type: 'projectMilestone',
      entity: {
        id: 'pms1',
        workspaceId: 'w',
        projectId: 'p1',
        name: 'Beta',
        sortOrder: 'a0',
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    {
      type: 'cycle',
      entity: {
        id: 'cy1',
        workspaceId: 'w',
        teamId: 't1',
        number: 1,
        name: 'Cycle 1',
        startsAt: NOW,
        endsAt: '2026-01-15T00:01:00Z',
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    { type: 'issue', entity: issue('i1') },
    { type: 'issueLabel', entity: issueLabel },
    { type: 'issueRelation', entity: issueRelation },
    { type: 'attachment', entity: attachment('a1', 'i1') },
    { type: 'comment', entity: comment('c1', 'i1') },
    { type: 'issueSubscription', entity: issueSubscription },
    { type: 'notification', entity: notification },
    { type: 'view', entity: view },
    { type: 'viewPreference', entity: viewPreference },
    { type: 'favorite', entity: favorite },
  ];
}

describe('databaseName', () => {
  it('puts the schema version in the name so an upgrade is a delete, not a migration', () => {
    expect(databaseName('abc', 4)).toBe('polaris/abc/v4');
    expect(databaseName('abc')).toBe(`polaris/abc/v${CLIENT_SCHEMA}`);
  });
});

describe('PolarisDB', () => {
  it('round-trips a bootstrap through a reload', async () => {
    const id = workspaceId();
    const db = await PolarisDB.open(id);

    const issues = Array.from({ length: 500 }, (_, i) =>
      issue(`i${i}`, { number: i, title: `Issue ${i}`, sortOrder: `a${i}` }),
    );
    await db.write({
      puts: [
        { type: 'team', entity: team('t1', 'ENG') },
        ...issues.map((entity) => ({ type: 'issue' as const, entity })),
        { type: 'comment', entity: comment('c1', 'i0') },
      ],
      meta: complete(42),
    });
    db.close();

    const reopened = await PolarisDB.open(id);
    const snapshot = await reopened.readAll();
    expect(snapshot.meta).toEqual(complete(42));
    expect(snapshot.team).toHaveLength(1);
    expect(snapshot.comment).toHaveLength(1);
    expect(snapshot.issue).toHaveLength(500);
    // Sorted because IndexedDB returns key order, not insertion order.
    expect([...snapshot.issue].sort((a, b) => a.number - b.number)).toEqual(
      [...issues].sort((a, b) => a.number - b.number),
    );
    reopened.close();
    await dropDatabase(id);
  });

  it('gives every replicated entity type an object store of its own', async () => {
    const id = workspaceId();
    const db = await PolarisDB.open(id);

    const rows = oneOfEach();
    // A type on the wire with nowhere to put it is not a degraded replica, it is a
    // rejected transaction that aborts the whole bootstrap page it arrived in.
    expect(rows.map((row) => row.type).sort()).toEqual([...ENTITY_TYPES].sort());

    await db.write({ puts: rows, meta: complete(11) });
    const snapshot = await db.readAll();
    for (const type of ENTITY_TYPES) {
      expect(snapshot[type], `${type} did not survive the round trip`).toHaveLength(1);
    }

    await db.write({ deletes: rows.map((row) => ({ type: row.type, id: row.entity.id })) });
    const emptied = await db.readAll();
    for (const type of ENTITY_TYPES) {
      expect(emptied[type], `${type} was not deleted`).toHaveLength(0);
    }

    db.close();
    await dropDatabase(id);
  });

  it('applies puts, deletes and the version in one batch', async () => {
    const id = workspaceId();
    const db = await PolarisDB.open(id);

    await db.write({ puts: [{ type: 'issue', entity: issue('i1') }], meta: complete(1) });
    await db.write({
      puts: [{ type: 'issue', entity: issue('i2') }],
      deletes: [{ type: 'issue', id: 'i1' }],
      meta: complete(2),
    });

    const snapshot = await db.readAll();
    expect(snapshot.issue.map((row) => row.id)).toEqual(['i2']);
    if (snapshot.meta?.version !== 2) {
      throw new Error(
        'the version must advance in the same transaction as the rows it describes, or a resume asks for changes the replica never stored',
      );
    }
    db.close();
    await dropDatabase(id);
  });

  it('discards a replica that claims a different client schema', async () => {
    const id = workspaceId();
    const stale = await PolarisDB.open(id);
    await stale.write({
      puts: [{ type: 'issue', entity: issue('i1') }],
      meta: { version: 9, bootstrapAt: NOW, clientSchema: CLIENT_SCHEMA + 1 },
    });
    stale.close();

    const reopened = await PolarisDB.open(id);
    const snapshot = await reopened.readAll();
    if (snapshot.issue.length !== 0 || snapshot.meta !== null) {
      throw new Error(
        'a replica shaped for another client schema must be thrown away, not rendered — the whole point of the version is that mixing shapes is never attempted',
      );
    }
    reopened.close();
    await dropDatabase(id);
  });

  it('clears entities without touching the outbox', async () => {
    const id = workspaceId();
    const db = await PolarisDB.open(id);
    await db.write({ puts: [{ type: 'issue', entity: issue('i1') }], meta: complete(3) });
    await db.putOutbox({
      opId: '0195c3e0-0000-7000-8000-000000000000',
      mutation: 'updateIssue',
      variables: { id: 'i1' },
      optimisticPatch: [],
      attempts: 0,
      createdAt: NOW,
    });

    await db.clearEntities();

    const snapshot = await db.readAll();
    expect(snapshot.issue).toHaveLength(0);
    expect(snapshot.meta).toBeNull();
    if ((await db.readOutbox()).length !== 1) {
      throw new Error(
        'a re-bootstrap is a statement about the server, not about unsent work — dropping the outbox would lose edits the user watched succeed',
      );
    }
    db.close();
    await dropDatabase(id);
  });

  it('drops the database outright, leaving no readable residue', async () => {
    const id = workspaceId();
    const db = await PolarisDB.open(id);
    await db.write({
      puts: [{ type: 'workspace', entity: { ...blankWorkspace(), id: 'w1' } }],
      meta: complete(7),
    });
    await db.destroy();

    const fresh = await PolarisDB.open(id);
    const snapshot = await fresh.readAll();
    expect(snapshot.workspace).toHaveLength(0);
    expect(snapshot.meta).toBeNull();
    fresh.close();
    await dropDatabase(id);
  });

  it('refuses to write through a closed handle rather than failing opaquely', async () => {
    const id = workspaceId();
    const db = await PolarisDB.open(id);
    db.close();
    await expect(db.write({ puts: [{ type: 'issue', entity: issue('i1') }] })).rejects.toThrow(
      /is closed; reopen it/,
    );
    await dropDatabase(id);
  });
});

function blankWorkspace(): Workspace {
  return {
    id: 'w1',
    name: 'Polaris',
    urlKey: 'polaris',
    plan: 'free',
    createdAt: NOW,
    updatedAt: NOW,
  };
}
