/**
 * A dashboard was one ghost click away from being deleted, with no catch on the way out —
 * a refused delete navigated to the list anyway and left the dashboard in place. Its name
 * and its tiles' titles were stored fields nothing in the interface could write.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { DashboardDetail } from './DashboardDetail';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const DASH = 'db1';
const TILE = 'tl1';
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
    upsert(1, 'dashboard', {
      id: DASH,
      workspaceId: WORKSPACE,
      name: 'Delivery',
      description: '',
      filter: { kind: 'and', clauses: [] },
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity),
    upsert(2, 'dashboardTile', {
      id: TILE,
      workspaceId: WORKSPACE,
      dashboardId: DASH,
      title: '',
      measure: 'count',
      slice: 'assignee',
      display: 'chart',
      filter: { kind: 'and', clauses: [] },
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity),
  ]);
  return store;
}

afterEach(cleanup);

function mount(store: Store, mutate: ReturnType<typeof vi.fn>, status: EngineStatus) {
  render(
    <MemoryRouter initialEntries={[`/dashboard/${DASH}`]}>
      <KeymapProvider>
        <EngineProvider engine={{ store, mutate } as unknown as SyncEngine} status={status}>
          <Routes>
            <Route path="/dashboard/:dashboardId" element={<DashboardDetail />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup() };
}

function renderDashboard() {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  return { store, mutate, ...mount(store, mutate, { phase: 'idle' }) };
}

/** Every mutation the screen sent, by operation name. */
function sent(mutate: ReturnType<typeof vi.fn>): string[] {
  return mutate.mock.calls.map((call) => String((call[0] as { mutation: unknown }).mutation));
}

describe('DashboardDetail', () => {
  it('asks before deleting, and sends nothing until the question is answered', async () => {
    const { mutate, user } = renderDashboard();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/go for good/)).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('says so when the server refuses a delete, rather than navigating away regardless', async () => {
    const store = seeded();
    const mutate = vi.fn().mockRejectedValue(new Error('nope'));
    const { user } = mount(store, mutate, { phase: 'idle' });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    expect((await screen.findByRole('alert')).textContent).toBe('That could not be deleted.');
    // Still on the dashboard, which still exists.
    expect(screen.getByLabelText('Dashboard name')).toBeTruthy();
  });

  it('renames the dashboard from its own title', async () => {
    const { mutate, user } = renderDashboard();

    const name = screen.getByLabelText('Dashboard name');
    await user.clear(name);
    await user.type(name, 'Delivery health');
    await user.tab();

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(sent(mutate).join(' ')).toContain('UpdateDashboard');
  });

  it('writes a tile title, which no control could reach before', async () => {
    const { mutate, user } = renderDashboard();

    const title = screen.getByLabelText('Title');
    await user.type(title, 'Open by assignee');
    await user.tab();

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const input = mutate.mock.calls[0]![0] as { variables: { input: { title?: string } } };
    expect(input.variables.input.title).toBe('Open by assignee');
  });

  it('waits for the store to settle before calling a dashboard missing', () => {
    const store = new Store(WORKSPACE);
    mount(store, vi.fn(), { phase: 'bootstrapping', received: 1 });

    expect(screen.getByRole('status').textContent).toBe('Loading dashboard…');
    expect(screen.queryByText('No such dashboard')).toBeNull();
  });
});
