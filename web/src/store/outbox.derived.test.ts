/**
 * The two questions the outbox is asked far more often than it is written to.
 *
 * "Is this id still a stand-in?" comes off composer and render paths — per keystroke — and
 * "what can be paired against a delta row?" comes off every batch the socket delivers. Both
 * used to be answered by copying the whole queue and scanning it, which is free with an
 * empty outbox and quadratic with a full one. A full one is a client that has been offline,
 * which is precisely when both are asked hardest.
 */

import { describe, expect, it } from 'vitest';

import { Outbox, type Reconciliation } from './outbox';
import type { UUID } from './types';

const STAND_IN = '01920000-0000-7000-8000-0000000000aa' as UUID;
const OTHER = '01920000-0000-7000-8000-0000000000bb' as UUID;

function pairing(provisionalId: UUID, match?: readonly ['body']): Reconciliation {
  return {
    type: 'comment',
    provisionalId,
    path: ['createComment', 'comment'],
    ...(match === undefined ? null : { match }),
  };
}

async function queue(outbox: Outbox, reconcile?: Reconciliation): Promise<UUID> {
  const record = await outbox.append({
    mutation: 'mutation CreateComment($i: CreateCommentInput!) { createComment(input: $i) { id } }',
    variables: { i: { body: 'hello' } },
    ...(reconcile === undefined ? null : { reconcile }),
  });
  return record.opId;
}

describe('knowing whether an id is still provisional', () => {
  it('answers for a queued pairing and stops answering once it resolves', async () => {
    const outbox = new Outbox(null);
    const opId = await queue(outbox, pairing(STAND_IN));

    expect(outbox.hasProvisional(STAND_IN)).toBe(true);
    expect(outbox.hasProvisional(OTHER)).toBe(false);

    await outbox.resolve(opId);
    expect(outbox.hasProvisional(STAND_IN)).toBe(false);
  });

  it('keeps answering while a second op still names the same stand-in', async () => {
    const outbox = new Outbox(null);
    const first = await queue(outbox, pairing(STAND_IN));
    await queue(outbox, pairing(STAND_IN));

    await outbox.resolve(first);

    // Subtracting the id here rather than rebuilding would report a row as real while a
    // queued mutation is still standing in for it — and that id then goes out as a foreign
    // key on the next write, which the server refuses.
    expect(outbox.hasProvisional(STAND_IN)).toBe(true);
  });

  it('forgets everything when the queue is emptied for a sign-out', async () => {
    const outbox = new Outbox(null);
    await queue(outbox, pairing(STAND_IN));

    await outbox.clear();

    expect(outbox.hasProvisional(STAND_IN)).toBe(false);
  });
});

describe('the pairings a delta batch can be matched against', () => {
  it('lists only the specs that declared a match', async () => {
    const outbox = new Outbox(null);
    await queue(outbox, pairing(STAND_IN, ['body']));
    await queue(outbox, pairing(OTHER));

    const matchable = outbox.matchableReconciliations();

    expect(matchable.map((spec) => spec.provisionalId)).toEqual([STAND_IN]);
  });

  it('is rebuilt when the queue changes, not once for the life of the tab', async () => {
    const outbox = new Outbox(null);
    const opId = await queue(outbox, pairing(STAND_IN, ['body']));
    expect(outbox.matchableReconciliations()).toHaveLength(1);

    await queue(outbox, pairing(OTHER, ['body']));
    expect(outbox.matchableReconciliations()).toHaveLength(2);

    await outbox.resolve(opId);
    expect(outbox.matchableReconciliations().map((spec) => spec.provisionalId)).toEqual([OTHER]);
  });

  it('hands back the same array while nothing has changed', async () => {
    const outbox = new Outbox(null);
    await queue(outbox, pairing(STAND_IN, ['body']));

    // Cached, which is the point: `adopt` asks for this on every delta batch a reconnecting
    // client is handed, and that is the moment delta volume is highest.
    expect(outbox.matchableReconciliations()).toBe(outbox.matchableReconciliations());
  });
});
