/**
 * Setting a property a row does not have yet.
 *
 * `IssueList.inline.test.tsx` covers the half of this that already worked: a property with a
 * value is drawn as a control and pressing it opens the right picker. The half that did not
 * is the one this file is about — a pill that rendered only when its value was non-null meant
 * project, cycle, estimate and due date could be *changed* with a pointer and never *set*
 * with one. An issue with no cycle had no cycle pill, so there was nowhere on the row to
 * press, and the routes left were a chord and the context menu.
 *
 * So the claims here are the ones the placeholder exists to make: the control is on the row
 * before the value is, it opens the picker that owns that property, and choosing a value in
 * it writes to the issue the control belongs to.
 *
 * The second half is restraint. Cycle and estimate keep a permanent placeholder only where
 * the team uses them at all — a team that runs no cycles and sizes nothing must not grow two
 * dashed pills per row saying so — and that gate is pinned here too, because it is the
 * difference between a helpful affordance and a wall of grey.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { IssueList } from './IssueList';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'user-ada',
  useViewer: () => ({ id: 'user-ada', role: 'admin' }),
}));

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const AT = '2026-01-01T00:00:00Z';

/**
 * A team that both estimates and runs cycles, because those two settings are what decide
 * whether the permanent placeholders are drawn at all. `plans: false` gives the other team
 * — the one that should show neither.
 */
function team(plans: boolean): Entity {
  return {
    id: TEAM,
    workspaceId: WORKSPACE,
    key: 'ENG',
    name: 'Engineering',
    timezone: 'Europe/Lisbon',
    private: false,
    estimateScale: plans ? 'fibonacci' : 'none',
    estimateAllowZero: false,
    estimateExtended: false,
    cyclesEnabled: plans,
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
  } as Entity;
}

