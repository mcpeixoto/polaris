/**
 * The two writes the issue list's archive and manual-reorder gestures make.
 *
 * Both are about the same thing, from opposite ends: what the *replica* looks like between
 * the keystroke and the server's answer. A reorder that left `sortOrder` alone would put the
 * row straight back where it came from and then jump when the delta landed; an archive that
 * kept nothing would have no row for an undo to restore, because an archive is optimistically
 * a delete.
 */

import { describe, expect, it, vi } from 'vitest';

import { compareOrderKeys, Store, type Change, type Entity, type Issue } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { reorderIssue, unarchiveIssues } from './mutations';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const STATE = '01900000-0000-7000-8000-000000000003';
const AT = '2026-01-01T00:00:00.000Z';

const A = '01900000-0000-7000-8000-00000000000a';
const B = '01900000-0000-7000-8000-00000000000b';
const C = '01900000-0000-7000-8000-00000000000c';

function issue(id: string, number: number, sortOrder: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier: `ENG-${number}`,
    title: `Issue ${number}`,
    description: '',
    stateId: STATE,
    priority: 0,
    sortOrder,
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

/** Three issues in manual order: A, then B, then C. */
function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: Entity[] = [issue(A, 1, 'V'), issue(B, 2, 'W'), issue(C, 3, 'X')];
  store.applyChanges(
    rows.map((payload, index) => ({
      v: index + 1,
      type: 'issue',
      id: (payload as { id: string }).id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload,
    })) as Change[],
  );
  return store;
}

function harness() {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  return { store, mutate, engine: { store, mutate } as unknown as SyncEngine };
}

/** What the mutation asked the store to show while the request was out. */
function patched(mutate: ReturnType<typeof vi.fn>): Issue {
  return (mutate.mock.calls[0]?.[0] as { optimistic: { after: Issue }[] }).optimistic[0]!.after;
}

describe('reorderIssue', () => {
  it('names the neighbour rather than sending a key it minted', async () => {
    const { engine, mutate } = harness();

    await reorderIssue(engine, A, { afterId: B, beforeId: C });

    // The server mints the stored key. Sending one computed here would be two answers to the
    // same question the moment two people dragged into one gap.
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({
      input: { id: A, afterIssueId: B },
    });
  });

  it('says moveToTop when there is no row above', async () => {
    const { engine, mutate } = harness();

    await reorderIssue(engine, C, { afterId: null, beforeId: A });

    expect(mutate.mock.calls[0]?.[0].variables).toEqual({ input: { id: C, moveToTop: true } });
  });

  it('shows the row in its new place before the server answers', async () => {
    const { engine, mutate, store } = harness();

    await reorderIssue(engine, A, { afterId: B, beforeId: C });

    const after = patched(mutate);
    expect(compareOrderKeys(after.sortOrder, store.get('issue', B)!.sortOrder)).toBeGreaterThan(0);
    expect(compareOrderKeys(after.sortOrder, store.get('issue', C)!.sortOrder)).toBeLessThan(0);
  });

  it('mints past the end of the list', async () => {
    const { engine, mutate, store } = harness();

    await reorderIssue(engine, A, { afterId: C, beforeId: null });

    expect(
      compareOrderKeys(patched(mutate).sortOrder, store.get('issue', C)!.sortOrder),
    ).toBeGreaterThan(0);
  });

  it('writes nothing when the neighbours no longer straddle a gap', async () => {
    const { engine, mutate } = harness();

    // Somebody else's drag landed first, so the local order is stale. Minting a key anyway
    // would put the row somewhere neither person asked for.
    await reorderIssue(engine, A, { afterId: C, beforeId: B });

    expect(mutate).not.toHaveBeenCalled();
  });

  it('writes nothing for an issue the replica does not hold', async () => {
    const { engine, mutate } = harness();

    await reorderIssue(engine, '01900000-0000-7000-8000-0000000000ff', {
      afterId: A,
      beforeId: B,
    });

    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('unarchiveIssues', () => {
  it('puts back the row it was handed', async () => {
    const { engine, mutate, store } = harness();
    const row = store.get('issue', A)!;

    // What the archive did first: took the row out of the replica, matching the server's own
    // change for an archive. There is nothing left to read the row back from.
    store.applyChanges([
      { v: 100, type: 'issue', id: A, op: 'delete', actor: { type: 'system' } },
    ] as Change[]);

    await unarchiveIssues(engine, [row]);

    expect(mutate.mock.calls[0]?.[0].variables).toEqual({ id: A, archived: false });
    const patch = mutate.mock.calls[0]?.[0].optimistic[0];
    expect(patch.before, 'an upsert of a row the replica no longer has').toBeNull();
    expect(patch.after.id).toBe(A);
  });

  it('leaves alone an issue that is already back', async () => {
    const { engine, mutate, store } = harness();

    // Unarchived from another session while the toast was up. The snapshot in the closure
    // predates the archive, so writing it would undo everything done since.
    await unarchiveIssues(engine, [store.get('issue', A)!]);

    expect(mutate).not.toHaveBeenCalled();
  });
});
