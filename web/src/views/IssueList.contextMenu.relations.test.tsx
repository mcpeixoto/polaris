/**
 * Linking two issues from a list row, and the mark the link leaves behind.
 *
 * Both halves were unreachable outside the issue's own screen: a relation could only be added
 * from the detail rail's Relations panel, and a list gave no sign at all that a row was
 * blocked — so the one fact that says "this cannot move" was invisible on the surface people
 * spend their day in.
 *
 * The assertion that earns its keep is the direction of the write. Only `blocks` is stored, so
 * "ENG-2 is blocked by ENG-1" is a row from ENG-1 to ENG-2 — the ids the other way about. A
 * relation written the wrong way round is present, well-formed and says the opposite thing.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import {
  Store,
  type Change,
  type Issue,
  type OptimisticPatch,
  type Team,
  type User,
  type WorkflowState,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { IssueList } from './IssueList';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'user-ada',
  useViewer: () => ({ id: 'user-ada', displayName: 'Ada Lovelace', role: 'admin' }),
}));

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const AT = '2026-01-01T00:00:00Z';

function team(): Team {
  return {
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
  };
}

function state(): WorkflowState {
  return {
    id: 's-todo',
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name: 'Todo',
    color: '#5e6ad2',
    category: 'unstarted',
    position: 'V',
    isDefault: true,
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function person(): User {
  return {
    id: 'user-ada',
    workspaceId: WORKSPACE,
    name: 'Ada Lovelace',
    displayName: 'Ada Lovelace',
    timezone: 'Europe/Lisbon',
    role: 'admin',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(number: number, title: string, sortOrder: string): Issue {
  return {
    id: `issue-${String(number)}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier: `ENG-${String(number)}`,
    title,
    description: '',
    stateId: 's-todo',
    priority: 0,
    sortOrder,
    dueDateSource: 'manual',
    createdAt: AT,
    updatedAt: AT,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const rows: [string, { id: string }][] = [
    ['team', team()],
    ['workflowState', state()],
    ['user', person()],
    ['issue', issue(1, 'Fix the flake', 'V')],
    ['issue', issue(2, 'Ship the importer', 'W')],
  ];
  store.applyChanges(
    rows.map(([type, entity], index) => ({
      v: index + 1,
      type,
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as Change[],
  );
  return store;
}

function renderList() {
  const store = seeded();
  const mutate = vi.fn(async (request: { optimistic?: OptimisticPatch }) => {
    const patch = request.optimistic ?? [];
    store.applyOptimistic(patch);
    const created = patch[patch.length - 1]?.after ?? null;
    return { createIssueRelation: { relation: created } };
  });
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter initialEntries={['/team/ENG']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/team/:teamKey" element={<IssueList />} />
            <Route path="*" element={null} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { store, mutate, user: userEvent.setup() };
}

async function openContextMenu(title: string): Promise<HTMLElement> {
  fireEvent.contextMenu(screen.getByRole('option', { name: new RegExp(title) }), {
    clientX: 120,
    clientY: 240,
  });
  return screen.findByRole('menu', { name: 'Issue actions' });
}

/** jsdom lays nothing out, so the virtualiser has to be told its viewport is not zero. */
const VIEWPORT = { offsetWidth: 900, offsetHeight: 600 };

beforeAll(() => {
  for (const [property, value] of Object.entries(VIEWPORT)) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get: () => value,
    });
  }
});

afterAll(() => {
  for (const property of Object.keys(VIEWPORT)) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[property];
  }
});

describe('marking a relation from the row menu', () => {
  it('writes a blocker with the ids the other way about, and flags the row', async () => {
    const { user, mutate } = renderList();

    const menu = await openContextMenu('Ship the importer');
    await user.click(within(menu).getByRole('menuitem', { name: 'Mark as' }));
    const markAs = await screen.findByRole('menu', { name: 'Mark as' });
    await user.click(within(markAs).getByRole('menuitem', { name: /^Blocked by…/ }));

    // The corpus is not a list the menu can hold, so the box runs the surface's own search.
    await user.keyboard('ENG-1');
    const candidates = await screen.findByRole('menu', { name: 'Blocked by' });
    await user.click(within(candidates).getByRole('menuitem', { name: /ENG-1/ }));

    const relation = mutate.mock.calls
      .map(([request]) => (request as { variables: Record<string, unknown> }).variables)
      .find((variables) => variables.type === 'BLOCKS');
    // ENG-1 blocks ENG-2, which is what "ENG-2 is blocked by ENG-1" is stored as.
    expect(relation).toEqual({
      issueId: 'issue-1',
      relatedIssueId: 'issue-2',
      type: 'BLOCKS',
    });

    // And the row says so without anybody opening the issue: the fact that a row cannot move
    // is the one fact a list had no way of showing.
    const row = screen.getByRole('option', { name: /Ship the importer/ });
    expect(within(row).getByText('Blocked by ENG-1')).toBeTruthy();
  });

  it('leaves the unblocked row unmarked', async () => {
    renderList();

    const row = screen.getByRole('option', { name: /Fix the flake/ });
    expect(within(row).queryByText(/^Blocked by/)).toBeNull();
  });
});
