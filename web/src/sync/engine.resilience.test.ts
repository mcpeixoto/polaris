/**
 * The engine's behaviour when something is already going wrong.
 *
 * Every case here ends, before the fix, with the app looking fine and being wrong: a
 * mutation sent twice because nothing claimed it, a queue nobody comes back for, a resync
 * that failed once and parked the user on a dead splash behind a live socket, and a snapshot
 * streaming into a store that is still being wiped.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Outbox, type Store, type UUID } from '~/store';
import { ApiError } from './api';
import { SyncEngine, type EngineStatus } from './engine';

const gql = vi.hoisted(() => vi.fn());
const streamBootstrap = vi.hoisted(() => vi.fn());

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, gql };
});

vi.mock('./bootstrap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bootstrap')>();
  return { ...actual, streamBootstrap };
});

const WORKSPACE = '01920000-0000-7000-8000-000000000001' as UUID;

interface Harness {
  engine: SyncEngine;
  outbox: Outbox;
  statuses: EngineStatus[];
  store: {
    beginBootstrap: ReturnType<typeof vi.fn>;
    finishBootstrap: ReturnType<typeof vi.fn>;
    ingestBootstrapPage: ReturnType<typeof vi.fn>;
    whenPersisted: ReturnType<typeof vi.fn>;
  };
}

/**
 * An engine with its collaborators supplied directly, as in ./engine.test.ts.
 *
 * `start()` is not called: it opens IndexedDB and a socket, and none of the behaviour here
 * depends on either.
 */
function harness(): Harness {
  const statuses: EngineStatus[] = [];
  const engine = new SyncEngine(WORKSPACE, { onStatus: (status) => statuses.push(status) });
  const outbox = new Outbox(null);
  engine.outbox = outbox;
  const store = {
    beginBootstrap: vi.fn().mockResolvedValue(undefined),
    finishBootstrap: vi.fn().mockResolvedValue(undefined),
    ingestBootstrapPage: vi.fn(),
    whenPersisted: vi.fn().mockResolvedValue(undefined),
    revertOptimistic: vi.fn(),
    applyOptimistic: vi.fn(),
    get: vi.fn(),
    version: 0,
  };
  engine.store = store as unknown as Store;
  return { engine, outbox, statuses, store };
}

/** The engine's private collaborators, for the cases only they can produce. */
function internals(engine: SyncEngine): {
  socket: { disconnect: () => void; connect: (v: number) => void };
  onResync: (reason: string, retryAfterMs: number) => void;
  onPersistError: (error: unknown) => void;
} {
  return engine as unknown as {
    socket: { disconnect: () => void; connect: (v: number) => void };
    onResync: (reason: string, retryAfterMs: number) => void;
    onPersistError: (error: unknown) => void;
  };
}

async function queue(outbox: Outbox, title: string): Promise<UUID> {
  const record = await outbox.append({
    mutation: 'mutation CreateIssue($i: CreateIssueInput!) { createIssue(input: $i) { id } }',
    variables: { i: { title } },
  });
  return record.opId;
}

beforeEach(() => {
  gql.mockReset();
  streamBootstrap.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a mutation that is still on the wire', () => {
  it('is not sent a second time by a drain that starts underneath it', async () => {
    const { engine } = harness();
    let answer: (value: unknown) => void = () => {};
    gql.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );

    const sending = engine.mutate({
      mutation: 'mutation UpdateIssue($i: UpdateIssueInput!) { updateIssue(input: $i) { id } }',
      variables: { i: { title: 'Renamed' } },
    });
    // Far enough for the outbox append to have landed and the send to be in flight.
    await vi.advanceTimersByTimeAsync(0);
    expect(gql).toHaveBeenCalledTimes(1);

    // `onSocketReady` starts one of these on every reconnect. Without the claim it picks
    // the op straight back up: the server's idempotency table stops the double write, but
    // both answers then settle and discharge the same record.
    await engine.drainOutbox();
    expect(gql).toHaveBeenCalledTimes(1);

    answer({});
    await sending;
  });

  it('becomes sendable again once the send fails offline', async () => {
    const { engine, outbox } = harness();
    gql.mockRejectedValue(new ApiError('NETWORK', 'network unavailable'));

    await engine
      .mutate({
        mutation: 'mutation UpdateIssue($i: UpdateIssueInput!) { updateIssue(input: $i) { id } }',
        variables: { i: { title: 'Renamed' } },
      })
      .catch(() => undefined);

    // An op left claimed is invisible to `pending()`, so it would never go out again —
    // which loses the edit exactly as thoroughly as discarding it.
    expect(outbox.pending()).toHaveLength(1);
  });
});

