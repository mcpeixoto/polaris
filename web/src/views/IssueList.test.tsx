import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider, useActions } from '~/app/keymap';
import { detectPlatform } from '~/keys';
import { Store, type Change, type Issue, type Team, type WorkflowState } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { IssueList } from './IssueList';

/**
 * The list, driven the way it is used: from the keyboard, against a real store.
 *
 * The point of these is the wiring rather than the logic — the selection's own rules are
 * proven in hooks/useSelection.test, and duplicating them through a rendered list would just
 * be a slower copy. What can only be checked here is that the registered actions reach the
 * selection at all, that the cursor and the selection stay two separate marks, and that a
 * bulk action ends up at `engine.mutate` with the rows the user was looking at.
 */

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';

/** jsdom is not a Mac, but it is not reliably not-a-Mac either. Ask the matcher. */
const MOD = detectPlatform() === 'mac' ? 'Meta' : 'Control';

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
    createdAt: AT,
    updatedAt: AT,
  };
}

function state(id: string, name: string, category: WorkflowState['category']): WorkflowState {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
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

function issue(number: number, title: string, stateId: string, sortOrder: string): Issue {
  return {
    id: `issue-${number}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
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

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | WorkflowState | Issue][] = [
    ['team', team()],
    ['workflowState', state('s-todo', 'Todo', 'unstarted')],
    ['workflowState', state('s-doing', 'In Progress', 'started')],
    ['issue', issue(1, 'Fix the flake', 's-todo', 'V')],
    ['issue', issue(2, 'Ship the importer', 's-todo', 'W')],
    ['issue', issue(3, 'Rewrite the seeder', 's-doing', 'V')],
  ];
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

/**
 * Stands in for the shell's own Escape binding, so the fall-through below is a real
 * interaction between two registered actions rather than an assertion about an event object.
 */
function GlobalDismiss({ onDismiss }: { onDismiss: () => void }) {
  useActions(
    [
      {
        id: 'test.dismiss',
        title: 'Dismiss',
        keys: ['Escape'],
        group: 'General',
        hidden: true,
        run: onDismiss,
      },
    ],
    [],
  );
  return null;
}

function renderList() {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  const dismissed = vi.fn();

  render(
    <MemoryRouter initialEntries={['/team/ENG']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <GlobalDismiss onDismiss={dismissed} />
          <Routes>
            <Route path="/team/:teamKey" element={<IssueList />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { store, mutate, dismissed, user: userEvent.setup() };
}

function listbox(): HTMLElement {
  return screen.getByRole('listbox', { name: 'Engineering issues' });
}

/** The row the keyboard is on, which the listbox names rather than focuses. */
function cursorText(): string | null {
  const id = listbox().getAttribute('aria-activedescendant');
  return id === null ? null : (document.getElementById(id)?.textContent ?? null);
}

function selectedTexts(): string[] {
  return screen
    .getAllByRole('option')
    .filter((option) => option.getAttribute('aria-selected') === 'true')
    .map((option) => option.textContent ?? '');
}

/**
 * jsdom lays nothing out, so every element reports a zero size — and a virtualiser told its
 * viewport is zero pixels tall correctly renders no rows at all.
 *
 * Giving the scroller a height is enough: the overscan then covers a list this short
 * entirely, which is what lets everything below be about the keyboard rather than about
 * scroll arithmetic. `offsetHeight` specifically, because that is what the virtualiser
 * measures its viewport with.
 */
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

describe('IssueList', () => {
  it('groups the issues by status, in workflow order', () => {
    renderList();

    const rows = screen.getAllByRole('option').map((option) => option.textContent);
    expect(rows).toEqual([
      'ENG-1Fix the flake',
      'ENG-2Ship the importer',
      'ENG-3Rewrite the seeder',
    ]);
  });

  it('starts with the cursor on the first row and moves it with j and k', async () => {
    const { user } = renderList();

    expect(cursorText()).toBe('ENG-1Fix the flake');

    await user.keyboard('j');
    expect(cursorText()).toBe('ENG-2Ship the importer');

    await user.keyboard('jj');
    // Held against the end of the list rather than wrapping: a list that loops puts the user
    // at the top when they meant to reach the bottom.
    expect(cursorText()).toBe('ENG-3Rewrite the seeder');

    await user.keyboard('k');
    expect(cursorText()).toBe('ENG-2Ship the importer');
  });

  it('selects the cursor row with x and says how many are selected', async () => {
    const { user } = renderList();

    expect(selectedTexts()).toEqual([]);

    await user.keyboard('jx');

    expect(selectedTexts()).toEqual(['ENG-2Ship the importer']);
    expect(screen.getByText('1 selected')).toBeTruthy();
    // The cursor did not move: selection and position are two different facts.
    expect(cursorText()).toBe('ENG-2Ship the importer');
  });

  it('extends the selection with shift and the arrow keys', async () => {
    const { user } = renderList();

    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');

    // The first extension takes the row the cursor was on as well as the one it moved to.
    expect(selectedTexts()).toEqual(['ENG-1Fix the flake', 'ENG-2Ship the importer']);

    await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
    expect(selectedTexts()).toEqual(['ENG-1Fix the flake']);
  });

  it('selects everything and clears again', async () => {
    const { user } = renderList();

    await user.keyboard(`{${MOD}>}a{/${MOD}}`);
    expect(selectedTexts()).toHaveLength(3);
    expect(screen.getByText('3 selected')).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(selectedTexts()).toEqual([]);
  });

  it('archives the whole selection with e, as one mutation per issue', async () => {
    const { user, mutate } = renderList();

    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await user.keyboard('e');

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls.map((call) => call[0].variables)).toEqual([
      { id: 'issue-1', archived: true },
      { id: 'issue-2', archived: true },
    ]);
    // Optimistically a delete, matching the change the server emits for an archive: archived
    // work is not meant to sit in a replica waiting to be turned up by a filter.
    expect(mutate.mock.calls[0]?.[0].optimistic[0].after).toBeNull();
  });

  it('acts on the cursor row when nothing is selected', async () => {
    const { user, mutate } = renderList();

    await user.keyboard('je');

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({ id: 'issue-2', archived: true });
  });

  it('lets Escape fall through to the shell when there is nothing to clear', async () => {
    const { user, dismissed } = renderList();

    // Nothing selected, so the list's own Escape is disabled — and a disabled action is
    // treated as unbound, which is what lets the keystroke reach the outer context instead
    // of being swallowed by a command with nothing to do.
    await user.keyboard('{Escape}');
    expect(dismissed).toHaveBeenCalledTimes(1);

    await user.keyboard('x');
    await user.keyboard('{Escape}');

    // Now the list claims it, and the shell's dismiss is not reached.
    expect(selectedTexts()).toEqual([]);
    expect(dismissed).toHaveBeenCalledTimes(1);
  });
});

/**
 * The list as My Issues renders it: one person's work, which can span teams.
 *
 * The interesting property is the one a team's list can never exercise. Statuses belong to
 * a team, so a selection spanning two teams has no correct set to offer — and the control
 * has to be unavailable from the keyboard as well as from the toolbar, because a disabled
 * button and a live shortcut are two doors into the same room.
 */
describe('IssueList over an assignee', () => {
  const ADA = 'user-ada';
  const DESIGN = 'team-2';

  function crossTeamStore(): Store {
    const store = seeded();
    const design: Team = {
      id: DESIGN,
      workspaceId: WORKSPACE,
      key: 'DES',
      name: 'Design',
      timezone: 'Europe/Lisbon',
      private: false,
      estimateScale: 'none',
      estimateAllowZero: false,
      estimateExtended: false,
      createdAt: AT,
      updatedAt: AT,
    };
    const designState: WorkflowState = {
      id: 's-des-todo',
      workspaceId: WORKSPACE,
      teamId: DESIGN,
      name: 'Todo',
      color: '#5e6ad2',
      category: 'unstarted',
      position: 'V',
      isDefault: true,
      isSystem: false,
      createdAt: AT,
      updatedAt: AT,
    };
    // One issue of Ada's in each team, which is the state a team's list cannot produce.
    const mine: Issue = { ...issue(4, 'Mine in ENG', 's-todo', 'X'), assigneeId: ADA };
    const theirs: Issue = {
      ...issue(5, 'Mine in DES', 's-des-todo', 'X'),
      id: 'issue-5',
      teamId: DESIGN,
      identifier: 'DES-5',
      assigneeId: ADA,
    };

    store.applyChanges([
      { v: 20, type: 'team', id: DESIGN, op: 'upsert', actor: { type: 'system' }, payload: design },
      {
        v: 21,
        type: 'workflowState',
        id: designState.id,
        op: 'upsert',
        actor: { type: 'system' },
        payload: designState,
      },
      { v: 22, type: 'issue', id: mine.id, op: 'upsert', actor: { type: 'system' }, payload: mine },
      {
        v: 23,
        type: 'issue',
        id: theirs.id,
        op: 'upsert',
        actor: { type: 'system' },
        payload: theirs,
      },
    ] as Change[]);
    return store;
  }

  function renderMine() {
    const store = crossTeamStore();
    const mutate = vi.fn().mockResolvedValue({});
    const engine = { store, mutate } as unknown as SyncEngine;

    render(
      <MemoryRouter initialEntries={['/my-issues']}>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <IssueList source={{ kind: 'assignee', userId: ADA }} heading="My Issues" />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );
    return { store, mutate, user: userEvent.setup() };
  }

  it("shows one person's work from every team they are in", () => {
    renderMine();
    expect(screen.getByRole('heading', { name: 'My Issues' })).toBeTruthy();
    expect(screen.getByText('Mine in ENG')).toBeTruthy();
    expect(screen.getByText('Mine in DES')).toBeTruthy();
    // Somebody else's issues are not this person's work.
    expect(screen.queryByText('Fix the flake')).toBeNull();
  });

  it('has no team settings link, because it is not one team', () => {
    renderMine();
    expect(screen.queryByRole('link', { name: /team settings/i })).toBeNull();
  });

  it('refuses a bulk status change across teams, from the toolbar and the keyboard', async () => {
    const { user } = renderMine();

    const listbox = screen.getByRole('listbox', { name: 'My Issues issues' });
    listbox.focus();
    // Select-all rather than two toggles: it is one keystroke, it cannot half-apply, and
    // "everything assigned to me" is exactly the selection somebody makes before trying a
    // bulk edit — which is the case this guard exists for.
    await user.keyboard(`{${MOD}>}a{/${MOD}}`);

    const status = screen.getByRole('button', { name: 'Status' });
    expect(status.hasAttribute('disabled')).toBe(true);

    // And the shortcut agrees. A live `s` here would open a menu offering Engineering's
    // statuses for a Design issue, which the server would then refuse.
    await user.keyboard('{s}');
    expect(screen.queryByRole('menu', { name: /status/i })).toBeNull();
  });

  it('allows a status change once the selection is inside one team', async () => {
    const { user } = renderMine();

    const listbox = screen.getByRole('listbox', { name: 'My Issues issues' });
    listbox.focus();
    await user.keyboard('{j}{x}');

    expect(screen.getByRole('button', { name: 'Status' }).hasAttribute('disabled')).toBe(false);
  });
});
