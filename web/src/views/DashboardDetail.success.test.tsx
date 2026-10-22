/**
 * A dashboard cannot be restored — there is no `restoreDashboard` — so there is no undo
 * offer to carry the news that it is gone. What the screen did instead was navigate to the
 * list, which is also what a refused delete looked like before `DashboardDetail.test.tsx`'s
 * second case was written. The confirmation is the only thing that tells the two apart.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { clearToasts, ToastHost } from '~/features/toast/ToastHost';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { DashboardDetail } from './DashboardDetail';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const DASH = 'db1';
const AT = '2026-01-01T00:00:00.000Z';

afterEach(() => {
  // Unmount first. `clearToasts` publishes to a module-level store, and doing that while the
  // host is still mounted is a React update outside `act`.
  cleanup();
  clearToasts();
});

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const change: Change = {
    v: 1,
    type: 'dashboard',
    id: DASH,
    op: 'upsert',
    actor: { type: 'user', id: VIEWER },
    payload: {
      id: DASH,
      workspaceId: WORKSPACE,
      name: 'Delivery',
      description: '',
      filter: { kind: 'and', clauses: [] },
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity,
  };
  store.applyChanges([change]);
  return store;
}

describe('deleting a dashboard', () => {
  it('says what was deleted, by name', async () => {
    const store = seeded();
    const mutate = vi.fn().mockResolvedValue({});
    render(
      <MemoryRouter initialEntries={[`/dashboard/${DASH}`]}>
        <KeymapProvider>
          <EngineProvider
            engine={{ store, mutate } as unknown as SyncEngine}
            status={{ phase: 'idle' }}
          >
            <Routes>
              <Route path="/dashboard/:dashboardId" element={<DashboardDetail />} />
              <Route path="/dashboards" element={<p>the list</p>} />
            </Routes>
            <ToastHost />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    // Politely: a confirmation that interrupts a screen reader to say something went right
    // is the behaviour `ToastHost` splits its two regions to avoid.
    expect((await screen.findByRole('status')).textContent).toContain('Deleted Delivery');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
