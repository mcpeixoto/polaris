/**
 * `hydrateInbox` is the one read in this client that fills the replica from GraphQL rather
 * than from the sync stream, and it was the one that did not convert what it read.
 *
 * Both halves of that mattered, and neither errored anywhere:
 *
 *   - `type` arrived as `"ISSUE_ASSIGNED"` where every reader compares against
 *     `'issue_assigned'`, so `describeEvent` fell through to its unknown-type fallback and
 *     the whole inbox read "updated ENG-1".
 *   - `readAt` arrived as an explicit `null` rather than being absent, and the client spells
 *     "unread" as `readAt === undefined`. So every hydrated row rendered as already dealt
 *     with, the badge said nothing was waiting, and `markNotificationRead` declined to change
 *     one because it agreed it was already read.
 *
 * Asserted here rather than in the browser because the bootstrap snapshot now carries
 * notifications too, and a row the snapshot has already put in the store is skipped by this
 * function — so the path is real, is still the only way a notification newer than the
 * snapshot arrives on a screen, and is invisible from the outside on a fresh workspace.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Store, type Notification } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import {
  DISMISS_GRACE_MS,
  dismissNotificationSoon,
  dismissReadNotifications,
  flushDismissals,
  hydrateInbox,
} from './mutations';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const VIEWER = '01900000-0000-7000-8000-000000000002';
const ISSUE = '01900000-0000-7000-8000-000000000003';
const ROW = '01900000-0000-7000-8000-000000000004';
const AT = '2026-01-01T00:00:00.000Z';

/** A notification exactly as GraphQL sends one: enums shouted, absences spelled `null`. */
function wireRow(): Record<string, unknown> {
  return {
    id: ROW,
    workspaceId: WORKSPACE,
    userId: VIEWER,
    type: 'ISSUE_ASSIGNED',
    issueId: ISSUE,
    commentId: null,
    actor: { type: 'USER', id: VIEWER },
    changeVersion: 7,
    groupKey: 'issue-assigned:1',
    count: 1,
    payload: null,
    readAt: null,
    snoozedUntil: null,
    createdAt: AT,
    updatedAt: AT,
  };
}

function engineOver(store: Store): SyncEngine {
  return { store } as unknown as SyncEngine;
}

describe('hydrateInbox', () => {
  beforeEach(() => vi.clearAllMocks());

  it('converts the rows it reads into the spelling the replica uses', async () => {
    vi.mocked(gql).mockResolvedValue({ notifications: [wireRow()] } as never);
    const store = new Store(WORKSPACE);

    await hydrateInbox(engineOver(store));

    const held = store.notifications.get(ROW) as Notification | undefined;
    expect(held).toBeDefined();
    // The enum, in the spelling `describeEvent` switches on.
    expect(held?.type).toBe('issue_assigned');
    expect(held?.actor.type).toBe('user');
    // Absence is absence. `'readAt' in row` is the question the unread count asks, so a
    // `null` here is a row that says it has been dealt with when it has not.
    expect('readAt' in (held as object)).toBe(false);
    expect('snoozedUntil' in (held as object)).toBe(false);
    expect('commentId' in (held as object)).toBe(false);
  });

  it('leaves a row the replica already holds alone', async () => {
    const store = new Store(WORKSPACE);
    const mine: Notification = {
      id: ROW,
      workspaceId: WORKSPACE,
      userId: VIEWER,
      type: 'issue_assigned',
      issueId: ISSUE,
      actor: { type: 'user', id: VIEWER },
      changeVersion: 7,
      groupKey: 'issue-assigned:1',
      count: 1,
      // Marked read a moment ago, and not yet acknowledged by the server.
      readAt: AT,
      createdAt: AT,
      updatedAt: AT,
    };
    store.applyOptimistic([{ type: 'notification', id: ROW, before: null, after: mine }]);

    vi.mocked(gql).mockResolvedValue({ notifications: [wireRow()] } as never);
    await hydrateInbox(engineOver(store));

    // Flipping this back to unread is the one thing an inbox may never do.
    expect(store.notifications.get(ROW)?.readAt).toBe(AT);
  });
});

