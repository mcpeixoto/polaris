import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider, useKeyContext } from '~/app/keymap';
import { DEFAULT_DISPLAY, type DisplayGroupBy, type DisplayOptions } from '~/filter';
import { Store, type Change, type Issue, type Team, type UUID, type WorkflowState } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Board, dragBlockedReason } from './Board';
import type { ViewGroup } from './useView';

/**
 * The board, driven the way it is used: against a real store, with a real keymap, and with
 * the mutation as the assertion.
 *
 * What can only be checked here is the wiring. The grouping's own rules are proven in
 * features/view/group.test, and the selection's in hooks/useSelection.test; re-testing
 * either through a rendered board would only be a slower copy. What no other test can see is
 * that a drop reaches `engine.mutate` carrying the *target column's* value — the one thing a
 * board can get wrong that looks perfectly fine on screen — and that a grouping whose
 * columns are not a field refuses the gesture instead of dropping the write in silence.
 */

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

/** The columns a status board of the seeded store has, as `useView` would hand them over. */
const STATE_GROUPS: readonly ViewGroup[] = [
  { key: 's-todo', label: 'Todo', stateId: 's-todo', ids: ['issue-1', 'issue-2'] },
  { key: 's-doing', label: 'In Progress', stateId: 's-doing', ids: ['issue-3'] },
];

/** The same issues grouped by a dimension a drop cannot express. */
const LABEL_GROUPS: readonly ViewGroup[] = [
  { key: 'label-1', label: 'regression', labelId: 'label-1', ids: ['issue-1'] },
  { key: ' none', label: 'No label', ids: ['issue-2', 'issue-3'] },
];

/** The board's registered moves live in the `list` context, which its screen pushes. */
function ListSurface() {
  useKeyContext('list');
  return null;
}

interface Options {
  readonly groups?: readonly ViewGroup[];
  readonly display?: Partial<DisplayOptions>;
  readonly cursorId?: UUID | null;
  readonly selected?: readonly UUID[];
  /** For the cases that need an issue the seed does not have — one with an assignee. */
  readonly store?: Store;
}

function renderBoard({
  groups = STATE_GROUPS,
  display = {},
  cursorId = null,
  selected = [],
  store = seeded(),
}: Options = {}) {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  const onOpen = vi.fn();
  const onFocus = vi.fn();
  const onToggle = vi.fn();
  const onExtend = vi.fn();

  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <ListSurface />
        <Board
          groups={groups}
          display={{ ...DEFAULT_DISPLAY, layout: 'board', ...display }}
          selected={new Set(selected)}
          cursorId={cursorId}
          label="Engineering"
          onOpen={onOpen}
          onFocus={onFocus}
          onToggle={onToggle}
          onExtend={onExtend}
        />
      </EngineProvider>
    </KeymapProvider>,
  );

  return { store, mutate, onOpen, onFocus, onToggle, onExtend, user: userEvent.setup() };
}

/** A column, by the name its listbox carries. */
function column(name: string): HTMLElement {
  const list = screen.getByRole('listbox', { name });
  const section = list.closest('section');
  if (section === null) throw new Error(`the ${name} column has no section around its cards`);
  return section;
}

function card(title: string): HTMLElement {
  return screen.getByText(title).closest('[role="option"]') as HTMLElement;
}

/**
 * jsdom has no DataTransfer, so the drag carries one of these instead.
 *
 * The same object is handed to both events of a gesture, which is what a real drag does: the
 * card writes the issue id on `dragstart` and the column reads it back on `drop`.
 */
function transfer() {
  const data = new Map<string, string>();
  return {
    dropEffect: 'none',
    effectAllowed: 'none',
    setData: (type: string, value: string) => {
      data.set(type, value);
    },
    getData: (type: string) => data.get(type) ?? '',
  };
}

