import { describe, expect, it } from 'vitest';

import { Store, type Change, type Notification } from '~/store';

import {
  DEFAULT_INBOX_DISPLAY,
  describeEvent,
  matchesInboxQuery,
  notificationHref,
  visibleNotificationIds,
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
    rows.map(
      (payload, index): Change => ({
        v: index + 1,
        type: 'notification',
        id: payload.id,
        op: 'upsert',
        actor: { type: 'system' },
        payload,
      }),
    ),
  );
  return store;
}

describe('visibleNotificationIds', () => {
  it('hides still-snoozed rows unless Show snoozed is on', () => {
    const store = storeWith(
      row('awake'),
      row('asleep', { snoozedUntil: '2026-08-16T18:00:00.000Z' }),
    );
    expect(visibleNotificationIds(store, NOW, DEFAULT_INBOX_DISPLAY)).toEqual(['awake']);
    expect(
      visibleNotificationIds(store, NOW, { showRead: true, showSnoozed: true }),
    ).toEqual(['awake', 'asleep']);
  });

  it('hides read rows when Show read is off', () => {
    const store = storeWith(row('unread'), row('read', { readAt: AT }));
    expect(visibleNotificationIds(store, NOW, DEFAULT_INBOX_DISPLAY)).toEqual(['unread', 'read']);
    expect(
      visibleNotificationIds(store, NOW, { showRead: false, showSnoozed: false }),
    ).toEqual(['unread']);
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
