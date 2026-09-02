/**
 * The documents list: what it says while the snapshot is still arriving, and whether its
 * one call to action still works when the copy on the button beside it changes.
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import { ApiError } from '~/sync/api';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { Documents } from './Documents';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const TEAM = 't1';
const AT = '2026-01-01T00:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: VIEWER },
    payload: entity,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'team', {
      id: TEAM,
      workspaceId: WORKSPACE,
      key: 'ENG',
      name: 'Engineering',
      private: false,
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity),
  ]);
  return store;
}

afterEach(cleanup);

function mount(store: Store, mutate: ReturnType<typeof vi.fn>, status: EngineStatus) {
  render(
    <MemoryRouter initialEntries={['/team/ENG/documents']}>
      <KeymapProvider>
        <EngineProvider engine={{ store, mutate } as unknown as SyncEngine} status={status}>
          <Routes>
            <Route path="/team/:teamKey/documents" element={<Documents />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup() };
}

describe('Documents', () => {
  it('does not claim a team has no documents while the snapshot is still arriving', () => {
    mount(seeded(), vi.fn(), { phase: 'bootstrapping', received: 2 });

    expect(screen.getByRole('status').textContent).toBe('Loading documents…');
    expect(screen.queryByText('No documents yet')).toBeNull();
  });

  it('focuses the composer from the empty state without going looking for a placeholder', async () => {
    const { user } = mount(seeded(), vi.fn(), { phase: 'idle' });

    await user.click(screen.getByRole('button', { name: 'Create a document' }));

    expect(document.activeElement).toBe(screen.getByLabelText('New document title'));
  });

  it('says so when the server refuses a new document', async () => {
    const mutate = vi.fn().mockRejectedValue(new ApiError('VALIDATION', 'that title is taken'));
    const { user } = mount(seeded(), mutate, { phase: 'idle' });

    await user.type(screen.getByLabelText('New document title'), 'Runbook');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect((await screen.findByRole('alert')).textContent).toBe('that title is taken');
  });
});
