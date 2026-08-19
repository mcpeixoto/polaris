/**
 * The sidebar, and the two questions it answers that are not merely presentational.
 *
 * **Which saved views may this person see.** A view with an owner is private to that owner.
 * The replica holds whatever the sync stream delivered, and the stream is scoped by team
 * rather than by view ownership — so "do not render somebody else's private view" is a
 * decision the client makes, and a decision the client makes is one a test has to hold it to.
 * This is the only place in the product where a client-side filter is the thing standing
 * between one person's private view and another person's sidebar.
 *
 * **What a favourite points at.** A favourite is a `(kind, targetId)` pair with no copy of
 * the target's name, so every row is a lookup — and a lookup that misses is the ordinary
 * case, not an edge one: the target may have been deleted, or may be in a team this person
 * has since left. A row with a blank name that navigates nowhere is worse than one fewer row.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { AppShell } from './AppShell';
import { EngineProvider } from './context';
import { KeymapProvider } from './keymap';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const VIEWER = '01900000-0000-7000-8000-000000000002';
const OTHER = '01900000-0000-7000-8000-000000000003';
const TEAM = '01900000-0000-7000-8000-000000000004';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => null,
}));

function seeded(extra: readonly [string, Entity][] = []): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
    [
      'workspace',
      {
        id: WORKSPACE,
        name: 'Polaris',
        urlKey: 'polaris',
        plan: 'free',
        createdAt: AT,
        updatedAt: AT,
      },
    ] as [string, Entity],
    [
      'team',
      {
        id: TEAM,
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
      },
    ] as [string, Entity],
    ...extra,
  ];

  store.applyChanges(
    rows.map(([type, payload], index) => ({
      v: index + 1,
      type,
      id: (payload as { id: string }).id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload,
    })) as Change[],
  );
  return store;
}

function view(id: string, name: string, ownerId?: string): [string, Entity] {
  return [
    'view',
    {
      id,
      workspaceId: WORKSPACE,
      name,
      ...(ownerId === undefined ? null : { ownerId }),
      filter: { conj: 'and', nodes: [] },
      display: {},
      position: 'V',
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity,
  ];
}

function favorite(id: string, kind: string, targetId: string, position = 'V'): [string, Entity] {
  return [
    'favorite',
    {
      id,
      workspaceId: WORKSPACE,
      userId: VIEWER,
      kind,
      targetId,
      position,
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity,
  ];
}

function renderShell(store: Store) {
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <AppShell>
            <div />
          </AppShell>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('the saved views in the sidebar', () => {
  it('shows a shared view and the viewer’s own private one', () => {
    renderShell(seeded([view('v-shared', 'All bugs'), view('v-mine', 'My triage', VIEWER)]));
    expect(screen.getByRole('link', { name: 'All bugs' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'My triage' })).toBeTruthy();
  });

  it('does not show somebody else’s private view', () => {
    renderShell(seeded([view('v-theirs', 'Their triage', OTHER)]));
    // The replica may well hold it — the stream is scoped by team, not by view ownership —
    // so this is the client's decision and not the server's.
    expect(screen.queryByRole('link', { name: 'Their triage' })).toBeNull();
  });

  it('does not show an archived view', () => {
    const archived = view('v-old', 'Last quarter');
    (archived[1] as unknown as Record<string, unknown>)['archivedAt'] = AT;
    renderShell(seeded([archived]));
    expect(screen.queryByRole('link', { name: 'Last quarter' })).toBeNull();
  });

  it('omits the section entirely when there is nothing in it', () => {
    renderShell(seeded());
    expect(screen.queryByRole('heading', { name: 'Views' })).toBeNull();
  });
});

describe('the favourites in the sidebar', () => {
  it('names a favourited view and links to it', () => {
    renderShell(seeded([view('v-1', 'All bugs'), favorite('f-1', 'view', 'v-1')]));
    const link = screen.getByRole('link', { name: 'All bugs' });
    expect(link.getAttribute('href')).toBe('/view/v-1');
  });

  it('drops a favourite whose target is not in the replica rather than rendering a blank row', () => {
    renderShell(seeded([favorite('f-2', 'view', 'v-missing')]));
    // The section disappears with its only row. A sidebar entry with no name that navigates
    // nowhere is worse than one fewer entry, and the server's delta removes the row soon.
    expect(screen.queryByRole('heading', { name: 'Favourites' })).toBeNull();
  });

  it('renders favourites in their stored order rather than insertion order', () => {
    renderShell(
      seeded([
        view('v-a', 'Second', undefined),
        view('v-b', 'First', undefined),
        favorite('f-a', 'view', 'v-a', 'W'),
        favorite('f-b', 'view', 'v-b', 'V'),
      ]),
    );
    const names = screen
      .getAllByRole('link')
      .map((link) => link.textContent ?? '')
      .filter((text) => text === 'First' || text === 'Second');
    expect(names).toEqual(['First', 'Second']);
  });

  it('does not also list a favourited view under Views', () => {
    renderShell(seeded([view('v-1', 'All bugs'), favorite('f-1', 'view', 'v-1')]));
    // Favouriting moves a view rather than duplicating it. Two identical links in one sidebar
    // make somebody check whether they go to the same place.
    expect(screen.getAllByRole('link', { name: 'All bugs' })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Views' })).toBeNull();
  });
});

describe('the settings section', () => {
  /** Only this level can prove every screen built for M1 is actually reachable. */
  it('links to every workspace screen', () => {
    renderShell(seeded());
    for (const name of ['Members', 'Labels', 'Notifications', 'Templates', 'API keys', 'Trash']) {
      expect(screen.getByRole('link', { name }), `${name} is not reachable`).toBeTruthy();
    }
    for (const name of ['My Issues', 'Inbox', 'Search']) {
      expect(screen.getByRole('link', { name }), `${name} is not reachable`).toBeTruthy();
    }
  });
});
