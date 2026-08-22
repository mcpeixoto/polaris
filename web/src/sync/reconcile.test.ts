/**
 * The pairing that has to survive a reload.
 *
 * The bug these cover was reproducible in the browser and invisible everywhere else: post a
 * comment, reload before the response lands, and the issue shows the comment twice — for
 * good, because by then the stand-in and the server's row are both real rows in the replica.
 * The same gesture on the links panel showed one blocker twice at both ends.
 *
 * The cause was that the pairing lived in the `await` that sent the mutation. The optimistic
 * row is persisted on purpose, the outbox replays the op on the next load, and the server's
 * idempotency table answers the replay with the original row — so everything needed to make
 * the pair was present, and the only thing missing was somebody left to make it.
 */

import { describe, expect, it } from 'vitest';

import { Outbox, Store, type Change, type Entity, type Reconciliation } from '~/store';

import { adopt, settle } from './reconcile';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const ISSUE = '01900000-0000-7000-8000-00000000000a';
const PROVISIONAL = '01900000-0000-7000-8000-0000000000f1';
const REAL = '01900000-0000-7000-8000-0000000000f2';
const AT = '2026-01-01T00:00:00.000Z';

function provisionalComment(): Entity {
  return {
    id: PROVISIONAL,
    workspaceId: WORKSPACE,
    issueId: ISSUE,
    body: 'First thing',
    actor: { type: 'user' },
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function serverComment(): Record<string, unknown> {
  return {
    id: REAL,
    workspaceId: WORKSPACE,
    issueId: ISSUE,
    body: 'First thing',
    actor: { type: 'USER' },
    createdAt: AT,
    updatedAt: AT,
  };
}

const COMMENT_SPEC: Reconciliation = {
  type: 'comment',
  provisionalId: PROVISIONAL,
  path: ['createComment', 'comment'],
};

function storeWithStandIn(): Store {
  const store = new Store(WORKSPACE);
  store.applyOptimistic([
    { type: 'comment', id: PROVISIONAL, before: null, after: provisionalComment() },
  ]);
  return store;
}

describe('settle', () => {
  it('replaces the stand-in rather than sitting beside it', () => {
    const store = storeWithStandIn();

    settle(store, COMMENT_SPEC, { createComment: { comment: serverComment() } });

    expect(store.get('comment', PROVISIONAL)).toBeUndefined();
    expect(store.get('comment', REAL)?.body).toBe('First thing');
    expect([...store.commentIdsFor(ISSUE)]).toEqual([REAL]);
  });

  it('converts the response out of the wire spelling on the way in', () => {
    const store = storeWithStandIn();

    settle(store, COMMENT_SPEC, { createComment: { comment: serverComment() } });

    // 'USER' is not 'user', and every reader in the client compares against the latter.
    expect(store.get('comment', REAL)?.actor.type).toBe('user');
  });

  it('is a plain upsert when the ids already match', () => {
    const store = new Store(WORKSPACE);
    const spec: Reconciliation = { ...COMMENT_SPEC, provisionalId: REAL };

    settle(store, spec, { createComment: { comment: serverComment() } });

    expect(store.get('comment', REAL)?.body).toBe('First thing');
  });

  it('leaves the stand-in alone when the response holds no row', () => {
    const store = storeWithStandIn();

    settle(store, COMMENT_SPEC, { createComment: { comment: null } });
    settle(store, COMMENT_SPEC, {});

    // The user's own write, still on screen. The delta stream carries the truth either way,
    // and deleting it on a hunch would lose a comment somebody just wrote.
    expect(store.get('comment', PROVISIONAL)?.body).toBe('First thing');
  });

  it('does not resurrect a row the delta stream already delivered', () => {
    const store = storeWithStandIn();
    // The socket got there first: the real comment is already in the replica.
    store.applyChanges([
      {
        v: 1,
        type: 'comment',
        id: REAL,
        op: 'upsert',
        actor: { type: 'system' },
        payload: { ...serverComment(), actor: { type: 'user' } },
      } as Change,
    ]);

    settle(store, COMMENT_SPEC, { createComment: { comment: serverComment() } });

    expect([...store.commentIdsFor(ISSUE)]).toEqual([REAL]);
  });
});

/**
 * The half of the same bug that no reload is involved in.
 *
 * The socket pushes the server's row the instant the mutation commits, so on a machine busy
 * enough to slow the response down it lands first — and until the response gets back and
 * `settle` runs, the replica holds the stand-in and the real row at once and the issue shows
 * one comment twice. Holding the response by hand in `web/e2e/comments.spec.ts` turns that
 * from one run in five into every run.
 */
describe('adopt', () => {
  async function outboxWith(reconcile: Reconciliation | undefined): Promise<Outbox> {
    const outbox = new Outbox();
    await outbox.append({
      mutation: 'CreateComment',
      variables: {},
      optimisticPatch: [
        { type: 'comment', id: PROVISIONAL, before: null, after: provisionalComment() },
      ],
      reconcile,
    });
    return outbox;
  }

  function delta(payload: Record<string, unknown>, id = REAL): Change {
    return {
      v: 1,
      type: 'comment',
      id,
      op: 'upsert',
      actor: { type: 'user' },
      payload,
    } as unknown as Change;
  }

  const MATCHED: Reconciliation = { ...COMMENT_SPEC, match: ['issueId', 'parentId', 'body'] };

  it('retires the stand-in when the delta carries the same row', async () => {
    const store = storeWithStandIn();
    const changes = [delta({ ...serverComment(), actor: { type: 'user' } })];
    store.applyChanges(changes);

    adopt(store, await outboxWith(MATCHED), changes);

    expect(store.get('comment', PROVISIONAL)).toBeUndefined();
    expect([...store.commentIdsFor(ISSUE)]).toEqual([REAL]);
  });

  it('pairs a root comment whose parent is undefined here and null on the wire', async () => {
    const store = storeWithStandIn();
    // Postgres spells an absent parent `null`; the stand-in was built in TypeScript, where
    // it is `undefined`. A `===` between those is what would break every root comment.
    const changes = [delta({ ...serverComment(), parentId: null, actor: { type: 'user' } })];
    store.applyChanges(changes);

    adopt(store, await outboxWith(MATCHED), changes);

    expect(store.get('comment', PROVISIONAL)).toBeUndefined();
  });

  it('leaves somebody else’s comment alone', async () => {
    const store = storeWithStandIn();
    const changes = [
      delta({ ...serverComment(), body: 'Something else', actor: { type: 'user' } }),
    ];
    store.applyChanges(changes);

    adopt(store, await outboxWith(MATCHED), changes);

    expect(store.get('comment', PROVISIONAL)?.body).toBe('First thing');
  });

  it('does nothing for a mutation that declared no pairing fields', async () => {
    const store = storeWithStandIn();
    const changes = [delta({ ...serverComment(), actor: { type: 'user' } })];
    store.applyChanges(changes);

    adopt(store, await outboxWith(COMMENT_SPEC), changes);

    expect(store.get('comment', PROVISIONAL)?.body).toBe('First thing');
  });

  it('claims one stand-in per row, not every stand-in that looks alike', async () => {
    // The same body twice in a row is a real thing people do — "+1", "same here" — and
    // collapsing both onto the first delta would delete a comment that exists.
    const second = '01900000-0000-7000-8000-0000000000f3';
    const store = storeWithStandIn();
    store.applyOptimistic([
      { type: 'comment', id: second, before: null, after: { ...provisionalComment(), id: second } },
    ]);

    const outbox = new Outbox();
    await outbox.append({
      mutation: 'CreateComment',
      variables: {},
      reconcile: MATCHED,
    });
    await outbox.append({
      mutation: 'CreateComment',
      variables: {},
      reconcile: { ...MATCHED, provisionalId: second },
    });

    const changes = [delta({ ...serverComment(), actor: { type: 'user' } })];
    store.applyChanges(changes);
    adopt(store, outbox, changes);

    expect(store.get('comment', PROVISIONAL)).toBeUndefined();
    expect(store.get('comment', second)?.body).toBe('First thing');
  });

  it('is inert once the response has already settled the pairing', async () => {
    const store = storeWithStandIn();
    settle(store, MATCHED, { createComment: { comment: serverComment() } });

    const changes = [delta({ ...serverComment(), actor: { type: 'user' } })];
    store.applyChanges(changes);
    adopt(store, await outboxWith(MATCHED), changes);

    expect([...store.commentIdsFor(ISSUE)]).toEqual([REAL]);
  });
});
