/**
 * What the drain does with a mutation the server never answered.
 *
 * This is the one place in the client where user data is deliberately thrown away, so it
 * is the one place worth pinning: the attempt ceiling must count answers from the server,
 * never sends that failed to reach it. When it counted both, six edits made in a tunnel
 * cost the user the first one — in about thirty seconds, with a console line and nothing
 * on screen — which is the exact failure the durable outbox exists to prevent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Outbox, type Store, type UUID } from '~/store';
import { ApiError } from './api';
import { SyncEngine } from './engine';

const gql = vi.hoisted(() => vi.fn());

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, gql };
});

const WORKSPACE = '01920000-0000-7000-8000-000000000001' as UUID;

/**
 * An engine with its two collaborators supplied directly.
 *
 * `start()` is not called: it opens IndexedDB, streams a snapshot and opens a socket, none
 * of which this behaviour depends on. Assembling the parts by hand keeps the test about
 * the drain loop rather than about the boot sequence.
 */
function engineWithOutbox(): { engine: InstanceType<typeof SyncEngine>; outbox: Outbox } {
  const engine = new SyncEngine(WORKSPACE);
  const outbox = new Outbox(null);
  engine.outbox = outbox;
  engine.store = {
    revertOptimistic: vi.fn(),
    applyOptimistic: vi.fn(),
    get: vi.fn(),
  } as unknown as Store;
  return { engine, outbox };
}

async function queue(outbox: Outbox, title: string): Promise<UUID> {
  const record = await outbox.append({
    mutation: 'mutation CreateIssue($i: CreateIssueInput!) { createIssue(input: $i) { id } }',
    variables: { i: { title } },
  });
  return record.opId;
}

describe('draining the outbox', () => {
  beforeEach(() => {
    gql.mockReset();
    // The retriable path schedules a drain five seconds out. Under real timers that fires
    // after the test has finished and re-enters the engine with a reset mock.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not count a send that never reached the server', async () => {
    const { engine, outbox } = engineWithOutbox();
    const first = await queue(outbox, 'Written on a train');
    await queue(outbox, 'And another');

    gql.mockRejectedValue(new ApiError('NETWORK', 'network unavailable'));

    // Far more rounds than the ceiling. Every one of them is a tunnel, not a refusal.
    for (let i = 0; i < 12; i++) await engine.drainOutbox();

    expect(outbox.size).toBe(2);
    expect(outbox.get(first)?.attempts).toBe(0);
    // Still sendable: an op left claimed as in-flight would be invisible to `pending()`
    // and would never go out, which loses the edit just as thoroughly.
    expect(outbox.pending().map((r) => r.opId)).toEqual([first, outbox.list()[1]!.opId]);
  });

  it('sends everything queued, in order, once the network returns', async () => {
    const { engine, outbox } = engineWithOutbox();
    await queue(outbox, 'One');
    await queue(outbox, 'Two');
    await queue(outbox, 'Three');

    gql.mockRejectedValue(new ApiError('NETWORK', 'network unavailable'));
    for (let i = 0; i < 12; i++) await engine.drainOutbox();

    gql.mockReset();
    gql.mockResolvedValue({});
    await engine.drainOutbox();

    expect(outbox.size).toBe(0);
    expect(gql.mock.calls.map((call) => (call[1] as { i: { title: string } }).i.title)).toEqual([
      'One',
      'Two',
      'Three',
    ]);
  });

  it('keeps a rate-limited op queued and drops it once the server has refused enough', async () => {
    const { engine, outbox } = engineWithOutbox();
    const opId = await queue(outbox, 'Too fast');

    gql.mockRejectedValue(new ApiError('RATELIMITED', 'slow down'));

    await engine.drainOutbox();
    expect(outbox.get(opId)?.attempts).toBe(1);
    expect(outbox.size).toBe(1);

    for (let i = 0; i < 4; i++) await engine.drainOutbox();
    // Five answers from the server, all failures: this one is not going to work.
    await engine.drainOutbox();
    expect(outbox.size).toBe(0);
  });

  it('rolls a refusal back immediately rather than retrying it', async () => {
    const { engine, outbox } = engineWithOutbox();
    await queue(outbox, 'Not allowed');
    await queue(outbox, 'Behind it');

    gql.mockRejectedValueOnce(new ApiError('FORBIDDEN', 'not your team'));
    gql.mockResolvedValue({});

    await engine.drainOutbox();

    expect(outbox.size).toBe(0);
    expect(gql).toHaveBeenCalledTimes(2);
  });
});

/**
 * The dev-build assertion that makes the pairing bug unshippable rather than unnoticed.
 *
 * It refuses the mutation instead of warning about it, because the alternative has been
 * tried: five features rendered an optimistic create under a stand-in id and paired it in
 * the tail of their own `await`, five reviewers read code that looked correct, and every one
 * of them was found by a user seeing their own comment twice. A console line would have been
 * the sixth thing nobody read.
 */
describe('an optimistic create with nothing to pair it', () => {
  beforeEach(() => {
    gql.mockReset();
  });

  const CREATE = 'mutation CreateComment($input: CreateCommentInput!) { createComment { id } }';
  const standIn = {
    type: 'comment' as const,
    id: '01920000-0000-7000-8000-0000000000aa' as UUID,
    before: null,
    after: { id: '01920000-0000-7000-8000-0000000000aa' } as never,
  };

  it('is refused before it can be written or sent', async () => {
    const { engine } = engineWithOutbox();
    gql.mockResolvedValue({ createComment: { comment: { id: 'real' } } });

    await expect(
      engine.mutate({
        mutation: CREATE,
        variables: { input: { issueId: 'i1', body: 'hello' } },
        optimistic: [standIn],
      }),
    ).rejects.toThrow(/CreateComment.*reconcile/s);

    // Nothing was written and nothing was sent: the mistake is in the call site, and
    // letting it half-happen would leave the replica holding the row it complains about.
    expect(engine.store.applyOptimistic).not.toHaveBeenCalled();
    expect(gql).not.toHaveBeenCalled();
  });

  it('is allowed once the pairing is declared', async () => {
    const { engine } = engineWithOutbox();
    gql.mockResolvedValue({ createComment: { comment: { id: 'real' } } });

    await expect(
      engine.mutate({
        mutation: CREATE,
        variables: { input: { issueId: 'i1', body: 'hello' } },
        optimistic: [standIn],
        reconcile: {
          type: 'comment',
          provisionalId: standIn.id,
          path: ['createComment', 'comment'],
        },
      }),
    ).resolves.toBeDefined();
  });

  it('is allowed when the client minted the id and sent it', async () => {
    const { engine } = engineWithOutbox();
    gql.mockResolvedValue({ createIssue: { issue: { id: standIn.id } } });

    await expect(
      engine.mutate({
        mutation: 'mutation CreateIssue($input: CreateIssueInput!) { createIssue { id } }',
        variables: { input: { id: standIn.id, title: 'Ship it' } },
        optimistic: [{ ...standIn, type: 'issue' }],
      }),
    ).resolves.toBeDefined();
  });
});
