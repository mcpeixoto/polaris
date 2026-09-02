import { describe, expect, it, vi } from 'vitest';

import { Store, type Change, type Reaction } from '~/store';
import { ApiError } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { addReaction, reactionOf, removeReaction, toggleReaction } from './mutations';

const AT = '2026-01-01T00:00:00Z';

function reaction(id: string, emoji: string, userId: string): Reaction {
  return {
    id,
    workspaceId: 'w1',
    commentId: 'c1',
    userId,
    emoji,
    createdAt: AT,
  };
}

function seeded(...rows: readonly Reaction[]): Store {
  const store = new Store('w1');
  store.applyChanges(
    rows.map(
      (row, index) =>
        ({
          v: index + 1,
          type: 'reaction',
          id: row.id,
          op: 'upsert',
          actor: { type: 'system' },
          payload: row,
        }) as Change,
    ),
  );
  return store;
}

function engineOver(store: Store, mutate = vi.fn().mockResolvedValue({})): SyncEngine {
  return { store, mutate } as unknown as SyncEngine;
}

describe('addReaction', () => {
  it('renders the reaction before the server answers, and declares how the two meet', async () => {
    const store = seeded();
    const mutate = vi.fn().mockResolvedValue({});
    await addReaction(engineOver(store, mutate), 'c1', '👍', 'u1');

    const [call] = mutate.mock.calls as [
      [
        {
          variables: Record<string, unknown>;
          optimistic: { type: string; id: string; before: unknown; after: Reaction }[];
          reconcile: { type: string; provisionalId: string; path: string[]; match: string[] };
        },
      ],
    ];
    const input = call[0];

    expect(input.variables).toEqual({ commentId: 'c1', emoji: '👍' });
    expect(input.optimistic).toHaveLength(1);
    expect(input.optimistic[0]?.before).toBeNull();
    expect(input.optimistic[0]?.after).toMatchObject({
      commentId: 'c1',
      emoji: '👍',
      userId: 'u1',
      workspaceId: 'w1',
    });

    // The server mints the id, so the stand-in has to be paired off the response and off the
    // delta stream — without this the reaction is written twice and neither copy ever goes.
    expect(input.reconcile.provisionalId).toBe(input.optimistic[0]?.id);
    expect(input.reconcile.path).toEqual(['addReaction', 'reaction']);
    expect(input.reconcile.match).toEqual(['commentId', 'userId', 'emoji']);
  });

  it('does nothing when this person has already reacted with it', async () => {
    const store = seeded(reaction('r1', '👍', 'u1'));
    const mutate = vi.fn().mockResolvedValue({});
    await addReaction(engineOver(store, mutate), 'c1', '👍', 'u1');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('keeps the pill when the request never left the machine', async () => {
    const store = seeded();
    const mutate = vi.fn(async () => {
      throw new ApiError('NETWORK', 'offline');
    });
    await expect(addReaction(engineOver(store, mutate), 'c1', '👍', 'u1')).resolves.toBeUndefined();
  });
});

describe('removeReaction', () => {
  it('takes the viewer’s own row off, and nobody else’s', async () => {
    const store = seeded(reaction('r1', '👍', 'u1'), reaction('r2', '👍', 'u2'));
    const mutate = vi.fn().mockResolvedValue({});
    await removeReaction(engineOver(store, mutate), 'c1', '👍', 'u1');

    const input = (mutate.mock.calls[0] as [{ optimistic: { id: string; after: unknown }[] }])[0];
    expect(input.optimistic).toHaveLength(1);
    expect(input.optimistic[0]?.id).toBe('r1');
    expect(input.optimistic[0]?.after).toBeNull();
  });

  it('is a no-op when there is nothing of the viewer’s to remove', async () => {
    const store = seeded(reaction('r2', '👍', 'u2'));
    const mutate = vi.fn().mockResolvedValue({});
    await removeReaction(engineOver(store, mutate), 'c1', '👍', 'u1');
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('toggleReaction', () => {
  it('adds when the viewer is not in it and removes when they are', async () => {
    const empty = vi.fn().mockResolvedValue({});
    await toggleReaction(engineOver(seeded(), empty), 'c1', '🎉', 'u1');
    expect(empty.mock.calls[0]?.[0]).toMatchObject({
      optimistic: [{ before: null }],
    });

    const mine = vi.fn().mockResolvedValue({});
    await toggleReaction(engineOver(seeded(reaction('r1', '🎉', 'u1')), mine), 'c1', '🎉', 'u1');
    expect(mine.mock.calls[0]?.[0]).toMatchObject({ optimistic: [{ id: 'r1', after: null }] });
  });
});

describe('the replica index', () => {
  it('finds a comment’s reactions without scanning the workspace', () => {
    const store = seeded(reaction('r1', '👍', 'u1'), reaction('r2', '❤️', 'u2'));
    expect([...store.reactionIdsFor('c1')].sort()).toEqual(['r1', 'r2']);
    expect(store.reactionIdsFor('c2').size).toBe(0);
    expect(reactionOf(engineOver(store), 'c1', '👍', 'u1')?.id).toBe('r1');
    expect(reactionOf(engineOver(store), 'c1', '👍', 'u2')).toBeUndefined();
  });

  it('drops a row from the index when it is deleted', () => {
    const store = seeded(reaction('r1', '👍', 'u1'));
    store.applyChanges([
      { v: 2, type: 'reaction', id: 'r1', op: 'delete', actor: { type: 'system' } } as Change,
    ]);
    expect(store.reactionIdsFor('c1').size).toBe(0);
  });
});
