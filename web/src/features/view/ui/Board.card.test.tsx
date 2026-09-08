/**
 * What a card draws, beyond the wiring `Board.test.tsx` proves.
 *
 * A sibling file because these cases need entities the shared seed does not carry — a
 * project, a deadline — and adding them there would change what its drop cases are about.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { DEFAULT_DISPLAY, type DisplayProperty } from '~/filter';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Board, type BoardProps } from './Board';
import type { ViewGroup } from './useView';

vi.mock('~/hooks/useViewer', () => ({ useViewerId: () => 'user-ada' }));

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const AT = '2026-01-01T00:00:00Z';

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Entity][] = [
    [
      'team',
      {
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
      },
    ],
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
      },
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
        statusId: 'ps-1',
        priority: 0,
        sortOrder: 'V',
        updateSchedule: 'default',
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    [
      'issue',
      {
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
        projectId: 'project-1',
        dueDate: '2020-01-03',
        createdAt: AT,
        updatedAt: AT,
      },
    ],
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
];

/**
 * What the screen above the board hands down, for the cases that need to watch it.
 *
 * `onProperty` is what turns the card's glyphs into pickers' triggers, and `onOpen` is what
 * a click on the card itself runs — so the two together are how a press on a trigger is
 * shown to change a property *instead of* opening the issue.
 */
interface BoardHandlers {
  onProperty?: BoardProps['onProperty'];
  onOpen?: BoardProps['onOpen'];
}

function renderBoard(properties: readonly DisplayProperty[], handlers: BoardHandlers = {}) {
  const engine = { store: seeded(), mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <Board
          groups={GROUPS}
          display={{ ...DEFAULT_DISPLAY, layout: 'board', properties }}
          selected={new Set()}
          cursorId={null}
          label="Engineering"
          onOpen={handlers.onOpen ?? vi.fn()}
          onFocus={vi.fn()}
          onToggle={vi.fn()}
          onExtend={vi.fn()}
          {...(handlers.onProperty === undefined ? {} : { onProperty: handlers.onProperty })}
        />
      </EngineProvider>
    </KeymapProvider>,
  );
}

// jsdom lays nothing out; see Board.test.tsx for why a height is enough.
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

describe('a card', () => {
  it('draws the project as a pill when the display asks for it', () => {
    renderBoard(['project']);

    expect(screen.getByText('Onboarding')).toBeTruthy();
    expect(screen.getByText('🚀')).toBeTruthy();
  });

  it('leaves the project off when the display does not', () => {
    renderBoard(['priority']);

    expect(screen.queryByText('Onboarding')).toBeNull();
  });

  it('says overdue in words, not only in colour', () => {
    renderBoard(['dueDate']);

    expect(screen.getByText('overdue', { exact: false })).toBeTruthy();
  });
});

/**
 * jsdom has no DataTransfer, so a drag carries one of these instead — the same stand-in
 * `Board.test.tsx` hands to both events of a gesture.
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
    carried: () => [...data.values()],
  };
}

function card(): HTMLElement {
  return screen.getByText('Fix the flake').closest('[role="option"]') as HTMLElement;
}

describe('a card whose properties are editable where they are drawn', () => {
  /**
   * Named by the value and not by the property, which is what `PropertyTrigger` promises: a
   * screen reader says "Todo, Change status", so the verb lives in the description and the
   * button's own name is the fact it is showing.
   */
  it('draws status, priority and assignee as buttons named by their value', () => {
    renderBoard(['priority', 'assignee'], { onProperty: vi.fn() });

    expect(screen.getByRole('button', { name: 'Todo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No priority' })).toBeTruthy();
    // The card the seed draws has nobody on it, and that is the one a pointer most needs to
    // be able to fix — before this it had nothing pressable at all.
    expect(screen.getByRole('button', { name: 'Unassigned' })).toBeTruthy();
  });

  it('reports which property was pressed, on which issue, and what to anchor to', async () => {
    const onProperty = vi.fn();
    renderBoard(['priority', 'assignee'], { onProperty });
    const user = userEvent.setup();

    for (const [kind, name] of [
      ['status', 'Todo'],
      ['priority', 'No priority'],
      ['assignee', 'Unassigned'],
    ] as const) {
      onProperty.mockClear();
      const trigger = screen.getByRole('button', { name });

      await user.click(trigger);

      expect(onProperty.mock.calls.length, `pressing ${name} opens one picker`).toBe(1);
      // The board owns no pickers: it reports the kind, the issue, where the cursor should
      // land, and the element the menu hangs off.
      expect(onProperty.mock.calls[0]).toEqual([kind, 'issue-1', 0, trigger]);
    }
  });

  it('does not open the issue when a property is pressed', async () => {
    const onOpen = vi.fn();
    renderBoard(['priority', 'assignee'], { onProperty: vi.fn(), onOpen });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Todo' }));

    expect(
      onOpen.mock.calls.length,
      'changing a status must not also navigate away from the board',
    ).toBe(0);
  });

  /**
   * The buttons sit inside the card's own drag source, and a card that stopped being
   * draggable the moment it grew controls would have traded the board's one gesture for
   * them. A press on a nested button starts the drag exactly as a press on the card does.
   */
  it('still hands the issue to a drag started on it', () => {
    renderBoard(['priority', 'assignee'], { onProperty: vi.fn() });

    const dataTransfer = transfer();
    fireEvent.dragStart(card(), { dataTransfer });

    expect(dataTransfer.getData('text/plain'), 'readable when dropped elsewhere').toBe('ENG-1');
    expect(dataTransfer.carried(), 'and the id a column reads back on drop').toContain('issue-1');
  });
});
