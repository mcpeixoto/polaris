/**
 * What the replica does when the disk is slower than the network, or refuses outright.
 *
 * All three failures here are invisible at the moment they happen. A clear issued outside
 * the persist queue lets a write already in flight land after the wipe and put a revoked row
 * back. A tombstone set with no ceiling grows for as long as the tab is open, which for this
 * app is days. And a rejected IndexedDB transaction leaves the in-memory store working
 * perfectly while everything since the failure quietly stops existing on reload.
 */

import 'fake-indexeddb/auto';

import { describe, expect, it, vi } from 'vitest';

import type { PolarisDB } from './db';
import { Store } from './store';
import type { Change, Comment, UUID } from './types';

const NOW = '2026-01-01T00:00:00Z';
const ACTOR = { type: 'user', id: 'u1' } as const;

function comment(id: UUID): Comment {
  return {
    id,
    workspaceId: 'w1',
    issueId: 'i1' as UUID,
    body: 'looks good',
    actor: { type: 'user', id: 'u1' },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function upsert(v: number, id: UUID): Change {
  return { v, type: 'comment', id, op: 'upsert', actor: ACTOR, payload: comment(id) };
}

function drop(v: number, id: UUID): Change {
  return { v, type: 'comment', id, op: 'delete', actor: ACTOR };
}

/** A database that records the order its writes actually committed in. */
function recordingDb(): { db: PolarisDB; log: string[]; settle: () => void } {
  const log: string[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const db = {
    workspaceId: 'w1',
    async write() {
      await held;
      log.push('write');
    },
    async clearEntities() {
      log.push('clear');
    },
    close() {},
  } as unknown as PolarisDB;
  return { db, log, settle: release };
}

describe('beginBootstrap and the persist queue', () => {
  it('does not clear the replica out from under a write that is still landing', async () => {
    const { db, log, settle } = recordingDb();
    const store = new Store('w1' as UUID, { db });

    // The last delta before the resync. Its transaction is still open.
    store.applyChanges([upsert(1, 'c1' as UUID)]);

    const bootstrapping = store.beginBootstrap();
    settle();
    await bootstrapping;

    // The wipe has to be last. Issued outside the queue — which is what this used to do —
    // the pending batch commits after it and reinstates rows the bootstrap was replacing,
    // including the ones a permissions resync exists to revoke.
    expect(log).toEqual(['write', 'clear']);
  });
});

describe('the version a bootstrap commits at', () => {
  it('never rewinds past a change already applied', async () => {
    const store = new Store('w1' as UUID);
    await store.beginBootstrap();

    // A delta that arrived while the snapshot pages were still streaming.
    store.applyChanges([upsert(12, 'c1' as UUID)]);
    await store.finishBootstrap(5);

    // Assigning 5 here would make the socket resume from before that batch: the change is
    // either requested and applied twice, or never mentioned again.
    expect(store.version).toBe(12);
  });

  it('takes the snapshot version when nothing has moved past it', async () => {
    const store = new Store('w1' as UUID);
    await store.beginBootstrap();
    await store.finishBootstrap(41);

    expect(store.version).toBe(41);
  });
});

describe('the tombstone set', () => {
  it('is bounded, oldest first', () => {
    const store = new Store('w1' as UUID);

    for (let n = 0; n < 1_500; n++) {
      store.applyChanges([drop(n + 1, `c${n}` as UUID)]);
    }

    const forgotten = store.forgottenIds('comment');
    expect(forgotten.size).toBe(1_000);
    // The young end is what a read still in flight could be holding. The old end is an id
    // nothing has been waiting on for hours.
    expect(forgotten.has('c1499' as UUID)).toBe(true);
    expect(forgotten.has('c0' as UUID)).toBe(false);
  });

  it('keeps answering for an id it was told about twice', () => {
    const store = new Store('w1' as UUID);

    store.applyChanges([drop(1, 'c-old' as UUID)]);
    for (let n = 0; n < 999; n++) store.applyChanges([drop(n + 2, `c${n}` as UUID)]);
    // Re-recorded, so it goes back to the young end rather than being evicted on its
    // original position by the next insertion.
    store.applyChanges([drop(1_002, 'c-old' as UUID)]);
    store.applyChanges([drop(1_003, 'c-new' as UUID)]);

    expect(store.forgottenIds('comment').has('c-old' as UUID)).toBe(true);
  });
});

describe('an IndexedDB write that fails', () => {
  it('is reported rather than thrown into the void', async () => {
    const onPersistError = vi.fn();
    const db = {
      workspaceId: 'w1',
      write: () => Promise.reject(new DOMException('no room', 'QuotaExceededError')),
      clearEntities: () => Promise.resolve(),
      close() {},
    } as unknown as PolarisDB;
    const store = new Store('w1' as UUID, { db, onPersistError });

    store.applyChanges([upsert(1, 'c1' as UUID)]);
    await store.whenPersisted();

    expect(onPersistError).toHaveBeenCalledTimes(1);
    // The in-memory store carries on regardless, which is exactly why this has to be
    // askable: without it the user keeps working and loses it all on the next reload.
    expect(store.persistenceHealthy).toBe(false);
    expect((store.persistenceFailure as DOMException).name).toBe('QuotaExceededError');
  });

  it('leaves the queue usable, so one bad batch does not lose every later one', async () => {
    const writes = vi.fn();
    let fail = true;
    const db = {
      workspaceId: 'w1',
      write: (batch: unknown) => {
        if (fail) {
          fail = false;
          return Promise.reject(new Error('transaction aborted'));
        }
        writes(batch);
        return Promise.resolve();
      },
      clearEntities: () => Promise.resolve(),
      close() {},
    } as unknown as PolarisDB;
    const store = new Store('w1' as UUID, { db, onPersistError: () => undefined });

    store.applyChanges([upsert(1, 'c1' as UUID)]);
    store.applyChanges([upsert(2, 'c2' as UUID)]);
    await store.whenPersisted();

    expect(writes).toHaveBeenCalledTimes(1);
  });
});
