import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider, useKeyContext } from '~/app/keymap';
import { isValidFilter, type FilterNode } from '~/filter';
import { Store, type Change, type Team, type User, type WorkflowState } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { FilterBar } from './FilterBar';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => ANA,
  useViewer: () => ({ id: ANA, role: 'member' }),
}));

/**
 * The bar as it is edited, rather than as it is read.
 *
 * `FilterBar.test.tsx` is about the contract with the grammar — every tree that leaves here
 * is one `validateFilter` accepts, and every chip says what its clause means. These are about
 * the half of the bar that is an editor: the keystroke that reaches the URL and comes back,
 * the bracket that could be read and not built, and the two pickers that offered the wrong
 * control for the operator they were under.
 */

const WORKSPACE = '00000000-0000-4000-8000-000000000001';
const TEAM = '00000000-0000-4000-8000-000000000002';
const STATE_DOING = '00000000-0000-4000-8000-000000000003';
const ANA = '00000000-0000-4000-8000-000000000005';

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
    id: STATE_DOING,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    name: 'In Progress',
    color: '#5e6ad2',
    category: 'started',
    position: 'V',
    isDefault: false,
    isSystem: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function ana(): User {
  return {
    id: ANA,
    workspaceId: WORKSPACE,
    name: 'ana',
    displayName: 'Ana',
    timezone: 'Europe/Lisbon',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | WorkflowState | User][] = [
    ['team', team()],
    ['workflowState', state()],
    ['user', ana()],
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

/** Pushes the context `F` is registered in, which on the real screen is the issue list. */
function InList({ children }: { children: React.ReactNode }) {
  useKeyContext('list');
  return <>{children}</>;
}

function renderBar(filter: FilterNode = { conj: 'and', nodes: [] }) {
  const engine = { store: seeded(), mutate: vi.fn() } as unknown as SyncEngine;
  const onChange = vi.fn();

  const view = render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <InList>
          <FilterBar filter={filter} onChange={onChange} teamId={TEAM} />
        </InList>
      </EngineProvider>
    </KeymapProvider>,
  );

  const rerenderWith = (next: FilterNode) =>
    view.rerender(
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <InList>
            <FilterBar filter={next} onChange={onChange} teamId={TEAM} />
          </InList>
        </EngineProvider>
      </KeymapProvider>,
    );

  return { onChange, user: userEvent.setup(), view, rerenderWith };
}

/** The AST the bar last emitted. Every assertion about a write goes through this. */
function emitted(onChange: ReturnType<typeof vi.fn>): FilterNode {
  const last = onChange.mock.calls[onChange.mock.calls.length - 1];
  return last?.[0] as FilterNode;
}

/**
 * The keystroke that must not be lost.
 *
 * Publishing goes through the URL, `BrowserRouter` applies a location inside a transition,
 * and a character typed while one is in flight commits against the older location — so the
 * clause arrives back holding the value from *before* that character. An effect that answered
 * every incoming clause by writing it into the box put the older value back and ate the
 * character. Reproduced here by handing the bar the stale clause on purpose, which is exactly
 * what the router does a few milliseconds late.
 */
describe('a typed value while the location is still in flight', () => {
  it('keeps what has been typed when this bar’s own older write lands', async () => {
    const { onChange, user, rerenderWith } = renderBar({
      conj: 'and',
      nodes: [{ field: 'title', op: 'contains', values: [''] }],
    });

    await user.click(screen.getByRole('button', { name: 'Title contains ""' }));
    const box = screen.getByRole('textbox', { name: 'Value' });
    await user.type(box, 'ab');

    expect(emitted(onChange)).toEqual({
      conj: 'and',
      nodes: [{ field: 'title', op: 'contains', values: ['ab'] }],
    });

    // The location carrying "a" lands after the box already says "ab".
    rerenderWith({ conj: 'and', nodes: [{ field: 'title', op: 'contains', values: ['a'] }] });
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveProperty('value', 'ab');

    // And the newer one, when it arrives, changes nothing.
    rerenderWith({ conj: 'and', nodes: [{ field: 'title', op: 'contains', values: ['ab'] }] });
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveProperty('value', 'ab');
  });

  it('still follows a value that came from somewhere else', async () => {
    const { user, rerenderWith } = renderBar({
      conj: 'and',
      nodes: [{ field: 'title', op: 'contains', values: ['login'] }],
    });

    await user.click(screen.getByRole('button', { name: 'Title contains "login"' }));
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveProperty('value', 'login');

    // The back button, or a link: nothing this box wrote, so the box has to follow it.
    rerenderWith({
      conj: 'and',
      nodes: [{ field: 'title', op: 'contains', values: ['redirect'] }],
    });
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveProperty('value', 'redirect');
  });
});

describe('the keyboard', () => {
  // `F` is what the docs promise opens the filter menu, and it belongs to the registry: a
  // local handler would work and would appear in neither the command menu nor the help.
  it('opens the field menu on F', async () => {
    const { user } = renderBar();

    const trigger = screen.getByRole('button', { name: 'Add filter' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await user.keyboard('f');

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('groups', () => {
  /**
   * "(A or B) and C" has two conjunctions, and the brackets on screen say so. One control
   * rewriting both from either bracket would change the half nobody was pointing at.
   */
  it('flips one group without touching its parent', async () => {
    const { onChange, user } = renderBar({
      conj: 'and',
      nodes: [
        { field: 'state', op: 'eq', values: [STATE_DOING] },
        {
          conj: 'or',
          nodes: [
            { field: 'priority', op: 'eq', values: ['1'] },
            { field: 'priority', op: 'eq', values: ['2'] },
          ],
        },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'or' }));

    const next = emitted(onChange) as { conj: string; nodes: { conj?: string }[] };
    expect(next.conj).toBe('and');
    expect(next.nodes[1]?.conj).toBe('and');
    expect(isValidFilter(next as FilterNode)).toBe(true);
  });

  /**
   * The only way to *make* a bracket from the interface. The empty sibling is deliberate: an
   * AND over nothing is vacuously true, so the filter still matches exactly what it did a
   * moment before and nothing on screen jumps while the user decides what goes in it.
   */
  it('wraps what is there and opens a bracket beside it', async () => {
    const { onChange, user } = renderBar({
      conj: 'or',
      nodes: [{ field: 'priority', op: 'eq', values: ['1'] }],
    });

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(screen.getByText('Advanced filter'));

    expect(emitted(onChange)).toEqual({
      conj: 'and',
      nodes: [
        { conj: 'or', nodes: [{ field: 'priority', op: 'eq', values: ['1'] }] },
        { conj: 'and', nodes: [] },
      ],
    });
    expect(isValidFilter(emitted(onChange))).toBe(true);
  });

  // A bracket nobody can put a clause into is not an advanced filter, it is a pair of
  // parentheses somebody is stuck with.
  it('adds a clause inside a bracket rather than beside it', async () => {
    const { onChange, user } = renderBar({
      conj: 'and',
      nodes: [{ conj: 'or', nodes: [{ field: 'priority', op: 'eq', values: ['1'] }] }],
    });

    await user.click(screen.getByRole('button', { name: 'Add a filter to this group' }));
    await user.click(screen.getByText('Estimate'));

    expect(emitted(onChange)).toEqual({
      conj: 'and',
      nodes: [
        {
          conj: 'or',
          nodes: [
            { field: 'priority', op: 'eq', values: ['1'] },
            { field: 'estimate', op: 'eq', values: ['1'] },
          ],
        },
      ],
    });
    expect(isValidFilter(emitted(onChange))).toBe(true);
  });

  it('takes a whole bracket away', async () => {
    const { onChange, user } = renderBar({
      conj: 'and',
      nodes: [
        { field: 'state', op: 'eq', values: [STATE_DOING] },
        { conj: 'and', nodes: [] },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Remove this group of filters' }));

    expect(emitted(onChange)).toEqual({
      conj: 'and',
      nodes: [{ field: 'state', op: 'eq', values: [STATE_DOING] }],
    });
  });
});

/**
 * A chip carries its value's icon, which is what the composition rules ask of every trigger
 * that has one. The picker inside the popover already drew a status in its own colour; the
 * chip that popover writes to drew the name alone — the same value in two vocabularies, a
 * centimetre apart.
 */
describe('a chip’s glyph', () => {
  it('draws the value’s mark without changing what is announced', () => {
    renderBar({ conj: 'and', nodes: [{ field: 'state', op: 'eq', values: [STATE_DOING] }] });

    const chip = screen.getByRole('button', { name: 'Status is In Progress' });
    // Decorative: the sentence already names the value, so the mark is hidden from the tree
    // and the accessible name above is unchanged.
    expect(chip.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });

  it('draws a priority from the clause alone, with no store lookup', () => {
    renderBar({ conj: 'and', nodes: [{ field: 'priority', op: 'eq', values: ['1'] }] });

    const chip = screen.getByRole('button', { name: 'Priority is Urgent' });
    expect(chip.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });

  it('draws nothing for a value with no canonical mark', () => {
    renderBar({ conj: 'and', nodes: [{ field: 'title', op: 'contains', values: ['login'] }] });

    const chip = screen.getByRole('button', { name: 'Title contains "login"' });
    expect(chip.querySelector('svg')).toBeNull();
  });
});

describe('customer tier', () => {
  // A workspace can have a dozen tiers, so the box that finds one is wanted for the same
  // reason a status list wants it. It is not a uuid field, which is why the type alone was
  // the wrong question.
  it('can be searched like any other list', async () => {
    const { user } = renderBar({
      conj: 'and',
      nodes: [{ field: 'customerTier', op: 'in', values: [] }],
    });

    await user.click(screen.getByRole('button', { name: 'Customer tier needs a value' }));

    expect(screen.getByRole('textbox', { name: 'Search customer tier' })).toBeTruthy();
  });

  // `contains` matches a fragment, and every fragment worth searching for is one no option in
  // the list spells — so a picker of checkboxes was a clause nobody could fill in.
  it('is typed rather than ticked under contains', async () => {
    const { user } = renderBar({
      conj: 'and',
      nodes: [{ field: 'customerTier', op: 'contains', values: ['ent'] }],
    });

    await user.click(screen.getByRole('button', { name: 'Customer tier contains "ent"' }));

    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveProperty('value', 'ent');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
