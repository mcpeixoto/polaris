/**
 * The list's row identity, its cursor, and the two things a pointer can now do to a row.
 *
 * A sibling file rather than more cases in `IssueList.test.tsx`, because everything here
 * needs a fixture that file deliberately does not have: labels on issues, so an issue can be
 * in two groups at once. That is the shape every defect below comes out of — one issue, two
 * rows, one key and one DOM id between them — and it cannot be seen at all in a list where
 * every issue appears once.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import {
  Store,
  type Change,
  type Issue,
  type IssueLabel,
  type Label,
  type Team,
  type WorkflowState,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { IssueList } from './IssueList';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'user-ada',
  useViewer: () => ({ id: 'user-ada', role: 'admin' }),
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

function label(id: string, name: string): Label {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name,
    color: '#5e6ad2',
    isGroup: false,
    position: 'V',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issueLabel(issueId: string, labelId: string): IssueLabel {
  return {
    id: `${issueId}:${labelId}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    issueId,
    labelId,
    createdAt: AT,
  };
}

function issue(number: number, title: string, sortOrder: string): Issue {
  return {
    id: `issue-${number}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier: `ENG-${number}`,
    title,
    dueDateSource: 'manual',
    description: '',
    stateId: 's-todo',
    priority: 0,
    sortOrder,
    createdAt: AT,
    updatedAt: AT,
  };
}

/**
 * Three issues; the first carries both labels, so grouping by label puts it in two groups.
 *
 * That is the fixture the whole file turns on. `groupIssues` does it on purpose — "show me
 * everything tagged regression" has to include work that is also tagged something else — and
 * every defect here is about the list then treating one issue as one row.
 */
