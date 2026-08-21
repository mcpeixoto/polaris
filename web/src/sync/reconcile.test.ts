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

import { Store, type Change, type Entity, type Reconciliation } from '~/store';

import { settle } from './reconcile';

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