/**
 * jsdom lays nothing out, so every element reports a zero size — and a virtualiser told its
 * viewport is zero pixels tall correctly renders no cards at all. Giving every element a
 * height is enough: the overscan then covers a board this small entirely, which is what lets
 * everything below be about the gestures rather than about scroll arithmetic.
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

describe('Board', () => {
  it('renders one column per group, each carrying its own count', () => {
    renderBoard();

    expect(screen.getAllByRole('listbox').map((list) => list.getAttribute('aria-label'))).toEqual([
      'Todo',
      'In Progress',
    ]);
    expect(within(column('Todo')).getByText('2')).toBeTruthy();
    expect(within(column('In Progress')).getByText('1')).toBeTruthy();
  });

  it('puts each card in its own column', () => {
    renderBoard();

    expect(
      within(column('Todo'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['ENG-1Fix the flake', 'ENG-2Ship the importer']);
    expect(within(column('In Progress')).getAllByRole('option')).toHaveLength(1);
  });

  it('keeps an empty column on the board', () => {
    renderBoard({
      groups: [
        { key: 's-todo', label: 'Todo', stateId: 's-todo', ids: ['issue-1'] },
        { key: 's-doing', label: 'In Progress', stateId: 's-doing', ids: [] },
      ],
    });

    // "Nothing is in progress" is a fact somebody wants to see, and a board whose columns
    // appear and disappear as work moves through it is one nobody can build a habit around.
    expect(within(column('In Progress')).getByText('Nothing here')).toBeTruthy();
  });

  it('draws only the properties the display options ask for', () => {
    renderBoard({ display: { properties: ['priority'] } });

    expect(screen.queryAllByRole('img', { name: 'Unassigned' })).toHaveLength(0);
  });

  it('draws the assignee slot when it is asked for, filled or not', () => {
    renderBoard();

    expect(screen.getAllByRole('img', { name: 'Unassigned' })).toHaveLength(3);
  });

  it('moves a dropped card by writing the target column status', () => {
    const { mutate } = renderBoard();

    const dataTransfer = transfer();
    fireEvent.dragStart(card('Fix the flake'), { dataTransfer });
    fireEvent.drop(column('In Progress'), { dataTransfer });

    // The same mutation the list's status picker makes, with the same optimistic patch.
    // There is no second write path for the board.
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({
      input: { id: 'issue-1', stateId: 's-doing' },
    });
    expect(mutate.mock.calls[0]?.[0].optimistic[0].after.stateId).toBe('s-doing');
  });

  it('moves the whole selection when the dragged card is part of it', () => {
    const { mutate } = renderBoard({ selected: ['issue-1', 'issue-2'] });

    const dataTransfer = transfer();
    fireEvent.dragStart(card('Fix the flake'), { dataTransfer });
    fireEvent.drop(column('In Progress'), { dataTransfer });

    // One mutation each, because there is no bulk endpoint and a partial failure over a
    // selection has to be reportable per issue.
    expect(mutate.mock.calls.map((call) => call[0].variables)).toEqual([
      { input: { id: 'issue-1', stateId: 's-doing' } },
      { input: { id: 'issue-2', stateId: 's-doing' } },
    ]);
  });

  it('sets the assignee when that is what the columns are', () => {
    const { mutate } = renderBoard({
      display: { groupBy: 'assignee' },
      groups: [
        { key: 'user-ada', label: 'Ada Lovelace', userId: 'user-ada', ids: [] },
        { key: ' none', label: 'Unassigned', ids: ['issue-1'] },
      ],
    });

    const dataTransfer = transfer();
    fireEvent.dragStart(card('Fix the flake'), { dataTransfer });
    fireEvent.drop(column('Ada Lovelace'), { dataTransfer });

    expect(mutate.mock.calls[0]?.[0].variables).toEqual({
      input: { id: 'issue-1', assigneeId: 'user-ada' },
    });
  });

  it('unassigns onto the column that stands for nobody', () => {
    // Seeded with an assignee, because a mutation that would change nothing is not sent —
    // and "nobody" is the one destination the fixture's issues are already in.
    const store = seeded();
    store.applyChanges([
      {
        v: 30,
        type: 'issue',
        id: 'issue-1',
        op: 'upsert',
        actor: { type: 'system' },
        payload: { ...issue(1, 'Fix the flake', 's-todo', 'V'), assigneeId: 'user-ada' },
      },
    ] as Change[]);

    const { mutate } = renderBoard({
      store,
      display: { groupBy: 'assignee' },
      groups: [
        { key: 'user-ada', label: 'Ada Lovelace', userId: 'user-ada', ids: ['issue-1'] },
        { key: ' none', label: 'Unassigned', ids: [] },
      ],
    });

    const dataTransfer = transfer();
    fireEvent.dragStart(card('Fix the flake'), { dataTransfer });
    fireEvent.drop(column('Unassigned'), { dataTransfer });

    // `clearAssignee`, not a null id: in a partial update a null is indistinguishable from
    // "leave it alone", which is why the mutation has a flag for it.
    expect(mutate.mock.calls[0]?.[0].variables).toEqual({
      input: { id: 'issue-1', clearAssignee: true },
    });
  });

  it('refuses to drag under a grouping a drop cannot express, and says why', () => {
    const { mutate } = renderBoard({ display: { groupBy: 'label' }, groups: LABEL_GROUPS });

    expect(card('Fix the flake').getAttribute('draggable')).toBe('false');
    expect(screen.getByRole('note').textContent).toMatch(/several labels/);

    const dataTransfer = transfer();
    fireEvent.dragStart(card('Fix the flake'), { dataTransfer });
    fireEvent.drop(column('No label'), { dataTransfer });

    // Not silently dropped: nothing was written, and the reason is on the screen.
    expect(mutate).not.toHaveBeenCalled();
  });

  it('points every column at the reason its cards will not move', () => {
    renderBoard({ display: { groupBy: 'label' }, groups: LABEL_GROUPS });

    const describedBy = column('regression').getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')?.textContent).toMatch(/several labels/);
  });

  /**
   * The two tables — which groupings a drop can write, and why the rest cannot — are read by
   * different parts of the board, and nothing but this stops them drifting apart. A grouping
   * missing from the first is a card that will not lift; missing from the second, a card that
   * will not lift for no stated reason.
   */
  it('has a reason for every grouping whose columns are not a field', () => {
    const droppable: readonly DisplayGroupBy[] = ['state', 'assignee', 'priority'];
    const refused: readonly DisplayGroupBy[] = [
      'none',
      'stateCategory',
      'label',
      'team',
      'dueDate',
      'parent',
    ];

    for (const groupBy of droppable) expect(dragBlockedReason(groupBy)).toBeNull();
    for (const groupBy of refused) expect(dragBlockedReason(groupBy)).not.toBeNull();
  });

  it('moves the issue under the cursor with the keyboard', async () => {
    const { user, mutate } = renderBoard({ cursorId: 'issue-1' });

    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');

    expect(mutate.mock.calls[0]?.[0].variables).toEqual({
      input: { id: 'issue-1', stateId: 's-doing' },
    });
  });

  it('leaves the keyboard move unbound where a drop is impossible', async () => {
    const { user, mutate } = renderBoard({
      display: { groupBy: 'label' },
      groups: LABEL_GROUPS,
      cursorId: 'issue-1',
    });

    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');

    expect(mutate).not.toHaveBeenCalled();
  });

  it('walks the cursor across the columns', async () => {
    const { user, onFocus } = renderBoard({ cursorId: 'issue-2' });

    await user.keyboard('l');

    // The second card of Todo has no counterpart in a column of one, so the cursor lands on
    // the last card there rather than nowhere.
    expect(onFocus).toHaveBeenCalledWith('issue-3');
  });

  it('holds the cursor at the end of the board rather than wrapping', async () => {
    const { user, onFocus } = renderBoard({ cursorId: 'issue-3' });

    await user.keyboard('l');

    expect(onFocus).not.toHaveBeenCalled();
  });
});