function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | WorkflowState | Label | Issue | IssueLabel][] = [
    ['team', team()],
    ['workflowState', state('s-todo', 'Todo', 'unstarted')],
    ['label', label('label-bug', 'Bug')],
    ['label', label('label-regression', 'Regression')],
    ['issue', issue(1, 'Fix the flake', 'V')],
    ['issue', issue(2, 'Ship the importer', 'W')],
    ['issue', issue(3, 'Rewrite the seeder', 'X')],
    ['issueLabel', issueLabel('issue-1', 'label-bug')],
    ['issueLabel', issueLabel('issue-1', 'label-regression')],
    ['issueLabel', issueLabel('issue-2', 'label-bug')],
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

function renderList(search = '') {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter initialEntries={[`/team/ENG${search}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/team/:teamKey" element={<IssueList />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { store, mutate, user: userEvent.setup() };
}

function listbox(): HTMLElement {
  return screen.getByRole('listbox', { name: 'Engineering issues' });
}

function cursorId(): string | null {
  return listbox().getAttribute('aria-activedescendant');
}

function cursorText(): string | null {
  const id = cursorId();
  return id === null ? null : (document.getElementById(id)?.textContent ?? null);
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

/** Grouping by label, which is the only grouping that can list one issue twice. */
const BY_LABEL = '?group=label';

describe('one issue in two label groups', () => {
  it('gives each of its rows an id of its own', () => {
    renderList(BY_LABEL);

    const ids = screen.getAllByRole('option').map((option) => option.id);

    expect(ids.length, 'issue-1 is in both label groups, so there are four rows').toBe(4);
    expect(new Set(ids).size, 'aria-activedescendant must resolve to exactly one element').toBe(
      ids.length,
    );
  });

  /**
   * The cursor used to be a bare id resolved with `ids.indexOf`, which always answers with
   * the *first* occurrence — so standing on the second copy and pressing J stepped from the
   * first copy's position and threw the cursor back up the list.
   */
  it('steps down from the row the cursor is actually on', async () => {
    const { user } = renderList(BY_LABEL);

    // Down to the second copy of issue-1, which is the first row of the second group.
    await user.keyboard('jj');
    const second = cursorId();
    expect(cursorText()).toContain('Fix the flake');

    await user.keyboard('j');

    expect(cursorId(), 'J from the second copy must move on, not jump').not.toBe(second);
    expect(cursorText()).toContain('Rewrite the seeder');
  });

  /**
   * `selection.ordered` is the flat row order filtered by the selection, and that order names
   * one issue once per group it is in — so a bulk edit fired once per row rather than once per
   * issue, and the delete confirmation counted rows too.
   */
  it('writes each issue once when the selection spans its copies', async () => {
    const { user, mutate } = renderList(BY_LABEL);

    // Every row: issue-1 twice, issue-2, issue-3.
    await user.keyboard('{Control>}a{/Control}');
    await user.keyboard('i');

    const ids = mutate.mock.calls.flatMap((call) => {
      const input = (call[0] as { variables: { input?: { ids?: string[]; id?: string } } })
        .variables.input;
      return input?.ids ?? (input?.id === undefined ? [] : [input.id]);
    });

    expect(ids.length, 'four rows, three issues').toBe(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('counts issues rather than rows in the delete confirmation', async () => {
    const { user } = renderList(BY_LABEL);

    await user.keyboard('{Control>}a{/Control}');
    await user.keyboard('{Control>}{Backspace}{/Control}');

    expect(screen.getByRole('heading', { name: 'Delete 3 issues?' })).toBeTruthy();
  });
});

describe('the cursor after a row leaves', () => {
  /**
   * Archiving and deleting take the row out of the replica optimistically, so the cursor's id
   * stops resolving. It used to fall back to `ids[0]` — the top of the whole list — which
   * meant pressing the key twice acted on the row you meant and then on row one.
   */
  it('lands on the next row down rather than the top of the list', async () => {
    const { user, store } = renderList();

    await user.keyboard('j');
    expect(cursorText()).toContain('Ship the importer');

    // What `deleteIssues` does optimistically: the row leaves the replica. Through `act` so
    // the subscription's re-render is flushed before the cursor is read back.
    act(() => {
      store.applyChanges([
        { v: 100, type: 'issue', id: 'issue-2', op: 'delete', actor: { type: 'system' } },
      ] as Change[]);
    });

    expect(cursorText()).toContain('Rewrite the seeder');
  });
});

describe('the pointer', () => {
  it('selects a row from its checkbox without opening the issue', async () => {
    const { user } = renderList();

    await user.click(screen.getByRole('checkbox', { name: 'Select ENG-1' }));

    expect(
      screen.getByRole('option', { name: /Fix the flake/ }).getAttribute('aria-selected'),
    ).toBe('true');
    // Still on the list: opening would have unmounted the listbox for the detail route.
    expect(listbox()).toBeTruthy();
  });

  it('opens a menu of the same commands on a right-click', async () => {
    renderList();

    fireEvent.contextMenu(screen.getByRole('option', { name: /Ship the importer/ }), {
      clientX: 120,
      clientY: 240,
    });

    const menu = await screen.findByRole('menu', { name: 'Issue actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Copy link' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Delete issue' })).toBeTruthy();
  });
});

describe('the bulk toolbar', () => {
  it('is absent until something is selected', async () => {
    const { user } = renderList();

    expect(screen.queryByRole('group', { name: 'Issue actions' })).toBeNull();

    await user.keyboard('x');

    expect(screen.getByRole('group', { name: 'Issue actions' })).toBeTruthy();
    expect(screen.getByText('1 selected')).toBeTruthy();
  });
});

describe('group headings', () => {
  it('announce their count and fold the group away', async () => {
    const { user } = renderList(BY_LABEL);

    const heading = screen.getByRole('button', { name: /^Bug/ });
    expect(heading.getAttribute('aria-expanded')).toBe('true');
    expect(heading.textContent).toContain('2');

    await user.click(heading);

    expect(heading.getAttribute('aria-expanded')).toBe('false');
    expect(
      screen.queryByRole('option', { name: /Ship the importer/ }),
      'the folded group keeps its heading and loses its rows',
    ).toBeNull();
  });

  it('folds the cursor row group with T', async () => {
    const { user } = renderList(BY_LABEL);

    await user.keyboard('t');

    expect(screen.getByRole('button', { name: /^Bug/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });
});
