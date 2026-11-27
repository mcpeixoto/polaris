/**
 * The Delegate row on the issue screen.
 *
 * The assignee owns the issue; the delegate is an agent asked to work it. The row sits
 * under Assignee and offers only app users, because a human is a choice the server
 * rejects. Choosing one is the same write as assigning: the picker reports an id and
 * the screen sends it.
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
const AGENT = '01900000-0000-7000-8000-0000000000a1' as UUID;
const HUMAN = '01900000-0000-7000-8000-0000000000a2' as UUID;
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

afterEach(() => {
  cleanup();
});

function user(id: UUID, name: string, kind: 'human' | 'app'): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    displayName: name,
    role: 'member',
    status: 'active',
    kind,
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

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
    ['user', user(VIEWER, 'Ada', 'human')],
    ['user', user(HUMAN, 'Grace Hopper', 'human')],
    ['user', user(AGENT, 'Polaris', 'app')],
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
  // Loose on purpose: the assertion reads `variables`, which a parameter type that only
  // names `optimistic` would hide.
  const mutate: ReturnType<typeof vi.fn> = vi.fn(
    async (input: { optimistic?: OptimisticPatch }) => {
      if (input.optimistic !== undefined) store.applyOptimistic(input.optimistic);
      return {};
    },
  );
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

describe('the delegate row', () => {
  it('renders under the assignee as an empty invitation', () => {
    mount();

    const rail = screen.getByRole('complementary', { name: 'Properties' });
    const assignee = within(rail).getByRole('button', { name: 'Unassigned' });
    const delegate = within(rail).getByRole('button', { name: 'No agent' });
    expect(delegate.getAttribute('aria-describedby')).not.toBeNull();
    expect(
      document.getElementById(delegate.getAttribute('aria-describedby') ?? '')?.textContent?.trim(),
    ).toBe('Delegate');

    // Directly under the assignee: the next property button in the rail.
    const buttons = within(rail).getAllByRole('button');
    const assigneeAt = buttons.indexOf(assignee);
    expect(buttons[assigneeAt + 1]).toBe(delegate);
  });

  it('lists only agents, and choosing one sends delegateId', async () => {
    const { user, mutate } = mount();

    await user.click(screen.getByRole('button', { name: 'No agent' }));

    const menu = screen.getByRole('menu', { name: 'Delegate' });
    expect(within(menu).getByRole('menuitem', { name: 'Polaris' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'Grace Hopper' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Ada' })).toBeNull();

    await user.click(within(menu).getByRole('menuitem', { name: 'Polaris' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({
      input: { id: ISSUE, delegateId: AGENT },
    });
  });
});
