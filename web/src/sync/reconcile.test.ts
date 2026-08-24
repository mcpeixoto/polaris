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

import {
  Outbox,
  Store,
  type Change,
  type Entity,
  type EntityPatch,
  type Reconciliation,
} from '~/store';

import { adopt, settle, unpairedCreates } from './reconcile';

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

/**
 * The check that stops a sixth feature shipping the fifth feature's bug.
 *
 * It reads what the call site actually did rather than what it says it did: an optimistic
 * create is `before: null`, and an id the server never saw is one that is nowhere in the
 * variables. A create that is both and declares no pairing has no way back — not on a race,
 * but on every reload, every navigation and every response that does not come.
 */
describe('succession', () => {
  it('names what the response called the row', () => {
    const store = storeWithStandIn();

    const succeeded = settle(store, COMMENT_SPEC, { createComment: { comment: serverComment() } });

    // Retiring the stand-in is enough for anything that only draws the replica. It is not
    // enough for a reply composer, which is holding the old id and has to be told the new
    // one — see `SyncEngine.succession`.
    expect(succeeded).toEqual([{ type: 'comment', provisionalId: PROVISIONAL, realId: REAL }]);
  });

  it('names what the delta stream called the row', async () => {
    const outbox = new Outbox();
    await outbox.append({
      mutation: 'CreateComment',
      variables: {},
      optimisticPatch: [
        { type: 'comment', id: PROVISIONAL, before: null, after: provisionalComment() },
      ],
      reconcile: { ...COMMENT_SPEC, match: ['issueId', 'parentId', 'body'] },
    });
    const store = storeWithStandIn();
    const changes = [
      {
        v: 1,
        type: 'comment',
        id: REAL,
        op: 'upsert',
        actor: { type: 'user' },
        payload: { ...serverComment(), actor: { type: 'user' } },
      } as unknown as Change,
    ];
    store.applyChanges(changes);

    // The socket usually gets here first, and a caller holding the old id must not have to
    // know which route retired it.
    expect(adopt(store, outbox, changes)).toEqual([
      { type: 'comment', provisionalId: PROVISIONAL, realId: REAL },
    ]);
  });

  it('reports nothing when the id did not change', () => {
    const store = new Store(WORKSPACE);
    store.applyOptimistic([
      { type: 'comment', id: REAL, before: null, after: { ...provisionalComment(), id: REAL } },
    ]);

    expect(
      settle(
        store,
        { ...COMMENT_SPEC, provisionalId: REAL },
        {
          createComment: { comment: serverComment() },
        },
      ),
    ).toEqual([]);
  });
});

describe('unpairedCreates', () => {
  const standIn = {
    type: 'comment',
    id: PROVISIONAL,
    before: null,
    after: provisionalComment(),
  } as const satisfies EntityPatch;

  it('flags a create under an id the server never sees', () => {
    const loose = unpairedCreates({
      variables: { input: { issueId: ISSUE, body: 'First thing' } },
      optimistic: [standIn],
    });
    expect(loose.map((entry) => entry.id)).toEqual([PROVISIONAL]);
  });

  it('accepts it once the pairing is declared', () => {
    expect(
      unpairedCreates({
        variables: { input: { issueId: ISSUE, body: 'First thing' } },
        optimistic: [standIn],
        reconcile: COMMENT_SPEC,
      }),
    ).toEqual([]);
  });

  it('accepts one spec out of a list, and each id in it', () => {
    const second = { ...standIn, id: REAL, after: { ...provisionalComment(), id: REAL } };
    expect(
      unpairedCreates({
        variables: {},
        optimistic: [standIn, second],
        reconcile: [COMMENT_SPEC, { ...COMMENT_SPEC, provisionalId: REAL }],
      }),
    ).toEqual([]);
    // …and still flags the one the list forgot.
    expect(
      unpairedCreates({ variables: {}, optimistic: [standIn, second], reconcile: [COMMENT_SPEC] }),
    ).toHaveLength(1);
  });

  it('accepts a create whose id the client minted and sent', () => {
    // `createIssue`. Nothing to pair, because the response upserts over the same key — and
    // this is what would start failing the day somebody stopped sending the id.
    expect(
      unpairedCreates({
        variables: { input: { id: PROVISIONAL, title: 'Ship it' } },
        optimistic: [standIn],
      }),
    ).toEqual([]);
  });

  it('accepts a dependent named by the spec it hangs off', () => {
    const join = {
      type: 'issueLabel',
      id: REAL,
      before: null,
      after: { id: REAL } as Entity,
    } as const satisfies EntityPatch;
    expect(
      unpairedCreates({
        variables: {},
        optimistic: [standIn, join],
        reconcile: { ...COMMENT_SPEC, dependents: [{ type: 'issueLabel', id: REAL }] },
      }),
    ).toEqual([]);
  });

  it('says nothing about an update or a delete', () => {
    expect(
      unpairedCreates({
        variables: {},
        optimistic: [
          { type: 'comment', id: PROVISIONAL, before: provisionalComment(), after: null },
          {
            type: 'comment',
            id: PROVISIONAL,
            before: provisionalComment(),
            after: provisionalComment(),
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe('settle, for a stand-in the response does not carry', () => {
  const DELTA_ONLY: Reconciliation = {
    type: 'comment',
    provisionalId: PROVISIONAL,
    match: ['issueId', 'body'],
  };

  // A path-less spec pairs off the delta stream — but the window in which it can do that
  // closes when the op leaves the outbox. So a confirmed mutation retires the stand-in
  // itself: the server holds the real row, the stream is carrying it, and a stand-in that
  // outlives the pairing is a row on the screen for good.
  it('retires the stand-in when the mutation is confirmed', () => {
    const store = storeWithStandIn();
    settle(store, DELTA_ONLY, { createIssue: { issue: { id: REAL } } });
    expect(store.get('comment', PROVISIONAL)).toBeUndefined();
  });

  it('does nothing when the delta already retired it', () => {
    const store = new Store(WORKSPACE);
    settle(store, DELTA_ONLY, {});
    expect(store.get('comment', PROVISIONAL)).toBeUndefined();
  });

  it('takes the rows hanging off a stand-in with it', () => {
    const store = storeWithStandIn();
    const join = '01900000-0000-7000-8000-0000000000f9';
    store.applyOptimistic([
      {
        type: 'issueLabel',
        id: join,
        before: null,
        after: { id: join, workspaceId: WORKSPACE, issueId: ISSUE } as Entity,
      },
    ]);

    settle(
      store,
      { ...COMMENT_SPEC, dependents: [{ type: 'issueLabel', id: join }] },
      { createComment: { comment: serverComment() } },
    );

    expect(store.get('comment', PROVISIONAL)).toBeUndefined();
    expect(store.get('issueLabel', join)).toBeUndefined();
    expect(store.get('comment', REAL)?.id).toBe(REAL);
  });
});
