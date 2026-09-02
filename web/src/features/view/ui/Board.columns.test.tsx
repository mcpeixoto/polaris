/**
 * What a board column carries besides its cards: the two controls in its header, the fold,
 * and where a drop lands within it.
 *
 * A sibling file rather than more cases in `Board.test.tsx`, because every case here needs a
 * prop that file does not pass — the fold state, the create route, the card scroller the
 * screen reaches through. Passing them there would change what its own cases are about.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider, useKeyContext } from '~/app/keymap';
import { DEFAULT_DISPLAY, type DisplayOptions } from '~/filter';
import { Store, type Change, type Issue, type Team, type UUID, type WorkflowState } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Board } from './Board';
import type { ViewGroup } from './useView';

vi.mock('~/hooks/useViewer', () => ({ useViewerId: () => 'user-ada' }));

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
    ['issue', issue(2, 'Ship the importer', 's-doing', 'V')],
    ['issue', issue(3, 'Rewrite the seeder', 's-doing', 'W')],
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

const GROUPS: readonly ViewGroup[] = [
  { key: 's-todo', label: 'Todo', stateId: 's-todo', ids: ['issue-1'] },
  { key: 's-doing', label: 'In Progress', stateId: 's-doing', ids: ['issue-2', 'issue-3'] },
];

/** jsdom lays nothing out, and a virtualiser told its viewport is zero renders no cards. */
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

function ListSurface() {
  useKeyContext('list');
  return null;
}

interface Options {
  readonly collapsed?: readonly string[];
  readonly display?: Partial<DisplayOptions>;
  readonly cursorId?: UUID | null;
}

function renderBoard({ collapsed = [], display = {}, cursorId = null }: Options = {}) {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({ bulkUpdateIssues: { skipped: [] } });
  const engine = { store, mutate } as unknown as SyncEngine;
  const onToggleGroup = vi.fn();
  const onContextMenu = vi.fn();
  const onCreateInColumn = vi.fn();
  const onFocus = vi.fn();

  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <ListSurface />
        <Board
          groups={GROUPS}
          display={{ ...DEFAULT_DISPLAY, layout: 'board', orderBy: 'manual', ...display }}
          selected={new Set()}
          cursorId={cursorId}
          label="Engineering"
          collapsed={new Set(collapsed)}
          onOpen={vi.fn()}
          onFocus={onFocus}
          onToggle={vi.fn()}
          onExtend={vi.fn()}
          onToggleGroup={onToggleGroup}
          onContextMenu={onContextMenu}
          onCreateInColumn={onCreateInColumn}
        />
      </EngineProvider>
    </KeymapProvider>,
  );

  return {
    store,
    mutate,
    onToggleGroup,
    onContextMenu,
    onCreateInColumn,
    onFocus,
    user: userEvent.setup(),
  };
}

function column(name: string): HTMLElement {
  return screen.getByRole('listbox', { name }).closest('section')!;
}

function card(title: string): HTMLElement {
  return screen.getByRole('option', { name: new RegExp(title) });
}

