import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Reaction } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Reactions } from './Reactions';

const AT = '2026-01-01T00:00:00Z';

function reaction(id: string, emoji: string, userId: string, at = AT): Reaction {
  return { id, workspaceId: 'w1', commentId: 'c1', userId, emoji, createdAt: at };
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

const NAMES = { u1: 'Ada', u2: 'Grace' };

function mounted(store: Store, viewerId: string | null = 'u1') {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Reactions
            commentId="c1"
            viewerId={viewerId}
            names={NAMES}
            subject="the comment from Ada"
          />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate };
}

describe('Reactions', () => {
  it('draws a pill per emoji with its count, from the replica', () => {
    mounted(seeded(reaction('r1', '👍', 'u1'), reaction('r2', '👍', 'u2')));
    const pill = screen.getByRole('button', { name: /thumbs up/i });
    expect(pill.textContent).toBe('👍2');
    expect(pill.getAttribute('aria-pressed')).toBe('true');
    expect(pill.getAttribute('aria-label')).toContain('Ada and Grace reacted');
  });

  it('is not pressed when the viewer is not one of the reactors', () => {
    mounted(seeded(reaction('r2', '👍', 'u2')));
    expect(screen.getByRole('button', { name: /thumbs up/i }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('toggles the viewer’s own reaction off when the pill is clicked', async () => {
    const { mutate } = mounted(seeded(reaction('r1', '👍', 'u1')));
    await userEvent.click(screen.getByRole('button', { name: /thumbs up/i }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      variables: { commentId: 'c1', emoji: '👍' },
      optimistic: [{ id: 'r1', after: null }],
    });
  });

  it('adds one from the picker, and closes it again', async () => {
    const { mutate } = mounted(seeded());
    const trigger = screen.getByRole('button', { name: 'React to the comment from Ada' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Celebration' }));

    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      variables: { commentId: 'c1', emoji: '🎉' },
      optimistic: [{ before: null }],
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    mounted(seeded());
    const trigger = screen.getByRole('button', { name: 'React to the comment from Ada' });
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when the next click lands somewhere else', async () => {
    mounted(seeded());
    await userEvent.click(screen.getByRole('button', { name: 'React to the comment from Ada' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await userEvent.click(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows nothing at all when there is no viewer and no reaction', () => {
    const { container } = render(
      <MemoryRouter>
        <KeymapProvider>
          <EngineProvider
            engine={{ store: seeded(), mutate: vi.fn() } as unknown as SyncEngine}
            status={{ phase: 'idle' }}
          >
            <Reactions commentId="c1" viewerId={null} names={NAMES} subject="the comment" />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );
    expect(container.textContent).toBe('');
  });
});
