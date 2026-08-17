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

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Store, type Notification } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { hydrateInbox } from './mutations';

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