describe('the column header', () => {
  it('names its two icon-only controls', () => {
    renderBoard();

    expect(screen.getByRole('button', { name: 'Create issue in Todo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Options for Todo' })).toBeTruthy();
  });

  it('files into the column the plus belongs to', async () => {
    const { user, onCreateInColumn } = renderBoard();

    await user.click(screen.getByRole('button', { name: 'Create issue in In Progress' }));

    // The composer's own seed grammar, so the column plus and a pasted creation URL are one
    // code path rather than two mappings that can disagree.
    expect(onCreateInColumn).toHaveBeenCalledWith('/new?status=In+Progress');
  });

  it('folds the column from the heading and from the menu', async () => {
    const { user, onToggleGroup } = renderBoard();

    await user.click(screen.getByRole('button', { name: 'Todo' }));
    expect(onToggleGroup).toHaveBeenCalledWith('s-todo');

    await user.click(screen.getByRole('button', { name: 'Options for Todo' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Hide column' }));
    expect(onToggleGroup).toHaveBeenCalledTimes(2);
  });
});

describe('a folded column', () => {
  it('keeps its heading and its count and loses its cards', () => {
    renderBoard({ collapsed: ['s-doing'] });

    expect(screen.getByRole('button', { name: 'In Progress' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(screen.queryByRole('listbox', { name: 'In Progress' })).toBeNull();
    // Still on the board, so the status is still reachable by drag — the spec asks for hidden
    // columns to collect at the far right and go on accepting drops.
    expect(screen.getByRole('button', { name: 'Options for In Progress' })).toBeTruthy();
  });

  it('offers to bring the column back', async () => {
    const { user } = renderBoard({ collapsed: ['s-doing'] });

    await user.click(screen.getByRole('button', { name: 'Options for In Progress' }));

    expect(await screen.findByRole('menuitem', { name: 'Show column' })).toBeTruthy();
  });

  it('collects at the far right', () => {
    renderBoard({ collapsed: ['s-todo'] });

    const headings = screen
      .getAllByRole('button', { name: /^(Todo|In Progress)$/ })
      .map((node) => node.textContent);

    expect(headings).toEqual(['In Progress', 'Todo']);
  });
});

describe('where a drop lands', () => {
  /**
   * jsdom measures every card as zero pixels tall, so the gap arithmetic resolves to the end
   * of the column whatever `clientY` says. What can be pinned here is the part that is not
   * geometry: a drag that told the column where it was produces a second write, and that
   * write names a neighbour *from the target column* rather than the one the card came from.
   */
  it('orders the card against the target column once the drag has said where it is', () => {
    const { mutate } = renderBoard();

    fireEvent.dragStart(card('Fix the flake'), { dataTransfer: transfer() });
    fireEvent.dragOver(column('In Progress'), { dataTransfer: transfer(), clientY: 0 });
    fireEvent.drop(column('In Progress'), { dataTransfer: transfer(), clientY: 0 });

    const inputs = mutate.mock.calls.map(
      (call) => (call[0] as { variables: { input: Record<string, unknown> } }).variables.input,
    );

    // Two writes and they are not the same write: the column's field is one update the whole
    // selection shares, the position is one reorder per card.
    expect(inputs.length).toBe(2);
    expect(inputs[0]).toEqual({ id: 'issue-1', stateId: 's-doing' });
    expect(inputs[1]?.id).toBe('issue-1');
    expect(
      ['issue-2', 'issue-3'],
      'the neighbour has to be one of the cards already in the column it landed in',
    ).toContain(inputs[1]?.afterIssueId);
  });

  it('writes no position when the drag never said where it was', () => {
    const { mutate } = renderBoard();

    fireEvent.dragStart(card('Fix the flake'), { dataTransfer: transfer() });
    fireEvent.drop(column('In Progress'), { dataTransfer: transfer() });

    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('writes no position under an order the board does not control', () => {
    const { mutate } = renderBoard({ display: { orderBy: 'priority' } });

    fireEvent.dragStart(card('Fix the flake'), { dataTransfer: transfer() });
    fireEvent.dragOver(column('In Progress'), { dataTransfer: transfer(), clientY: 0 });
    fireEvent.drop(column('In Progress'), { dataTransfer: transfer(), clientY: 0 });

    // The order is computed there, so a `sortOrder` write would move nothing and say nothing.
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});

describe('a right-click on a card', () => {
  it('reports the card and where the pointer was', () => {
    const { onContextMenu } = renderBoard();

    fireEvent.contextMenu(card('Ship the importer'), { clientX: 40, clientY: 80 });

    expect(onContextMenu).toHaveBeenCalledWith('issue-2', 0, 40, 80);
  });
});

describe('card ids', () => {
  it('are unique across the board', () => {
    // One issue can be in several columns — a label board is the ordinary case — and two
    // elements sharing an id is an `aria-activedescendant` that resolves to whichever the
    // document happens to hold first.
    renderBoard();

    const ids = screen.getAllByRole('option').map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/** A DataTransfer stand-in: jsdom has none, and the column reads and writes its own type. */
function transfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    effectAllowed: 'move',
    dropEffect: 'move',
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  } as unknown as DataTransfer;
}
