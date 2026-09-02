import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { isValidFilter, type FilterNode } from '~/filter';
import { Store, type Change, type Label, type Team, type User, type WorkflowState } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { FilterBar } from './FilterBar';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => ANA,
  useViewer: () => ({ id: ANA, role: 'member' }),
}));

/**
 * The bar, driven the way it is used: against a real store, through the interface.
 *
 * What is worth testing here is the contract with the grammar rather than the rendering.
 * The bar's whole job is to be the only thing in the product that *writes* a filter by
 * hand, and the two ways that goes wrong are silent: a chip that reads back something other
 * than what the clause says, and an emitted AST that `validateFilter` will reject when the
 * link is opened again. So every test below either reads a chip as a person would, or
 * checks what came out of `onChange` against `isValidFilter`.
 */

const WORKSPACE = '00000000-0000-4000-8000-000000000001';
const TEAM = '00000000-0000-4000-8000-000000000002';
const STATE_DOING = '00000000-0000-4000-8000-000000000003';
const STATE_TODO = '00000000-0000-4000-8000-000000000004';
const ANA = '00000000-0000-4000-8000-000000000005';
const BO = '00000000-0000-4000-8000-000000000006';
const BUG = '00000000-0000-4000-8000-000000000007';

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

function user(id: string, displayName: string): User {
  return {
    id,
    workspaceId: WORKSPACE,
    name: displayName.toLowerCase(),
    displayName,
    timezone: 'Europe/Lisbon',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  };
}

