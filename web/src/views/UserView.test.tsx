/**
 * A person's page, and the two ways it can have no person.
 *
 * The profile is a replicated row, so "they have left the workspace" and "their row has not
 * arrived yet" were the same answer to `useLiveQuery` — and the screen picked the first one,
 * on every cold start, for everybody. The list itself is `IssueList`'s and is stubbed here:
 * what this file is about is which of the three things this screen decides to draw.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type User } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { UserView } from './UserView';

vi.mock('./IssueList', () => ({
  IssueList: ({ heading }: { heading?: string }) => <p>list for {heading}</p>,
}));

const WORKSPACE = 'w1';
const ADA = 'u-ada';
const AT = '2026-01-01T00:00:00.000Z';

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const payload: User = {
    id: ADA,
    workspaceId: WORKSPACE,
    name: 'ada',
    displayName: 'Ada Lovelace',
    timezone: 'Europe/Lisbon',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  };
  store.applyChanges([
    { v: 1, type: 'user', id: ADA, op: 'upsert', actor: { type: 'system' }, payload } as Change,
  ]);
  return store;
}

function mount(store: Store, status: EngineStatus = { phase: 'idle' }) {
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/user/${ADA}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={status}>
          <Routes>
            <Route path="/user/:userId" element={<UserView />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('UserView', () => {
  it('waits while the replica is still filling', () => {
    mount(new Store(WORKSPACE), { phase: 'hydrating' });

    expect(screen.queryByText('No such person')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading this person');
  });

  it('says there is no such person once the store has settled', () => {
    mount(new Store(WORKSPACE));

    expect(screen.getByText('No such person')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeTruthy();
  });

  it('lists the person’s work under their name once the row is there', () => {
    mount(seeded());

    expect(screen.getByText('list for Ada Lovelace')).toBeTruthy();
  });
});
