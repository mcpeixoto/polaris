import { describe, expect, it } from 'vitest';

import { Store, type Change, type Entity, type Project, type UUID } from '~/store';

import { listPulse, PULSE_LIMIT } from './pulse';

const NOW = '2026-08-20T12:00:00.000Z';
const EARLIER = '2026-08-20T11:00:00.000Z';
const CREATED = '2026-08-19T09:00:00.000Z';
const ZONE = 'UTC';
const ACTOR = { type: 'user' as const, id: 'u1' };

function upsert(v: number, entity: Entity, type: Change['type']): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: ACTOR, payload: entity };
}

function storeWith(rows: readonly Change[]): Store {
  const store = new Store('w1');
  store.applyChanges([...rows]);
  return store;
}

function workspace(): Entity {
  return {
    id: 'w1',
    name: 'Acme',
    urlKey: 'acme',
    plan: 'free',
    projectUpdateReminderIntervalDays: 7,
    projectUpdateReminderWeekday: 3,
    projectUpdateReminderHour: 9,
    pulseEnabled: true,
    pulseDigestCadence: 'daily',
    createdAt: CREATED,
    updatedAt: CREATED,
  };
}

function user(id: UUID, displayName: string): Entity {
  return {
    id,
    workspaceId: 'w1',
    name: displayName,
    displayName,
    timezone: 'UTC',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: CREATED,
    updatedAt: CREATED,
  };
}

function project(over: Partial<Project> & Pick<Project, 'id'>): Project {
  return {
    workspaceId: 'w1',
    name: 'Polaris',
    description: '',
    color: '#000',
    statusId: 'st1',
    priority: 0,
    sortOrder: 'a0',
    updateSchedule: 'default',
    createdAt: CREATED,
    updatedAt: CREATED,
    ...over,
  };
}

function seed(extra: readonly Change[] = []): Store {
  return storeWith([
    upsert(1, workspace(), 'workspace'),
    upsert(2, user('u1', 'Ada'), 'user'),
    upsert(3, user('u2', 'Grace'), 'user'),
    ...extra,
  ]);
}

function flatten(store: Store, viewerId: UUID | null, tab: 'for-me' | 'recent') {
  return listPulse(store, viewerId, tab, ZONE).flatMap((day) => day.events);
}

describe('listPulse', () => {
  it('ranks project updates by recency and names the author', () => {
    const store = seed([
      upsert(4, project({ id: 'p1', name: 'Launch' }), 'project'),
      upsert(
        5,
        {
          id: 'u-old',
          workspaceId: 'w1',
          projectId: 'p1',
          health: 'on_track',
          body: 'Yesterday.',
          authorId: 'u1',
          createdAt: EARLIER,
          updatedAt: EARLIER,
        },
        'projectUpdate',
      ),
      upsert(
        6,
        {
          id: 'u-new',
          workspaceId: 'w1',
          projectId: 'p1',
          health: 'at_risk',
          body: 'Slip.',
          authorId: 'u2',
          createdAt: NOW,
          updatedAt: NOW,
        },
        'projectUpdate',
      ),
    ]);

    const rows = flatten(store, 'u1', 'recent');
    expect(rows.map((row) => ({ actor: row.actor, body: row.body, health: row.health }))).toEqual([
      { actor: 'Grace', body: 'Slip.', health: 'at_risk' },
      { actor: 'Ada', body: 'Yesterday.', health: 'on_track' },
    ]);
    expect(rows[0]?.href).toBe('/project/p1/activity');
    expect(rows[0]?.projectName).toBe('Launch');
  });

  it('For me keeps updates on projects the viewer leads, created, or belongs to', () => {
    const store = seed([
      upsert(4, project({ id: 'p1', name: 'Alpha', leadId: 'u1' }), 'project'),
      upsert(5, project({ id: 'p2', name: 'Beta', leadId: 'u2', creatorId: 'u2' }), 'project'),
      upsert(6, project({ id: 'p3', name: 'Gamma', leadId: 'u2', creatorId: 'u2' }), 'project'),
      upsert(
        7,
        { id: 'pm1', workspaceId: 'w1', projectId: 'p2', userId: 'u1', createdAt: CREATED },
        'projectMember',
      ),
      upsert(
        8,
        {
          id: 'u-a',
          workspaceId: 'w1',
          projectId: 'p1',
          health: 'on_track',
          body: 'Alpha',
          authorId: 'u2',
          createdAt: NOW,
          updatedAt: NOW,
        },
        'projectUpdate',
      ),
      upsert(
        9,
        {
          id: 'u-b',
          workspaceId: 'w1',
          projectId: 'p2',
          health: 'on_track',
          body: 'Beta',
          authorId: 'u2',
          createdAt: NOW,
          updatedAt: NOW,
        },
        'projectUpdate',
      ),
      upsert(
        10,
        {
          id: 'u-c',
          workspaceId: 'w1',
          projectId: 'p3',
          health: 'on_track',
          body: 'Gamma',
          authorId: 'u2',
          createdAt: NOW,
          updatedAt: NOW,
        },
        'projectUpdate',
      ),
    ]);

    const mine = flatten(store, 'u1', 'for-me').map((row) => row.body);
    expect(mine).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
    expect(mine).not.toContain('Gamma');
    expect(flatten(store, 'u1', 'recent').map((row) => row.body)).toEqual(
      expect.arrayContaining(['Alpha', 'Beta', 'Gamma']),
    );
  });

  it('skips deleted updates and archived projects', () => {
    const store = seed([
      upsert(4, project({ id: 'p1', name: 'Gone', archivedAt: NOW }), 'project'),
      upsert(5, project({ id: 'p2', name: 'Live' }), 'project'),
      upsert(
        6,
        {
          id: 'u-gone',
          workspaceId: 'w1',
          projectId: 'p1',
          health: 'on_track',
          body: 'Archived',
          authorId: 'u1',
          createdAt: NOW,
          updatedAt: NOW,
        },
        'projectUpdate',
      ),
      upsert(
        7,
        {
          id: 'u-dead',
          workspaceId: 'w1',
          projectId: 'p2',
          health: 'on_track',
          body: 'Deleted',
          authorId: 'u1',
          createdAt: NOW,
          updatedAt: NOW,
          deletedAt: NOW,
        },
        'projectUpdate',
      ),
    ]);
    expect(flatten(store, 'u1', 'recent')).toEqual([]);
  });

  it('caps the feed so a busy replica does not paint thousands of rows', () => {
    const extras: Change[] = [upsert(4, project({ id: 'p1', name: 'Busy' }), 'project')];
    for (let i = 0; i < PULSE_LIMIT + 25; i++) {
      extras.push(
        upsert(
          i + 5,
          {
            id: `u-${i}`,
            workspaceId: 'w1',
            projectId: 'p1',
            health: 'on_track',
            body: `Update ${i}`,
            authorId: 'u1',
            createdAt: `2026-08-20T12:00:${String(i % 60).padStart(2, '0')}.000Z`,
            updatedAt: NOW,
          },
          'projectUpdate',
        ),
      );
    }
    const days = listPulse(seed(extras), 'u1', 'recent', ZONE);
    const count = days.reduce((sum, day) => sum + day.events.length, 0);
    expect(count).toBe(PULSE_LIMIT);
  });
});