function label(id: string, name: string): Label {
  return {
    id,
    workspaceId: WORKSPACE,
    isGroup: false,
    name,
    color: '#e5484d',
    position: 'V',
    createdAt: AT,
    updatedAt: AT,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | WorkflowState | User | Label][] = [
    ['team', team()],
    ['workflowState', state(STATE_DOING, 'In Progress', 'started')],
    ['workflowState', state(STATE_TODO, 'Todo', 'unstarted')],
    ['user', user(ANA, 'Ana')],
    ['user', user(BO, 'Bo')],
    ['label', label(BUG, 'Bug')],
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

interface RenderOptions {
  readonly filter?: FilterNode;
  readonly error?: string | null;
}

function renderBar({ filter = { conj: 'and', nodes: [] }, error = null }: RenderOptions = {}) {
  const engine = { store: seeded(), mutate: vi.fn() } as unknown as SyncEngine;
  const onChange = vi.fn();

  const view = render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <FilterBar filter={filter} onChange={onChange} teamId={TEAM} error={error} />
      </EngineProvider>
    </KeymapProvider>,
  );

  return { onChange, user: userEvent.setup(), view };
}

/** The AST the bar last emitted. Every assertion about a write goes through this. */
function emitted(onChange: ReturnType<typeof vi.fn>): FilterNode {
  const last = onChange.mock.calls[onChange.mock.calls.length - 1];
  return last?.[0] as FilterNode;
}

describe('FilterBar', () => {
  it('reads a clause as a sentence, with names rather than ids', () => {
    renderBar({
      filter: {
        conj: 'and',
        nodes: [
          { field: 'state', op: 'eq', values: [STATE_DOING] },
          { field: 'assignee', op: 'in', values: [ANA, BO] },
          { field: 'label', op: 'notIn', values: [BUG] },
          { field: 'dueDate', op: 'lt', values: ['today'] },
        ],
      },
    });

    expect(screen.getByRole('button', { name: 'Status is In Progress' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Assignee is any of Ana, Bo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Label is none of Bug' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Due date before today' })).toBeTruthy();

    // Not one uuid anywhere on screen: a chip that shows an id is a chip nobody can read.
    expect(screen.queryByText(new RegExp(STATE_DOING))).toBeNull();
  });

  it('says what a clause with no values yet is waiting for', () => {
    renderBar({ filter: { conj: 'and', nodes: [{ field: 'label', op: 'in', values: [] }] } });

    // `in []` matches nothing, which is true and is not what the user meant by adding it a
    // moment ago.
    expect(screen.getByRole('button', { name: 'Label needs a value' })).toBeTruthy();
  });

  it('removes a chip without disturbing the rest of the filter', async () => {
    const { onChange, user } = renderBar({
      filter: {
        conj: 'and',
        nodes: [
          { field: 'state', op: 'eq', values: [STATE_DOING] },
          { field: 'priority', op: 'eq', values: ['1'] },
        ],
      },
    });

    await user.click(screen.getByRole('button', { name: 'Remove filter: Status is In Progress' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(emitted(onChange)).toEqual({
      conj: 'and',
      nodes: [{ field: 'priority', op: 'eq', values: ['1'] }],
    });
    expect(isValidFilter(emitted(onChange))).toBe(true);
  });

  it('toggles the top-level conjunction', async () => {
    const { onChange, user } = renderBar({
      filter: {
        conj: 'and',
        nodes: [
          { field: 'priority', op: 'eq', values: ['1'] },
          { field: 'estimate', op: 'gt', values: ['3'] },
        ],
      },
    });

    await user.click(screen.getByRole('button', { name: 'and' }));

    expect(emitted(onChange)).toMatchObject({ conj: 'or' });
    expect(isValidFilter(emitted(onChange))).toBe(true);
  });

  it('adds a clause that the grammar accepts', async () => {
    const { onChange, user } = renderBar();

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(screen.getByRole('menuitem', { name: /Priority/ }));

    const next = emitted(onChange);
    expect(isValidFilter(next)).toBe(true);
    expect(next).toEqual({
      conj: 'and',
      nodes: [{ field: 'priority', op: 'eq', values: ['1'] }],
    });
  });

  it('adds a uuid clause as an empty `in`, which is the only valid way to say "not yet"', async () => {
    const { onChange, user } = renderBar();

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(screen.getByRole('menuitem', { name: /Assignee/ }));

    const next = emitted(onChange);
    expect(isValidFilter(next)).toBe(true);
    expect(next).toEqual({ conj: 'and', nodes: [{ field: 'assignee', op: 'in', values: [] }] });
  });

  it('drops the values when the operator stops taking any', async () => {
    const { onChange, user } = renderBar({
      filter: { conj: 'and', nodes: [{ field: 'assignee', op: 'eq', values: [ANA] }] },
    });

    await user.click(screen.getByRole('button', { name: 'Assignee is Ana' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Condition' }), 'isNull');

    const next = emitted(onChange) as { nodes: Record<string, unknown>[] };
    // Absent, not merely empty: a clause carrying values `isNull` cannot use is one the
    // validator rejects outright.
    expect(next.nodes[0]).toEqual({ field: 'assignee', op: 'isNull' });
    expect(next.nodes[0] === undefined ? true : 'values' in next.nodes[0]).toBe(false);
    expect(isValidFilter(next)).toBe(true);
  });

  it('keeps one value when the operator narrows from many to one', async () => {
    const { onChange, user } = renderBar({
      filter: { conj: 'and', nodes: [{ field: 'assignee', op: 'in', values: [ANA, BO] }] },
    });

    await user.click(screen.getByRole('button', { name: 'Assignee is any of Ana, Bo' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Condition' }), 'eq');

    // `eq` takes exactly one value, so the extra ones are dropped rather than carried into
    // a clause the validator would reject for having two.
    expect(emitted(onChange)).toEqual({
      conj: 'and',
      nodes: [{ field: 'assignee', op: 'eq', values: [ANA] }],
    });
    expect(isValidFilter(emitted(onChange))).toBe(true);
  });

  it('gives a one-value operator a value rather than emitting a clause without one', async () => {
    const { onChange, user } = renderBar({
      filter: { conj: 'and', nodes: [{ field: 'label', op: 'in', values: [] }] },
    });

    await user.click(screen.getByRole('button', { name: 'Label needs a value' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Condition' }), 'eq');

    // There is no legal `label eq` with nothing in it, so switching to it takes the first
    // candidate. The alternative is a clause the next page load cannot read.
    expect(emitted(onChange)).toEqual({
      conj: 'and',
      nodes: [{ field: 'label', op: 'eq', values: [BUG] }],
    });
    expect(isValidFilter(emitted(onChange))).toBe(true);
  });

  it('withholds a one-value operator when the workspace has no candidate at all', async () => {
    // No issues are seeded, so a parent clause has nothing it could possibly be `eq` to.
    const { user } = renderBar({
      filter: { conj: 'and', nodes: [{ field: 'parent', op: 'in', values: [] }] },
    });

    await user.click(screen.getByRole('button', { name: 'Parent needs a value' }));

    const disabled = Object.fromEntries(
      [...screen.getByRole('combobox', { name: 'Condition' }).querySelectorAll('option')].map(
        (option) => [option.value, option.hasAttribute('disabled')],
      ),
    );
    expect(disabled['eq']).toBe(true);
    // The two that can express an empty filter are still there, and so is "is empty" — a
    // parent is nullable, and "has no parent" is a perfectly good thing to ask for.
    expect(disabled['in']).toBe(false);
    expect(disabled['isNull']).toBe(false);
  });

  it('ticks a value into a multi-valued clause', async () => {
    const { onChange, user } = renderBar({
      filter: { conj: 'and', nodes: [{ field: 'label', op: 'in', values: [] }] },
    });

    await user.click(screen.getByRole('button', { name: 'Label needs a value' }));
    await user.click(screen.getByRole('checkbox', { name: 'Bug' }));

    expect(emitted(onChange)).toEqual({
      conj: 'and',
      nodes: [{ field: 'label', op: 'in', values: [BUG] }],
    });
    expect(isValidFilter(emitted(onChange))).toBe(true);
  });

  /**
   * The picker used to be a column of plain names.
   *
   * Every one of these values is drawn with a glyph everywhere else in the product — a
   * StateIcon for a status, an Avatar for a person, a dot for a label — so choosing one here
   * meant reading a list that looked nothing like the list it filters. The assertion is on
   * the mark being inside the option's own label, because a glyph rendered anywhere else in
   * the popover is not the one that says which row it belongs to.
   */
  it('draws a value with the glyph the rest of the product uses for it', async () => {
    const { user } = renderBar({
      filter: { conj: 'and', nodes: [{ field: 'state', op: 'in', values: [] }] },
    });

    await user.click(screen.getByRole('button', { name: 'Status needs a value' }));

    // Reached through the name rather than through the checkbox, because Checkbox paints its
    // own tick as an svg and "there is an svg in here somewhere" would have passed before the
    // glyph existed. The mark is the element immediately before the name, which is the one
    // place it can be and still read as belonging to this row. Decorative, and so not
    // reachable by role: the text already names the status.
    const name = screen.getByText('In Progress');
    expect(name.previousElementSibling?.tagName.toLowerCase()).toBe('svg');
  });

  it('renders a nested group with its own conjunction, offered as its own control', () => {
    renderBar({
      filter: {
        conj: 'and',
        nodes: [
          { field: 'state', op: 'eq', values: [STATE_DOING] },
          {
            conj: 'or',
            nodes: [
              { field: 'assignee', op: 'eq', values: [ANA] },
              { field: 'assignee', op: 'eq', values: [BO] },
            ],
          },
        ],
      },
    });

    expect(screen.getByRole('group', { name: 'Any of these' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Assignee is Ana' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Assignee is Bo' })).toBeTruthy();
    // The nested conjunction is its own control: each group flips its own AND/OR, so the
    // inner "or" is a button beside the top-level "and".
    expect(screen.getByRole('button', { name: 'or' })).toBeTruthy();
  });

  it('explains an unreadable filter and offers to clear it', async () => {
    const { onChange, user } = renderBar({
      error: 'nodes[0]: unknown field "assinee"',
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('could not read');
    expect(alert.textContent).toContain('unknown field "assinee"');

    await user.click(screen.getByRole('button', { name: 'Clear filter' }));

    expect(emitted(onChange)).toEqual({ conj: 'and', nodes: [] });
    expect(isValidFilter(emitted(onChange))).toBe(true);
  });
});
