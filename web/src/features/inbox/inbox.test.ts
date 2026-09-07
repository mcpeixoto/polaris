import { describe, expect, it } from 'vitest';

import { Store, type Change, type Notification } from '~/store';

import {
  dayGroupName,
  describeEvent,
  groupByDay,
  matchesInboxQuery,
  notificationHref,
  stepTab,
  tabCounts,
  tabNotificationIds,
} from './inbox';

const WORKSPACE = 'w1';
const USER = 'u1';
const NOW = Date.parse('2026-08-16T12:00:00.000Z');
const AT = '2026-08-16T11:00:00.000Z';

function row(id: string, over: Partial<Notification> = {}): Notification {
  return {
    id,
    workspaceId: WORKSPACE,
    userId: USER,
    type: 'issue_assigned',
    issueId: 'i1',
    actor: { type: 'user', id: USER },
    changeVersion: 1,
    groupKey: `g:${id}`,
    count: 1,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function storeWith(...rows: Notification[]): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    rows.map((payload, index): Change => ({
      v: index + 1,
      type: 'notification',
      id: payload.id,
      op: 'upsert',
      actor: { type: 'system' },
      payload,
    })),
  );
  return store;
}

/**
 * The four tabs, which replaced a pair of checkboxes.
 *
 * The pair could say "everything" and "only unread" and had no way to ask the two questions
 * the tabs exist for: what is still asleep, and what have I already dealt with.
 */
describe('tabNotificationIds', () => {
  it('keeps a still-snoozed row out of every tab but Snoozed', () => {
    const store = storeWith(
      row('awake'),
      row('asleep', { snoozedUntil: '2026-08-16T18:00:00.000Z' }),
    );
    expect(tabNotificationIds(store, NOW, 'inbox')).toEqual(['awake']);
    expect(tabNotificationIds(store, NOW, 'unread')).toEqual(['awake']);
    expect(tabNotificationIds(store, NOW, 'snoozed')).toEqual(['asleep']);
    expect(tabNotificationIds(store, NOW, 'done')).toEqual([]);
  });

  it('splits read from unread, and Inbox holds both', () => {
    const store = storeWith(row('unread'), row('read', { readAt: AT }));
    expect(tabNotificationIds(store, NOW, 'inbox')).toEqual(['unread', 'read']);
    expect(tabNotificationIds(store, NOW, 'unread')).toEqual(['unread']);
    expect(tabNotificationIds(store, NOW, 'done')).toEqual(['read']);
  });

  it('wakes a snoozed row into the list when its moment has passed', () => {
    const store = storeWith(row('was-asleep', { snoozedUntil: '2026-08-16T11:30:00.000Z' }));
    expect(tabNotificationIds(store, Date.parse('2026-08-16T11:00:00.000Z'), 'snoozed')).toEqual([
      'was-asleep',
    ]);
    expect(tabNotificationIds(store, NOW, 'inbox')).toEqual(['was-asleep']);
  });
});

describe('tabCounts', () => {
  it('counts what each tab would draw, from one walk', () => {
    const store = storeWith(
      row('unread'),
      row('read', { readAt: AT }),
      row('asleep', { snoozedUntil: '2026-08-16T18:00:00.000Z' }),
    );
    expect(tabCounts(store, NOW)).toEqual({ inbox: 2, unread: 1, snoozed: 1, done: 1 });
  });

  it('agrees with the rows each tab actually holds', () => {
    const store = storeWith(
      row('a'),
      row('b', { readAt: AT }),
      row('c', { snoozedUntil: '2026-08-16T18:00:00.000Z' }),
      row('d', { readAt: AT, snoozedUntil: '2026-08-16T18:00:00.000Z' }),
    );
    const counts = tabCounts(store, NOW);
    for (const tab of ['inbox', 'unread', 'snoozed', 'done'] as const) {
      expect(tabNotificationIds(store, NOW, tab).length).toBe(counts[tab]);
    }
  });
});

describe('stepTab', () => {
  it('wraps in both directions, so the two chords cannot dead-end', () => {
    expect(stepTab('inbox', 1)).toBe('unread');
    expect(stepTab('done', 1)).toBe('inbox');
    expect(stepTab('inbox', -1)).toBe('done');
  });
});

describe('groupByDay', () => {
  it('cuts a newest-first run into days without reordering it', () => {
    const groups = groupByDay(
      [
        { id: 'a', createdAt: '2026-08-16T11:00:00.000Z' },
        { id: 'b', createdAt: '2026-08-16T09:00:00.000Z' },
        { id: 'c', createdAt: '2026-08-15T22:00:00.000Z' },
      ],
      'UTC',
      NOW,
    );
    expect(groups.map((group) => group.key)).toEqual(['2026-08-16', '2026-08-15']);
    expect(groups.map((group) => group.name)).toEqual(['Today', 'Yesterday']);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(groups[1]?.rows.map((r) => r.id)).toEqual(['c']);
  });

  it('names anything older by its date rather than by arithmetic the reader has to undo', () => {
    expect(dayGroupName('2026-08-10', 'UTC', NOW)).toBe('Mon 10 Aug');
  });
});

describe('matchesInboxQuery', () => {
  it('matches a substring of the haystack and treats blank as everything', () => {
    expect(matchesInboxQuery('Ada assigned ENG-4 to you', 'eng-4')).toBe(true);
    expect(matchesInboxQuery('Ada assigned ENG-4 to you', 'comment')).toBe(false);
    expect(matchesInboxQuery('Ada assigned ENG-4 to you', '  ')).toBe(true);
  });
});

describe('describeEvent for entity subscriptions', () => {
  it('names a project update without pretending it is an issue', () => {
    expect(describeEvent('project_update', 'an issue')).toBe(
      'posted an update on a project you follow',
    );
    expect(describeEvent('initiative_update', 'an issue')).toBe(
      'posted an update on an initiative you follow',
    );
  });

  it('uses the issue when a customer request has one, and not when it does not', () => {
    expect(describeEvent('customer_request_added', 'an issue')).toBe(
      'added a request for a customer you follow',
    );
    expect(describeEvent('customer_request_added', 'ENG-4')).toBe('added a request on ENG-4');
  });
});

describe('notificationHref', () => {
  it('opens Pulse, activity, and the customer page when there is no issue', () => {
    expect(notificationHref('pulse_digest', undefined, undefined)).toBe('/pulse');
    expect(notificationHref('project_update', { projectId: 'p1' }, undefined)).toBe(
      '/project/p1/activity',
    );
    expect(notificationHref('initiative_update', { initiativeId: 'in1' }, undefined)).toBe(
      '/initiative/in1/activity',
    );
    expect(notificationHref('customer_request_added', { customerId: 'c1' }, undefined)).toBe(
      '/customer/c1',
    );
    expect(notificationHref('customer_request_added', { customerId: 'c1' }, 'i1')).toBeUndefined();
    expect(notificationHref('issue_assigned', undefined, 'i1')).toBeUndefined();
  });
});
