/**
 * The dashboards list: the scope it computes is the group it draws, the row says who owns it
 * and when it was last touched, and the keyboard reaches all of it.
 *
 * The scope was computed and then spent entirely on the sort — three kinds of page in one
 * undifferentiated alphabet — so the grouping is the assertion that matters most here.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { EMPTY_FILTER } from '~/filter';
import { Store, type Change, type Dashboard, type Team, type User } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { Dashboards } from './Dashboards';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewerRole: () => 'admin',
}));

function change(v: number, type: string, payload: { id: string }): Change {
  return {
    v,
    type,
    id: payload.id,
    op: 'upsert',
    actor: { type: 'system' },
    payload,
  } as Change;
}

function team(): Team {
  return {
    id: 't1',
    workspaceId: WORKSPACE,
    key: 'ENG',
    name: 'Engineering',
    timezone: 'Europe/Lisbon',
    private: false,
    estimateScale: 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: false,
    cycleDurationWeeks: 1,
    cycleCooldownWeeks: 0,
    cycleStartDay: 'monday',
    cycleUpcomingCount: 2,
    cycleAutoAddStarted: false,
    cycleAutoAddCompleted: false,
    triageEnabled: false,
    triageRequirePriority: false,
    autoCloseDays: 0,
    autoArchiveDays: 0,
    autoCloseParent: false,
    autoCloseChildren: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function viewer(): User {
  return {
    id: VIEWER,
    workspaceId: WORKSPACE,
    name: 'ada',
    displayName: 'Ada Lovelace',
    timezone: 'Europe/Lisbon',
    role: 'admin',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  };
}

function dashboard(id: string, name: string, scope: Partial<Dashboard> = {}): Dashboard {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    description: '',
    filter: EMPTY_FILTER,
    sortOrder: 'V',
    createdAt: AT,
    updatedAt: AT,
    ...scope,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    change(1, 'team', team()),
    change(2, 'user', viewer()),
    change(3, 'dashboard', dashboard('d-mine', 'My burn-up', { ownerId: VIEWER })),
    change(4, 'dashboard', dashboard('d-all', 'Everything')),
    change(5, 'dashboard', dashboard('d-team', 'Engineering health', { teamId: 't1' })),
  ]);
  return store;
}

function mount(store: Store, status: EngineStatus = { phase: 'idle' }) {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/dashboards']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={status}>
          <Routes>
            <Route path="/dashboards" element={<Dashboards />} />
            <Route path="/dashboard/:id" element={<p>opened</p>} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

afterEach(cleanup);

describe('Dashboards loading', () => {
  it('waits while the replica is still filling', () => {
    mount(new Store(WORKSPACE), { phase: 'hydrating' });

    expect(screen.queryByText('No dashboards yet')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Loading dashboards');
  });

  it('offers the first dashboard once the store has settled', () => {
    mount(new Store(WORKSPACE));

    expect(screen.getByText('No dashboards yet')).toBeTruthy();
  });
});

describe('Dashboards groups', () => {
  it('draws the scope it sorts by, rather than only sorting by it', () => {
    mount(seeded());

    for (const name of ['Personal', 'Workspace', 'ENG']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeTruthy();
    }
  });

  it('says who owns a row and when it was last touched', () => {
    mount(seeded());

    const row = screen.getByRole('link', { name: /My burn-up/ });
    expect(within(row).getByText('Ada Lovelace')).toBeTruthy();
    // A dashboard nobody owns belongs to the workspace, which is worth saying.
    expect(
      within(screen.getByRole('link', { name: /Everything/ })).getByText('Everyone'),
    ).toBeTruthy();
  });
});

describe('Dashboards keyboard and row actions', () => {
  it('moves a cursor with j and k and opens the row under it', async () => {
    const { user } = mount(seeded());

    await user.keyboard('j');
    expect(screen.getAllByRole('option')[1]?.getAttribute('data-cursor')).toBe('');

    await user.keyboard('k');
    expect(screen.getAllByRole('option')[0]?.getAttribute('data-cursor')).toBe('');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('opened')).toBeTruthy());
  });

  it('offers rename, duplicate and delete on a right-click as well as on the button', async () => {
    const { user } = mount(seeded());

    const row = screen.getByRole('link', { name: /Everything/ }).closest('[role="option"]');
    await user.pointer({ target: row as HTMLElement, keys: '[MouseRight]' });

    const menu = await screen.findByRole('menu', { name: 'Options for Everything' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
      // No Favourite: `FavoriteKind` has no dashboard, so a star here could write nothing.
      // Rename carries its chord, `e`, the way every menu in the product hints one.
    ).toEqual(['RenameE', 'Duplicate', 'Delete']);
  });

  it('renames in place, and writes only when the name really changed', async () => {
    const { mutate, user } = mount(seeded());

    await user.click(screen.getByRole('button', { name: 'Options for Everything' }));
    await user.click(await screen.findByRole('menuitem', { name: /^Rename/ }));

    const field = screen.getByRole('textbox', { name: 'Rename Everything' });
    await user.clear(field);
    await user.type(field, 'Everything, revised');
    await user.tab();

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({
      input: { id: 'd-all', name: 'Everything, revised' },
    });
  });

  it('asks before deleting, and sends nothing until it is answered', async () => {
    const { mutate, user } = mount(seeded());

    await user.click(screen.getByRole('button', { name: 'Options for Everything' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete Everything?' });
    expect(mutate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Delete dashboard' }));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
  });
});

/**
 * Duplicate and delete have no chord of their own; the menu holding them opened only under
 * a pointer. `.` is the keyboard's way into all three.
 */
describe('Dashboards row menu without a pointer', () => {
  it('opens on the cursor row when . is pressed', async () => {
    const { user } = mount(seeded());

    // The cursor starts on the first row of the first group, the personal dashboard.
    await user.keyboard('.');

    expect(await screen.findByRole('menu', { name: 'Options for My burn-up' })).toBeTruthy();
  });

  it('follows the cursor rather than the first row', async () => {
    const { user } = mount(seeded());

    await user.keyboard('j.');

    const menu = await screen.findByRole('menu', { name: 'Options for Everything' });
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
    expect(screen.queryByRole('menu', { name: 'Options for My burn-up' })).toBeNull();
  });
});
