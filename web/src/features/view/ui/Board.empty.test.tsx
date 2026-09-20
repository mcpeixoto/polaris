/**
 * Setting a property a card does not have yet.
 *
 * `Board.card.test.tsx` covers the half that already worked: a property with a value is a
 * button, and pressing it reports the picker to open. The half that did not is this one — a
 * pill drawn only when its value was non-null meant project, cycle, estimate and due date
 * could be *changed* with a pointer and never *set* with one, so the cards most in need of a
 * project were the cards a pointer could do least about.
 *
 * The cycle is new to the card altogether. The list row had drawn it for as long as the
 * display menu has offered it and the board had not, which made "Cycle" a tick that did
 * nothing on one of the two layouts it claims to control.
 *
 * A sibling file rather than more cases in `Board.card.test.tsx`, because the team there
 * deliberately estimates nothing and runs no cycles, and the placeholders are gated on
 * exactly those two settings — changing that seed would change what its cases are about.
 */

import { render, screen } from '@testing-library/react';
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

/**
 * A team that both estimates and runs cycles. Those two settings are what decide whether the
 * permanent placeholders exist at all, so `plans: false` is the other half of the test.
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

/** The issue under test carries none of the four properties. That is the whole point of it. */
function seeded(options: { plans: boolean; cycleId?: string }): Store {
  const entities: [string, Entity][] = [
    ['team', team(options.plans)],
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
        ...(options.cycleId === undefined ? {} : { cycleId: options.cycleId }),
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
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

const GROUPS: readonly ViewGroup[] = [
  { key: 's-todo', label: 'Todo', stateId: 's-todo', ids: ['issue-1'] },
];

/** Everything the display menu can show, so `cycle` — which is not a default — is on. */
const EVERYTHING: readonly DisplayProperty[] = [
  ...DEFAULT_DISPLAY.properties,
  'cycle',
] as readonly DisplayProperty[];

/**
 * A board under a screen that owns the pickers, which is every board in the product.
 *
 * `editable: false` is the other shape the component supports — a board handed no
 * `onProperty` at all, whose pills are inert spans. It is a separate argument rather than a
 * separate helper because the interesting claim is what the *same* seed draws either way.
 */
function renderBoard(options: { plans?: boolean; cycleId?: string; editable?: boolean } = {}): {
  onProperty: ReturnType<typeof vi.fn>;
  user: ReturnType<typeof userEvent.setup>;
} {
  const engine = {
    store: seeded({
      plans: options.plans ?? true,
      ...(options.cycleId === undefined ? {} : { cycleId: options.cycleId }),
    }),
    mutate: vi.fn(),
  } as unknown as SyncEngine;
  const onProperty = vi.fn();
  const editable = options.editable ?? true;
  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <Board
          groups={GROUPS}
          display={{ ...DEFAULT_DISPLAY, layout: 'board', properties: EVERYTHING }}
          selected={new Set()}
          cursorId={null}
          label="Engineering"
          onOpen={vi.fn()}
          onFocus={vi.fn()}
          onToggle={vi.fn()}
          onExtend={vi.fn()}
          {...(editable ? { onProperty: onProperty as BoardProps['onProperty'] } : {})}
        />
      </EngineProvider>
    </KeymapProvider>,
  );
  return { onProperty, user: userEvent.setup() };
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

describe('a card whose properties are not set yet', () => {
  it('offers a control for every one of them, named for the hole it fills', () => {
    renderBoard();

    for (const name of ['No project', 'No cycle', 'No estimate', 'No due date']) {
      expect(
        screen.getByRole('button', { name }),
        `${name} has to be pressable before it has a value, or it can never get one`,
      ).toBeTruthy();
    }
  });

  it('reports which empty property was pressed, on which issue, and what to anchor to', async () => {
    const { onProperty, user } = renderBoard();

    for (const [kind, name] of [
      ['project', 'No project'],
      ['cycle', 'No cycle'],
      ['estimate', 'No estimate'],
      ['due', 'No due date'],
    ] as const) {
      onProperty.mockClear();
      const trigger = screen.getByRole('button', { name });

      await user.click(trigger);

      expect(onProperty.mock.calls.length, `pressing ${name} opens one picker`).toBe(1);
      expect(onProperty.mock.calls[0]).toEqual([kind, 'issue-1', 0, trigger]);
    }
  });

  /**
   * A permanent "No estimate" on a team that sizes nothing, or "No cycle" on a team that
   * runs none, is a dashed pill for a field the team has turned off — and it would open a
   * picker with nothing in it. Project and due date are unconditional because every
   * workspace has both.
   */
  it('leaves cycle and estimate off entirely where the team uses neither', () => {
    renderBoard({ plans: false });

    expect(screen.queryByRole('button', { name: 'No cycle' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'No estimate' })).toBeNull();
    expect(screen.getByRole('button', { name: 'No project' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No due date' })).toBeTruthy();
  });

  /**
   * A board with no pickers behind it draws its pills as inert spans. A dashed pill reading
   * "No cycle" that does nothing when pressed is an empty slot with no way to fill it, so
   * there the placeholders are not drawn at all.
   */
  it('draws no placeholders where nothing could open a picker', () => {
    renderBoard({ editable: false });

    for (const name of ['No project', 'No cycle', 'No estimate', 'No due date']) {
      expect(screen.queryByText(name)).toBeNull();
      expect(screen.queryByLabelText(name)).toBeNull();
    }
  });
});

describe('the cycle on a card', () => {
  it('is drawn, which it had never been even though the list row draws it', () => {
    renderBoard({ cycleId: 'cycle-1' });

    expect(screen.getByText('Cycle 7')).toBeTruthy();
  });

  it('is a control, named by the cycle rather than by the property', async () => {
    const { onProperty, user } = renderBoard({ cycleId: 'cycle-1' });

    const trigger = screen.getByRole('button', { name: 'Cycle 7' });
    await user.click(trigger);

    expect(onProperty.mock.calls[0]).toEqual(['cycle', 'issue-1', 0, trigger]);
  });

  it('is left off when the display menu does not ask for it', () => {
    const engine = { store: seeded({ plans: true, cycleId: 'cycle-1' }), mutate: vi.fn() };
    render(
      <KeymapProvider>
        <EngineProvider engine={engine as unknown as SyncEngine} status={{ phase: 'idle' }}>
          <Board
            groups={GROUPS}
            display={{ ...DEFAULT_DISPLAY, layout: 'board' }}
            selected={new Set()}
            cursorId={null}
            label="Engineering"
            onOpen={vi.fn()}
            onFocus={vi.fn()}
            onToggle={vi.fn()}
            onExtend={vi.fn()}
            onProperty={vi.fn()}
          />
        </EngineProvider>
      </KeymapProvider>,
    );

    expect(screen.queryByText('Cycle 7')).toBeNull();
    expect(screen.queryByRole('button', { name: 'No cycle' })).toBeNull();
  });
});