describe('the outbox drain schedule', () => {
  it('comes back for a queue the network was not ready for', async () => {
    const { engine, outbox } = harness();
    await queue(outbox, 'Written on a train');
    gql.mockRejectedValue(new ApiError('NETWORK', 'network unavailable'));

    await engine.drainOutbox();
    expect(gql).toHaveBeenCalledTimes(1);

    // Nothing else will: the socket and /graphql are not the same service, so a healthy
    // socket is no promise that the API is answering.
    gql.mockResolvedValue({});
    await vi.advanceTimersByTimeAsync(5_000);
    expect(outbox.size).toBe(0);
  });

  it('arms one timer for a burst, not one per mutation', async () => {
    const { engine, outbox } = harness();
    for (let n = 0; n < 20; n++) await queue(outbox, `Offline ${n}`);
    gql.mockRejectedValue(new ApiError('NETWORK', 'network unavailable'));

    await engine.drainOutbox();
    const sends = gql.mock.calls.length;

    // Twenty timers firing together would have the `draining` guard discard nineteen of
    // them — and a drain skipped that way used to be simply lost.
    await vi.advanceTimersByTimeAsync(2_500);
    expect(gql.mock.calls.length).toBe(sends + 1);
  });

  it('is cancelled by stop(), so a torn-down engine stops talking', async () => {
    const { engine, outbox } = harness();
    await queue(outbox, 'Written on a train');
    gql.mockRejectedValue(new ApiError('NETWORK', 'network unavailable'));

    await engine.drainOutbox();
    const sends = gql.mock.calls.length;
    engine.stop();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(gql.mock.calls.length).toBe(sends);
  });

  it('waits as long as a rate limit asked it to', async () => {
    const { engine, outbox } = harness();
    await queue(outbox, 'Too fast');
    gql.mockRejectedValue(
      new ApiError('RATELIMITED', 'slow down', undefined, undefined, { retryAfterMs: 20_000 }),
    );

    await engine.drainOutbox();
    const sends = gql.mock.calls.length;

    // A client that answers a 429 with a guess of its own is a client that keeps hitting
    // the same rate limit.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(gql.mock.calls.length).toBe(sends);
    await vi.advanceTimersByTimeAsync(26_000);
    expect(gql.mock.calls.length).toBeGreaterThan(sends);
  });
});

describe('a resync', () => {
  it('closes the socket before the replica is wiped', async () => {
    const { engine, store } = harness();
    const order: string[] = [];
    const socket = internals(engine).socket;
    vi.spyOn(socket, 'disconnect').mockImplementation(() => order.push('disconnect'));
    vi.spyOn(socket, 'connect').mockImplementation(() => order.push('connect'));
    store.beginBootstrap.mockImplementation(() => {
      order.push('wipe');
      return Promise.resolve();
    });
    streamBootstrap.mockResolvedValue({ version: 7, clientSchema: 3, count: 0 });

    internals(engine).onResync('permissions_changed', 0);
    await vi.advanceTimersByTimeAsync(10);

    // A delta applied to a store mid-rebuild is the leak `revoke` exists to prevent: the
    // forget is a no-op because the row is not there yet, and the next page puts it back.
    expect(order).toEqual(['disconnect', 'wipe', 'connect']);
  });

  it('keeps retrying rather than parking on a dead splash', async () => {
    const { engine, statuses } = harness();
    streamBootstrap
      .mockRejectedValueOnce(new ApiError('INTERNAL', 'the snapshot failed'))
      .mockRejectedValueOnce(new ApiError('NETWORK', 'network unavailable'))
      .mockResolvedValue({ version: 7, clientSchema: 3, count: 0 });

    internals(engine).onResync('gap_too_large', 0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(streamBootstrap).toHaveBeenCalledTimes(3);
    // The failures say so, and say a retry is coming — a terminal `failed` behind a socket
    // that is still connected is the state this replaces.
    expect(statuses.filter((s) => s.phase === 'failed').every((s) => s.retrying === true)).toBe(
      true,
    );
    expect(statuses[statuses.length - 1]?.phase).toBe('ready');
  });

  it('stops retrying once the engine is stopped', async () => {
    const { engine } = harness();
    streamBootstrap.mockRejectedValue(new ApiError('INTERNAL', 'the snapshot failed'));

    internals(engine).onResync('gap_too_large', 0);
    await vi.advanceTimersByTimeAsync(10);
    const attempts = streamBootstrap.mock.calls.length;
    engine.stop();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(streamBootstrap.mock.calls.length).toBe(attempts);
  });

  it('lets the disk catch up while the snapshot streams', async () => {
    const { engine, store } = harness();
    streamBootstrap.mockImplementation(
      async (_workspace: string, handlers: { onBatch: (rows: unknown[]) => Promise<void> }) => {
        for (let page = 0; page < 16; page++) await handlers.onBatch([]);
        return { version: 7, clientSchema: 3, count: 0 };
      },
    );

    internals(engine).onResync('gap_too_large', 0);
    await vi.advanceTimersByTimeAsync(10);

    // Without this the network outruns IndexedDB and every un-written batch stays retained
    // by the persist chain: the whole snapshot held in memory twice at the peak.
    expect(store.whenPersisted).toHaveBeenCalledTimes(2);
  });
});

describe('a replica that cannot be written', () => {
  it('says so on the status rather than throwing into a handler nobody installed', () => {
    const { engine, statuses } = harness();

    internals(engine).onPersistError(new DOMException('no room', 'QuotaExceededError'));

    const last = statuses[statuses.length - 1];
    expect(last?.phase).toBe('ready');
    expect(last?.phase === 'ready' && last.degraded).toEqual({
      reason: 'storage-full',
      message: 'this browser is out of space, so changes are not being saved locally',
    });
  });

  it('separates the quota from any other refusal, because only one of them is fixable', () => {
    const { engine, statuses } = harness();

    internals(engine).onPersistError(new Error('transaction aborted'));

    const last = statuses[statuses.length - 1];
    expect(last?.phase === 'ready' && last.degraded?.reason).toBe('storage-failed');
  });
});