/** One issue with none of the four properties set. That is the whole point of it. */
function bareIssue(): Entity {
  return {
    id: 'issue-1',
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number: 1,
    identifier: 'ENG-1',
    title: 'Fix the flake',
    description: '',
    dueDateSource: 'manual',
    stateId: 's-todo',
    priority: 0,
    sortOrder: 'V',
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function seeded(plans: boolean): Store {
  const entities: [string, Entity][] = [
    ['team', team(plans)],
    [
      'workflowState',
      {
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
      } as Entity,
    ],
    [
      'projectStatus',
      {
        id: 'ps-started',
        workspaceId: WORKSPACE,
        name: 'In progress',
        color: '#5e6ad2',
        category: 'started',
        position: 'a',
        isDefault: true,
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
    [
      'project',
      {
        id: 'project-1',
        workspaceId: WORKSPACE,
        name: 'Onboarding',
        icon: '🚀',
        description: '',
        color: '#5e6ad2',
        statusId: 'ps-started',
        priority: 0,
        sortOrder: 'V',
        updateSchedule: 'never',
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
    [
      'cycle',
      {
        id: 'cycle-1',
        workspaceId: WORKSPACE,
        teamId: TEAM,
        number: 7,
        name: 'Cycle 7',
        startsAt: '2027-03-01T00:00:00Z',
        endsAt: '2027-03-15T00:00:00Z',
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
    ['issue', bareIssue()],
  ];
  const store = new Store(WORKSPACE);
  store.applyChanges(
    entities.map(([type, entity], index) => ({
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

/** Everything the display menu can show, so `cycle` — which is not a default — is on. */
const SHOW = 'priority,assignee,labels,estimate,dueDate,project,cycle';

function renderList(options: { plans?: boolean; board?: boolean } = {}) {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store: seeded(options.plans ?? true), mutate } as unknown as SyncEngine;
  const url = `/team/ENG?show=${SHOW}${options.board === true ? '&layout=board' : ''}`;

  render(
    <MemoryRouter initialEntries={[url]}>
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
  return { mutate, user: userEvent.setup() };
}

function row(): HTMLElement {
  return screen.getByRole('option', { name: /Fix the flake/ });
}

/** The fields a write carried, however `updateIssues` chose to shape its input. */
function written(mutate: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = mutate.mock.calls[0]?.[0] as { variables: { input: Record<string, unknown> } };
  return call.variables.input;
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

describe('a row whose properties are not set yet', () => {
  it('offers a control for every one of them, named for the hole it fills', () => {
    renderList();

    for (const name of ['No project', 'No cycle', 'No estimate', 'No due date']) {
      expect(
        within(row()).getByRole('button', { name }),
        `${name} has to be pressable before it has a value, or it can never get one`,
      ).toBeTruthy();
    }
  });

  it('opens the cycle picker from the row that has no cycle', async () => {
    const { user } = renderList();

    await user.click(within(row()).getByRole('button', { name: 'No cycle' }));

    expect(screen.getByRole('menu', { name: 'Cycle' })).toBeTruthy();
  });

  it('writes the chosen cycle to that issue', async () => {
    const { user, mutate } = renderList();

    await user.click(within(row()).getByRole('button', { name: 'No cycle' }));
    await user.click(screen.getByRole('menuitem', { name: /Cycle 7/ }));

    const input = written(mutate);
    expect(input['ids'] ?? [input['id']]).toEqual(['issue-1']);
    expect(input['cycleId']).toBe('cycle-1');
  });

  it('writes the chosen project to that issue', async () => {
    const { user, mutate } = renderList();

    await user.click(within(row()).getByRole('button', { name: 'No project' }));
    await user.click(screen.getByRole('menuitem', { name: /Onboarding/ }));

    const input = written(mutate);
    expect(input['ids'] ?? [input['id']]).toEqual(['issue-1']);
    expect(input['projectId']).toBe('project-1');
  });

  /**
   * The board is the same screen, and the placeholders are only worth having on it if the
   * whole path works there too: the card reports the press, the screen opens its one cycle
   * picker against that card, and the write lands on the issue the card is drawing.
   */
  it('writes the chosen cycle from a board card as well', async () => {
    const { user, mutate } = renderList({ board: true });

    await user.click(screen.getByRole('button', { name: 'No cycle' }));
    await user.click(screen.getByRole('menuitem', { name: /Cycle 7/ }));

    const input = written(mutate);
    expect(input['ids'] ?? [input['id']]).toEqual(['issue-1']);
    expect(input['cycleId']).toBe('cycle-1');
  });

  it('opens the due date picker from the row that has no deadline', async () => {
    const { user } = renderList();

    await user.click(within(row()).getByRole('button', { name: 'No due date' }));

    // A calendar rather than a list of values, which is why it is a dialog and the others
    // are menus.
    expect(screen.getByRole('dialog', { name: /due date/i })).toBeTruthy();
  });

  it('does not open the issue when an empty property is pressed', async () => {
    const { user } = renderList();

    await user.click(within(row()).getByRole('button', { name: 'No cycle' }));

    // The row is still on screen; a bubbled click would have navigated to the issue and
    // taken the list with it.
    expect(screen.getByRole('option', { name: /Fix the flake/ })).toBeTruthy();
  });

  /**
   * The restraint half. A permanent "No estimate" on a team that sizes nothing, or "No
   * cycle" on a team that runs none, is a dashed pill for a field the team has turned off —
   * and it would open a picker with nothing in it. Project and due date are unconditional
   * because every workspace has both.
   */
  it('leaves cycle and estimate off entirely where the team uses neither', () => {
    renderList({ plans: false });

    expect(within(row()).queryByRole('button', { name: 'No cycle' })).toBeNull();
    expect(within(row()).queryByRole('button', { name: 'No estimate' })).toBeNull();
    expect(within(row()).getByRole('button', { name: 'No project' })).toBeTruthy();
    expect(within(row()).getByRole('button', { name: 'No due date' })).toBeTruthy();
  });
});
