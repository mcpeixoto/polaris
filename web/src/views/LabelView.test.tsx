/**
 * A label's page, and the difference between a label that was archived and one that has not
 * replicated yet.
 *
 * Same trap as the profile page: the label is a replicated row, and a bookmarked label URL
 * opened on a cold start said "No such label" about a row still arriving. The issue list is
 * stubbed — this is about which of the three states the screen picks.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { LabelView } from './LabelView';

vi.mock('./IssueList', () => ({
  IssueList: () => <p>the label’s issues</p>,
}));

const WORKSPACE = 'w1';
const LABEL = 'l-bug';
const AT = '2026-01-01T00:00:00.000Z';

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    {
      v: 1,
      type: 'label',
      id: LABEL,
      op: 'upsert',
      actor: { type: 'system' },
      payload: {
        id: LABEL,
        workspaceId: WORKSPACE,
        name: 'bug',
        color: '#888888',
        createdAt: AT,
        updatedAt: AT,
      },
    } as Change,
  ]);
  return store;
}

function mount(store: Store, status: EngineStatus = { phase: 'idle' }) {
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/label/${LABEL}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={status}>
          <Routes>
            <Route path="/label/:labelId" element={<LabelView />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('LabelView', () => {
  it('waits while the replica is still filling', () => {
    mount(new Store(WORKSPACE), { phase: 'hydrating' });

    expect(screen.queryByText('No such label')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading this label');
  });

  it('says there is no such label once the store has settled', () => {
    mount(new Store(WORKSPACE));

    expect(screen.getByText('No such label')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeTruthy();
  });

  it('lists the label’s issues once the row is there', () => {
    mount(seeded());

    expect(screen.getByText('the label’s issues')).toBeTruthy();
  });
});
