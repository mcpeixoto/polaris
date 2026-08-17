import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dropDatabase, PolarisDB } from './db';
import { clearJournal, drainJournal, journalForget, journalWrite } from './journal';
import { Outbox, type OutboxRecord } from './outbox';
import type { UUID } from './types';

/**
 * The window between a mutation being made and it being durable.
 *
 * The interesting assertions here are about *ordering in time*, not about storage: that the
 * journal already holds a write before the IndexedDB transaction covering it has committed,
 * and that whatever it holds at boot is promoted into the queue. Everything else in this
 * file is the failure handling that keeps a best-effort mechanism from becoming a liability.
 */

const WS = '01900000-0000-7000-8000-000000000001' as UUID;

function key(workspaceId: UUID = WS): string {
  return `polaris.outboxJournal/${workspaceId}`;
}

/** Read straight out of storage, so the assertions do not go through the code under test. */
function raw(workspaceId: UUID = WS): Record<string, OutboxRecord> {
  const value = localStorage.getItem(key(workspaceId));
  return value === null ? {} : (JSON.parse(value) as Record<string, OutboxRecord>);
}

function entry(opId: string, mutation = 'DeleteIssues'): OutboxRecord {
  return {
    opId: opId as UUID,
    mutation,
    variables: { ids: ['issue-1'] },
    optimisticPatch: [],
    attempts: 0,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

/**
 * A fresh in-memory storage per test, following src/styles/theme.test.ts.
 *
 * The ambient one is never touched, which is what keeps the teardown honest: a test that
 * replaces `localStorage` with an object that throws would otherwise have to hand back
 * something the next test's cleanup can still call.
 */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => void values.set(name, value),
    removeItem: (name: string) => void values.delete(name),
    clear: () => values.clear(),
  };
}

/** Storage that throws on every access, as it does in a sandboxed iframe. */
function insecureStorage(): Storage {
  const refuse = (): never => {
    throw new Error('SecurityError');
  };
  return {
    get length(): number {
      return refuse();
    },
    key: refuse,
    getItem: refuse,
    setItem: refuse,
    removeItem: refuse,
    clear: refuse,
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the journal', () => {
  it('holds a write and gives it back once', () => {
    journalWrite(WS, entry('a'));
    expect(Object.keys(raw())).toEqual(['a']);

    expect(drainJournal(WS).map((e) => e.opId)).toEqual(['a']);
    // Cleared by the read. Anything else would recover the same op on every boot forever,
    // because the caller has just written it somewhere strictly more durable.
    expect(localStorage.getItem(key())).toBeNull();
    expect(drainJournal(WS)).toEqual([]);
  });

  it('forgets a write that reached IndexedDB', () => {
    journalWrite(WS, entry('a'));
    journalWrite(WS, entry('b'));
    journalForget(WS, 'a' as UUID);

    expect(Object.keys(raw())).toEqual(['b']);
  });

  it('returns writes in the order they were made', () => {
    // Deliberately inserted backwards. UUIDv7 sorts by mint time, and replaying "set
    // status" after "set assignee" is a different final state from the one the user made.
    journalWrite(WS, entry('01900000-0000-7000-8000-00000000000b'));
    journalWrite(WS, entry('01900000-0000-7000-8000-00000000000a'));

    expect(drainJournal(WS).map((e) => e.opId)).toEqual([
      '01900000-0000-7000-8000-00000000000a',
      '01900000-0000-7000-8000-00000000000b',
    ]);
  });

  it('keeps one workspace out of another', () => {
    const other = '01900000-0000-7000-8000-000000000002' as UUID;
    journalWrite(WS, entry('a'));
    journalWrite(other, entry('b'));

    expect(drainJournal(WS).map((e) => e.opId)).toEqual(['a']);
    expect(drainJournal(other).map((e) => e.opId)).toEqual(['b']);
  });

  it('is emptied when the replica it belongs to is deleted', () => {
    journalWrite(WS, entry('a'));
    clearJournal(WS);
    expect(localStorage.getItem(key())).toBeNull();
  });

  it('ignores anything it did not write', () => {
    // The origin is shared with older builds and with whatever else is served from it. A
    // recovered "mutation" that is really somebody else's JSON would be sent to the server.
    localStorage.setItem(
      key(),
      JSON.stringify({
        a: entry('a'),
        b: { opId: 'b' }, // no mutation, no variables
        c: 'not an object at all',
        d: { opId: 'd', mutation: 'X', variables: {} }, // no patch
      }),
    );

    expect(drainJournal(WS).map((e) => e.opId)).toEqual(['a']);
  });

  it('treats corrupt storage as empty rather than failing', () => {
    localStorage.setItem(key(), '{not json');
    expect(drainJournal(WS)).toEqual([]);
  });

  it('survives storage being absent altogether', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(() => journalWrite(WS, entry('a'))).not.toThrow();
    expect(drainJournal(WS)).toEqual([]);
  });

  it('survives storage that throws outright', () => {
    // Every access throws a SecurityError in a sandboxed iframe and in Safari's private
    // mode. A journal that cannot be written must not be a write that cannot be made —
    // degrading to the old behaviour is the trade, crashing is not.
    vi.stubGlobal('localStorage', insecureStorage());

    expect(() => journalWrite(WS, entry('a'))).not.toThrow();
    expect(() => journalForget(WS, 'a' as UUID)).not.toThrow();
    expect(() => clearJournal(WS)).not.toThrow();
    expect(drainJournal(WS)).toEqual([]);
  });

  it('refuses to grow past its cap rather than filling the origin quota', () => {
    // Nothing legitimate accumulates here — each entry is removed within milliseconds — so
    // a journal this size means something is wrong, and the wrong answer is to take
    // localStorage down for the theme and every other thing sharing the origin.
    const huge = entry('a');
    journalWrite(WS, { ...huge, variables: { blob: 'x'.repeat(600 * 1024) } });

    expect(localStorage.getItem(key())).toBeNull();
  });
});

