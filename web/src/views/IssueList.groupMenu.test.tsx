/**
 * A right-click on a group heading acts on the issues in that group.
 *
 * Status is a row of the menu, so the gesture is the right-click and one choice. Select all
 * is the other row: it is how the heading reaches the bulk bar without selecting each issue.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Issue, type Team, type WorkflowState } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { IssueList } from './IssueList';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'user-ada',
  useViewer: () => ({ id: 'user-ada', role: 'admin' }),
}));

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const DESIGN = 'team-2';
const ADA = 'user-ada';
const AT = '2026-01-01T00:00:00Z';

function team(id: string, key: string, name: string): Team {
  return {
    id,
    workspaceId: WORKSPACE,
    key,
    name,
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

function state(
  id: string,
  teamId: string,
  name: string,
  category: WorkflowState['category'],
): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId,
    name,
    color: '#5e6ad2',
    category,
    position: 'V',
    isDefault: category === 'unstarted',
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(
  id: string,
  number: number,
  title: string,
  teamId: string,
  stateId: string,
  sortOrder: string,
): Issue {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId,
    number,
    identifier: `ENG-${number}`,
    title,
    dueDateSource: 'manual',
    description: '',
    stateId,
    priority: 0,
    sortOrder,
    createdAt: AT,
    updatedAt: AT,
  };
}

function apply(store: Store, entities: (Team | WorkflowState | Issue)[]): void {
  store.applyChanges(
    entities.map((entity, index) => ({
      v: index + 1,
      type:
        'category' in entity && 'position' in entity
          ? 'workflowState'
          : 'key' in entity
            ? 'team'
            : 'issue',
      id: entity.id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload: entity,
    })) as Change[],
  );
}

/** A virtualiser with a zero-height viewport draws no rows. See IssueList.test.tsx. */
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

function renderList(store: Store, search = '') {
  const mutate = vi.fn().mockResolvedValue({ bulkUpdateIssues: { skipped: [] } });
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/team/ENG${search}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/team/:teamKey" element={<IssueList />} />
            <Route
              path="/my-issues"
              element={<IssueList source={{ kind: 'assignee', userId: ADA }} heading="My issues" />}
            />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

/** The fold control, not the scope pill that shares the group's name. */
function groupToggle(name: string): HTMLElement {
  const found = screen.getAllByRole('button').find((node) => {
    if (node.getAttribute('aria-expanded') === null) return false;
    return (node.textContent ?? '').includes(name);
  });
  if (found === undefined) throw new Error(`no group header named ${name}`);
  return found;
}

function openGroupMenu(name: string): void {
  fireEvent.contextMenu(groupToggle(name), {
    button: 2,
    buttons: 2,
    clientX: 48,
    clientY: 64,
  });
}

function selectedTitles(): string[] {
  return screen
    .getAllByRole('option')
    .filter((option) => option.getAttribute('aria-selected') === 'true')
    .map((option) => option.textContent ?? '');
}

describe('a right-click on a group', () => {
  function backlogStore(): Store {
    const store = new Store(WORKSPACE);
    apply(store, [
      team(TEAM, 'ENG', 'Engineering'),
      state('s-backlog', TEAM, 'Backlog', 'backlog'),
      state('s-doing', TEAM, 'In Progress', 'started'),
      issue('issue-1', 1, 'Write the annex', TEAM, 's-backlog', 'V'),
      issue('issue-2', 2, 'Price the lot', TEAM, 's-backlog', 'W'),
      issue('issue-3', 3, 'Already moving', TEAM, 's-doing', 'V'),
    ]);
    return store;
  }

  it('moves every issue in the group to the status that was clicked', async () => {
    const { mutate, user } = renderList(backlogStore());

    openGroupMenu('Backlog');
    await user.click(await screen.findByRole('menuitem', { name: 'In Progress' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const input = mutate.mock.calls[0]?.[0] as {
      variables: { input: { ids: string[]; stateId: string } };
    };
    expect(input.variables.input.stateId).toBe('s-doing');
    expect(input.variables.input.ids).toEqual(['issue-1', 'issue-2']);
  });

  it('selects the group and leaves the other groups alone', async () => {
    const { user } = renderList(backlogStore());

    openGroupMenu('Backlog');
    await user.click(await screen.findByRole('menuitem', { name: /^Select all/ }));

    const selected = selectedTitles().join('\n');
    expect(selected).toContain('Write the annex');
    expect(selected).toContain('Price the lot');
    expect(selected).not.toContain('Already moving');
  });

  it('selects a collapsed group, which means unfolding it first', async () => {
    const { user } = renderList(backlogStore());

    await user.click(groupToggle('Backlog'));
    expect(screen.queryByRole('option', { name: /Write the annex/ })).toBeNull();

    openGroupMenu('Backlog');
    await user.click(await screen.findByRole('menuitem', { name: /^Select all/ }));

    expect(
      screen.getByRole('option', { name: /Write the annex/ }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('option', { name: /Price the lot/ }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('offers the same status list from a board column', async () => {
    const { mutate, user } = renderList(backlogStore(), '?layout=board');

    await user.click(screen.getByRole('button', { name: 'Options for Backlog' }));
    await user.click(await screen.findByRole('menuitem', { name: 'In Progress' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const input = mutate.mock.calls[0]?.[0] as {
      variables: { input: { ids: string[]; stateId: string } };
    };
    expect(input.variables.input).toMatchObject({
      stateId: 's-doing',
      ids: ['issue-1', 'issue-2'],
    });
  });
});

describe('a group that spans teams', () => {
  it('will select the issues and will not offer a status', async () => {
    const store = new Store(WORKSPACE);
    apply(store, [
      team(TEAM, 'ENG', 'Engineering'),
      team(DESIGN, 'DES', 'Design'),
      state('s-todo', TEAM, 'Todo', 'unstarted'),
      state('s-des', DESIGN, 'Todo', 'unstarted'),
      { ...issue('issue-4', 4, 'Mine in ENG', TEAM, 's-todo', 'V'), assigneeId: ADA },
      {
        ...issue('issue-5', 5, 'Mine in DES', DESIGN, 's-des', 'V'),
        assigneeId: ADA,
        identifier: 'DES-5',
      },
    ]);
    const mutate = vi.fn().mockResolvedValue({ bulkUpdateIssues: { skipped: [] } });
    const engine = { store, mutate } as unknown as SyncEngine;
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/my-issues']}>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <IssueList source={{ kind: 'assignee', userId: ADA }} heading="My issues" />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );

    openGroupMenu('Active');
    expect(await screen.findByRole('menuitem', { name: /^Select all/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /more than one team/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Todo' })).toBeNull();

    await user.click(screen.getByRole('menuitem', { name: /^Select all/ }));
    expect(mutate).not.toHaveBeenCalled();
    expect(selectedTitles().join('\n')).toContain('Mine in ENG');
    expect(selectedTitles().join('\n')).toContain('Mine in DES');
  });
});