describe('dismissReadNotifications', () => {
  it('deletes every read row and leaves unread ones', async () => {
    const unread: Notification = {
      id: ROW,
      workspaceId: WORKSPACE,
      userId: VIEWER,
      type: 'issue_assigned',
      issueId: ISSUE,
      actor: { type: 'user', id: VIEWER },
      changeVersion: 1,
      groupKey: 'unread',
      count: 1,
      createdAt: AT,
      updatedAt: AT,
    };
    const readId = '01900000-0000-7000-8000-000000000005';
    const read: Notification = { ...unread, id: readId, groupKey: 'read', readAt: AT };
    const store = new Store(WORKSPACE);
    store.applyChanges([
      {
        v: 1,
        type: 'notification',
        id: unread.id,
        op: 'upsert',
        actor: { type: 'system' },
        payload: unread,
      },
      {
        v: 2,
        type: 'notification',
        id: read.id,
        op: 'upsert',
        actor: { type: 'system' },
        payload: read,
      },
    ]);
    const mutate = vi.fn().mockResolvedValue({});

    await dismissReadNotifications({ store, mutate } as unknown as SyncEngine);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({ id: readId });
  });
});

/**
 * The dismissal that waits.
 *
 * `deleteNotification` is a soft delete with no inverse, so the only honest undo the inbox
 * can offer is the request not having gone yet. What has to be true of that: the row leaves
 * the screen at once, nothing is sent inside the window, the cancel puts it back, and
 * leaving the screen sends what is still held rather than dropping it.
 */
describe('dismissNotificationSoon', () => {
  const row: Notification = {
    id: ROW,
    workspaceId: WORKSPACE,
    userId: VIEWER,
    type: 'issue_assigned',
    issueId: ISSUE,
    actor: { type: 'user', id: VIEWER },
    changeVersion: 1,
    groupKey: 'pending',
    count: 1,
    createdAt: AT,
    updatedAt: AT,
  };

  function seeded(): { store: Store; mutate: ReturnType<typeof vi.fn>; engine: SyncEngine } {
    const store = new Store(WORKSPACE);
    store.applyChanges([
      {
        v: 1,
        type: 'notification',
        id: ROW,
        op: 'upsert',
        actor: { type: 'system' },
        payload: row,
      },
    ]);
    const mutate = vi.fn().mockResolvedValue({});
    return { store, mutate, engine: { store, mutate } as unknown as SyncEngine };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    flushDismissals();
    vi.useRealTimers();
  });

  it('takes the row off the screen now and sends the delete when the window closes', () => {
    const { store, mutate, engine } = seeded();

    dismissNotificationSoon(engine, ROW);
    expect(store.notifications.has(ROW)).toBe(false);
    expect(mutate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DISMISS_GRACE_MS);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({ id: ROW });
  });

  it('puts the row back and sends nothing when the undo is taken', () => {
    const { store, mutate, engine } = seeded();

    const restore = dismissNotificationSoon(engine, ROW);
    restore();

    expect(store.notifications.get(ROW)).toEqual(row);
    vi.advanceTimersByTime(DISMISS_GRACE_MS * 2);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('does nothing on a second undo, and nothing once the write has gone', () => {
    const { store, mutate, engine } = seeded();

    const restore = dismissNotificationSoon(engine, ROW);
    vi.advanceTimersByTime(DISMISS_GRACE_MS);
    restore();

    expect(store.notifications.has(ROW)).toBe(false);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('sends what it is still holding when the inbox is left', () => {
    const { mutate, engine } = seeded();

    dismissNotificationSoon(engine, ROW);
    flushDismissals();

    expect(mutate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DISMISS_GRACE_MS * 2);
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
