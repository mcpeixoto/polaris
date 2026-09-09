/**
 * The issue header's right-click, which is the ⋯ menu under another gesture.
 *
 * Both menus render one `headerMenuItems()` array, so the assertion that earns its keep is
 * not that either menu contains some particular entry — it is that the two lists are the
 * same list, in the same order. That is what breaks the day somebody adds an action to one
 * of the two call sites and forgets the other.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity, type OptimisticPatch, type UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { IssueDetail } from './IssueDetail';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const TODO = '01900000-0000-7000-8000-000000000003';
const ISSUE = '01900000-0000-7000-8000-000000000004' as UUID;
const VIEWER = '01900000-0000-7000-8000-000000000005' as UUID;
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, displayName: 'Ada', role: 'member' }),
  useViewerRole: () => 'member',
}));

// The feed is fetched, not replicated; an empty answer is enough for the chrome.
vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn(async () => ({ comments: [], issueHistory: [] })) };
});

afterEach(cleanup);

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, Entity][] = [
    [
      'team',
      {
        id: TEAM,
        workspaceId: WORKSPACE,
        key: 'ENG',
        name: 'Engineering',
        timezone: 'UTC',
        private: false,
        estimateScale: 'fibonacci',
        estimateAllowZero: false,
        estimateExtended: false,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'workflowState',
      {
        id: TODO,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        name: 'Todo',
        category: 'unstarted',
        position: 'a',
        isSystem: false,
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'user',
      {
        id: VIEWER,
        workspaceId: WORKSPACE,
        displayName: 'Ada',
        email: 'ada@example.com',
        role: 'member',
        kind: 'human',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
    [
      'issue',
      {
        id: ISSUE,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        number: 7,
        title: 'Ship the importer',
        description: '',
        priority: 0,
        stateId: TODO,
        creatorId: VIEWER,
        dueDateSource: 'manual',
        sortOrder: 'a',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    ],
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

function mount() {
  const store = seeded();
  const mutate = vi.fn(async (input: { optimistic?: OptimisticPatch }) => {
    if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
    return {};
  });
  const engine = {
    store,
    mutate,
    succession: (id: string) => id,
    isProvisional: () => false,
  } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/issue/ENG-7']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/issue/:identifier" element={<IssueDetail />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), mutate };
}

/** The breadcrumb is the header's own child, so it is how the header is found by role-free markup. */
function header(): HTMLElement {
  const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
  const found = crumbs.closest('header');
  if (found === null) throw new Error('the breadcrumb is not inside a header');
  return found;
}

function itemNames(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
}

describe('the issue header context menu', () => {
  it('opens on a right-click of the header, not only from the ⋯ button', async () => {
    const { user } = mount();

    expect(screen.queryByRole('menu', { name: 'Options for ENG-7' })).toBeNull();

    await user.pointer({ target: header(), keys: '[MouseRight]' });

    const menu = await screen.findByRole('menu', { name: 'Options for ENG-7' });
    expect(itemNames(menu).length).toBeGreaterThan(0);
  });

  it('offers exactly what the ⋯ menu offers, in the same order', async () => {
    const { user } = mount();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const kebab = itemNames(await screen.findByRole('menu', { name: 'More actions' }));
    await user.keyboard('{Escape}');

    await user.pointer({ target: header(), keys: '[MouseRight]' });
    const context = itemNames(await screen.findByRole('menu', { name: 'Options for ENG-7' }));

    expect(context).toEqual(kebab);
  });
});
