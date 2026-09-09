/**
 * The issue header's menu, now that it is the row menu plus this screen's own four items.
 *
 * `IssueDetail.contextMenu.test.tsx` holds the other half of the bargain — that the ⋯ button
 * and the right-click render one array — and says nothing about what is in it. What is in it
 * changed: the header used to offer subscribe, a schedule, a customer request, the model uuid
 * and delete, and every property of the issue was reachable only through the rail. A person
 * who learned the menu on a list row found none of it here.
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
const DOING = '01900000-0000-7000-8000-000000000006';
const ISSUE = '01900000-0000-7000-8000-000000000004' as UUID;
const VIEWER = '01900000-0000-7000-8000-000000000005' as UUID;
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, displayName: 'Ada', role: 'member' }),
  useViewerRole: () => 'member',
}));

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
      'workflowState',
      {
        id: DOING,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        name: 'In Progress',
        category: 'started',
        position: 'b',
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
        name: 'Ada',
        displayName: 'Ada',
        email: 'ada@example.com',
        role: 'member',
        status: 'active',
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
  return { user: userEvent.setup(), mutate, store };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.findByRole('menu', { name: 'More actions' });
}

describe('the issue header menu', () => {
  it('offers the shared properties as cascades, and keeps this screen’s own items', async () => {
    const { user } = mount();

    const menu = await openMenu(user);

    for (const name of [
      /^Status…/,
      /^Priority…/,
      /^Assignee…/,
      /^Labels…/,
      /^Copy$/,
      /^Mark as$/,
    ]) {
      expect(within(menu).getByRole('menuitem', { name }), String(name)).toBeTruthy();
    }
    // The four the row menu has no equivalent for. Delete keeps the header's own wording —
    // the shared builder would have written "Delete ENG-7" next to a button that says Delete.
    for (const name of ['Add customer request', 'Copy model UUID', 'Delete', 'Make recurring']) {
      expect(within(menu).getByRole('menuitem', { name }), name).toBeTruthy();
    }
    // Nothing to open: this is the issue.
    expect(within(menu).queryByRole('menuitem', { name: 'Open issue' })).toBeNull();
  });

  it('writes a status chosen in the cascade, without opening the rail’s picker', async () => {
    const { user, store } = mount();

    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /^Status…/ }));
    const status = await screen.findByRole('menu', { name: 'Status' });
    await user.click(within(status).getByRole('menuitem', { name: 'In Progress' }));

    expect(store.get('issue', ISSUE)?.stateId).toBe(DOING);
  });

  it('puts the two panel-backed properties under More properties', async () => {
    const { user } = mount();

    const menu = await openMenu(user);
    // `Shift+M` is registered only where the issue is in a project, and this one is not — so
    // there is no milestone row at all rather than a cap for a key nothing listens for.
    expect(within(menu).queryByRole('menuitem', { name: /^Milestone…/ })).toBeNull();

    await user.click(within(menu).getByRole('menuitem', { name: 'More properties' }));
    const more = await screen.findByRole('menu', { name: 'More properties' });

    // Neither is a value: a link is a row in the panel below the fold, and a rename is the
    // title field. Both exist only on this screen, which is why they are here and nowhere.
    expect(
      within(more)
        .getAllByRole('menuitem')
        .map((item) => item.textContent ?? ''),
    ).toEqual([expect.stringContaining('Add link…'), expect.stringContaining('Rename…')]);
  });

  it('puts the caret in the title when Rename is chosen', async () => {
    const { user } = mount();

    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'More properties' }));
    const more = await screen.findByRole('menu', { name: 'More properties' });
    await user.click(within(more).getByRole('menuitem', { name: /^Rename…/ }));

    // The same field `E` focuses. A menu item that opened a dialog would be a second way to
    // rename an issue, and the two would drift.
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Issue title' }));
  });
});
