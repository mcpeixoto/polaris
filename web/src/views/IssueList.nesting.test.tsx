/**
 * The list once families are nested, and the context row in particular: it is drawn like a row
 * and is not one of the group's issues, so everything that walks rows has to step past it.
 *
 * On screen, grouped by status:
 *
 *   Todo     ENG-1 Plan the launch
 *              ENG-2 Book the venue          child, parent right above
 *            ENG-3 Unrelated work
 *            ~ENG-5 Rewrite the seeder       context, the parent is in Backlog
 *              ENG-4 Port the fixtures       child of a parent in another group
 *              ENG-7 Port the snapshots
 *            ENG-6 Audit the private thing   parent is not in the replica
 *   Backlog  ENG-5 Rewrite the seeder
 */

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
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

function issue(
  number: number,
  title: string,
  sortOrder: string,
  stateId = 's-todo',
  parentId?: string,
): Issue {
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
    ...(parentId === undefined ? {} : { parentId }),
  };
}

function upsert(entities: [string, Team | WorkflowState | Issue][], from = 1): Change[] {
  return entities.map(([type, entity], index) => ({
    v: from + index,
    type,
    id: entity.id,
    op: 'upsert' as const,
    actor: { type: 'system' as const },
    payload: entity,
  })) as Change[];
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    upsert([
      ['team', team()],
      ['workflowState', state('s-todo', 'Todo', 'unstarted')],
      ['workflowState', state('s-backlog', 'Backlog', 'backlog')],
      ['issue', issue(1, 'Plan the launch', 'a')],
      ['issue', issue(3, 'Unrelated work', 'b')],
      ['issue', issue(4, 'Port the fixtures', 'c', 's-todo', 'issue-5')],
      ['issue', issue(2, 'Book the venue', 'd', 's-todo', 'issue-1')],
      ['issue', issue(7, 'Port the snapshots', 'e', 's-todo', 'issue-5')],
      ['issue', issue(6, 'Audit the private thing', 'f', 's-todo', 'not-in-the-replica')],
      ['issue', issue(5, 'Rewrite the seeder', 'g', 's-backlog')],
    ]),
  );
  return store;
}

let pathname = '';
function LocationProbe() {
  pathname = useLocation().pathname;
  return null;
}