describe('the outbox, against the window the journal exists to close', () => {
  it('has journalled the write before the durable one has committed', async () => {
    const workspaceId = crypto.randomUUID() as UUID;
    const db = await PolarisDB.open(workspaceId);
    const outbox = await Outbox.open(db);

    // Deliberately not awaited. An async function runs synchronously up to its first
    // `await`, so this is the exact moment a document teardown would land in — the
    // IndexedDB transaction requested and not yet committed. THIS is the assertion the
    // whole module exists for; if `journalWrite` ever moves below the `await` in
    // `Outbox.append`, this is what says so.
    const pending = outbox.append({ mutation: 'DeleteIssues', variables: { ids: ['i'] } });

    const inFlight = Object.values(raw(workspaceId));
    expect(inFlight).toHaveLength(1);
    expect(inFlight[0]?.mutation).toBe('DeleteIssues');

    await pending;

    // And gone again once it is durable, so a healthy session leaves this key empty.
    expect(localStorage.getItem(key(workspaceId))).toBeNull();

    db.close();
    await dropDatabase(workspaceId);
  });

  it('recovers a journalled write into the queue when it opens', async () => {
    const workspaceId = crypto.randomUUID() as UUID;
    const db = await PolarisDB.open(workspaceId);

    // What an interrupted session leaves behind: the entry recorded, the IndexedDB
    // transaction never committed.
    journalWrite(workspaceId, entry('01900000-0000-7000-8000-0000000000aa'));
    expect(await db.readOutbox()).toEqual([]);

    const outbox = await Outbox.open(db);

    expect(outbox.list().map((r) => r.opId)).toEqual(['01900000-0000-7000-8000-0000000000aa']);
    // Promoted to IndexedDB, not merely loaded into memory — otherwise the recovery would
    // itself be lost to the next teardown.
    expect((await db.readOutbox()).map((r) => r.opId)).toEqual([
      '01900000-0000-7000-8000-0000000000aa',
    ]);
    expect(localStorage.getItem(key(workspaceId))).toBeNull();

    db.close();
    await dropDatabase(workspaceId);
  });

  it('does not disturb a queued op that the journal also happens to hold', async () => {
    // The tab can die between the IndexedDB commit and the journal removal, so the same op
    // can be in both. It must stay one op, with the attempts it had already accumulated —
    // recovering over the top would reset the poison counter and make a failing op retry
    // forever.
    const workspaceId = crypto.randomUUID() as UUID;
    const db = await PolarisDB.open(workspaceId);
    const opId = '01900000-0000-7000-8000-0000000000bb';

    await db.putOutbox({ ...entry(opId), attempts: 4 });
    journalWrite(workspaceId, entry(opId));

    const outbox = await Outbox.open(db);

    expect(outbox.list()).toHaveLength(1);
    expect(outbox.get(opId as UUID)?.attempts).toBe(4);

    db.close();
    await dropDatabase(workspaceId);
  });

  it('is emptied along with the replica when the workspace is dropped', async () => {
    // Sign-out, a schema rebuild, or this installation pointed at a different server. A
    // surviving entry is a mutation replayed against a workspace the person may not be in.
    const workspaceId = crypto.randomUUID() as UUID;
    journalWrite(workspaceId, entry('a'));

    await dropDatabase(workspaceId);

    expect(localStorage.getItem(key(workspaceId))).toBeNull();
  });
});