function renderList(search = '') {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter initialEntries={[`/team/ENG${search}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <LocationProbe />
          <Routes>
            <Route path="/team/:teamKey" element={<IssueList />} />
            <Route path="/issue/:identifier" element={null} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { store, mutate, user: userEvent.setup() };
}

function grid(): HTMLElement {
  return screen.getByRole('grid', { name: 'Engineering issues' });
}

function identifiersOnScreen(): string[] {
  return within(grid())
    .getAllByRole('gridcell')
    .map((cell) => /ENG-\d+/.exec(cell.textContent ?? '')?.[0] ?? '')
    .filter(Boolean);
}

function rowOf(title: string): HTMLElement {
  return screen.getAllByRole('row').find((row) => row.textContent?.includes(title))!;
}

/** The context row of ENG-5, which is the first of the two rows naming it. */
function contextRow(): HTMLElement {
  return screen.getAllByRole('row').find((row) => row.textContent?.includes('Parent issue'))!;
}

function cursorText(): string | null {
  const id = grid().getAttribute('aria-activedescendant');
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

describe('the arrangement', () => {
  it('nests a family and draws a parent from another group above its first child', () => {
    renderList();
    expect(identifiersOnScreen()).toEqual([
      'ENG-1',
      'ENG-2',
      'ENG-3',
      'ENG-5',
      'ENG-4',
      'ENG-7',
      'ENG-6',
      'ENG-5',
    ]);
  });

  it('draws a parent from outside the view the same way', () => {
    const { store } = renderList('?group=none&completed=false');
    expect(rowOf('Rewrite the seeder').textContent).not.toContain('Parent issue');

    // Finished, so the view drops it. Its children are still in the view and still its children.
    act(() => {
      store.applyChanges(
        upsert(
          [
            ['workflowState', state('s-done', 'Done', 'completed')],
            ['issue', issue(5, 'Rewrite the seeder', 'g', 's-done')],
          ],
          100,
        ),
      );
    });

    expect(rowOf('Rewrite the seeder').textContent).toContain('Parent issue');
    expect(identifiersOnScreen()).toEqual([
      'ENG-1',
      'ENG-2',
      'ENG-3',
      'ENG-5',
      'ENG-4',
      'ENG-7',
      'ENG-6',
    ]);
  });

  it('hides the crumb under a parent, and keeps saying whose it is to a reader', () => {
    renderList();
    const child = within(rowOf('Book the venue')).getByRole('gridcell');
    expect(within(child).queryByText('ENG-1')).toBeNull();
    expect(within(child).getByText('Sub-issue of ENG-1')).toBeTruthy();
  });

  it('keeps the crumb off a row whose parent cannot be read, with no indent', () => {
    renderList();
    const row = rowOf('Audit the private thing');
    expect(row.style.getPropertyValue('--nest-depth')).toBe('0');
    expect(within(row).queryByText(/Sub-issue/)).toBeNull();
  });

  it('indents by the depth it was given', () => {
    renderList();
    expect(rowOf('Plan the launch').style.getPropertyValue('--nest-depth')).toBe('0');
    expect(rowOf('Book the venue').style.getPropertyValue('--nest-depth')).toBe('1');
    expect(contextRow().style.getPropertyValue('--nest-depth')).toBe('0');
    expect(rowOf('Port the fixtures').style.getPropertyValue('--nest-depth')).toBe('1');
  });

  /**
   * Giving an issue a parent leaves the group's ids exactly as they were, so a nesting memoised
   * on `groups` alone would go on drawing the old family.
   */
  it('follows a parent set in another session', () => {
    const { store } = renderList();
    expect(rowOf('Unrelated work').style.getPropertyValue('--nest-depth')).toBe('0');

    act(() => {
      store.applyChanges(
        upsert([['issue', issue(3, 'Unrelated work', 'b', 's-todo', 'issue-1')]], 100),
      );
    });

    expect(rowOf('Unrelated work').style.getPropertyValue('--nest-depth')).toBe('1');
    expect(identifiersOnScreen().slice(0, 3)).toEqual(['ENG-1', 'ENG-3', 'ENG-2']);
  });

  it("follows the parent's own edit on the context row", () => {
    const { store } = renderList();
    act(() => {
      store.applyChanges(upsert([['issue', issue(5, 'Renamed', 'g', 's-backlog')]], 100));
    });
    expect(within(contextRow()).getByRole('link').textContent).toContain('Renamed');
  });
});

describe('the context row', () => {
  it('counts nothing: the heading says how many issues are in the group', () => {
    renderList();
    // Six in Todo with the context row drawn among them; the row is the seventh.
    const heading = screen.getAllByRole('row')[0]!;
    expect(heading.textContent).toContain('Todo');
    expect(within(heading).getByText('6')).toBeTruthy();
  });

  it('has no checkbox and claims no selection', () => {
    renderList();
    const row = contextRow();
    expect(within(row).queryByRole('checkbox')).toBeNull();
    expect(row.hasAttribute('aria-selected')).toBe(false);
  });

  it('opens the parent', async () => {
    const { user } = renderList();
    await user.click(within(contextRow()).getByRole('gridcell'));
    expect(pathname).toBe('/issue/ENG-5');
  });

  it('is a link a keyboard can reach', () => {
    renderList();
    expect(within(contextRow()).getByRole('link').getAttribute('href')).toBe('/issue/ENG-5');
  });

  it('is stepped past by J and K', async () => {
    const { user } = renderList();
    // ENG-1, ENG-2, ENG-3, then over the context row to ENG-4.
    await user.keyboard('jj');
    expect(cursorText()).toContain('Unrelated work');
    await user.keyboard('j');
    expect(cursorText()).toContain('Port the fixtures');
    await user.keyboard('k');
    expect(cursorText()).toContain('Unrelated work');
  });

  it("stays out of select-all, and select-all still reaches the parent's real row", async () => {
    const { user } = renderList();
    await user.keyboard('{Control>}a{/Control}');
    // Six in Todo and the parent's own row in Backlog; the context row adds nothing.
    expect(screen.getByText('7 selected')).toBeTruthy();
    expect(contextRow().hasAttribute('aria-selected')).toBe(false);
  });

  it('stays out of a shift-range that crosses it', async () => {
    const { user } = renderList();
    await user.keyboard('jj');
    // From ENG-3 across the context row to ENG-4: two issues, not three.
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(rowOf('Unrelated work').getAttribute('aria-selected')).toBe('true');
    expect(rowOf('Port the fixtures').getAttribute('aria-selected')).toBe('true');
  });
});

describe('manual order with families', () => {
  // No grouping and manual order, the one arrangement the move keys are on in. Everything is
  // in the one group, so ENG-5 is a real parent here. On screen: 1, 2, 3, 6, 5, 4, 7.
  // In flat order: 1, 3, 4, 2, 7, 6, 5.
  const MANUAL = '?group=none&order=manual';

  function lastInput(mutate: ReturnType<typeof vi.fn>) {
    const call = mutate.mock.calls.at(-1)?.[0] as {
      variables: { input: { id: string; afterIssueId?: string; moveToTop?: boolean } };
    };
    return call.variables.input;
  }

  it('moves a child among its siblings and not past the row under them', async () => {
    const { user, mutate } = renderList(MANUAL);
    await user.keyboard('jjjjj');
    expect(cursorText()).toContain('Port the fixtures');
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(lastInput(mutate)).toMatchObject({ id: 'issue-4', afterIssueId: 'issue-7' });
  });

  it('does nothing for the last sibling, whatever sits beneath it on screen', async () => {
    const { user, mutate } = renderList(MANUAL);
    await user.keyboard('jjjjjj');
    expect(cursorText()).toContain('Port the snapshots');
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('moves a top-level row past a whole family as one place', async () => {
    const { user, mutate } = renderList(MANUAL);
    expect(cursorText()).toContain('Plan the launch');
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(lastInput(mutate)).toMatchObject({ id: 'issue-1', afterIssueId: 'issue-3' });
  });
});
