/**
 * Editing a property where it is drawn, without leaving the list.
 *
 * Everything a row showed used to be read-only or a link: the status circle was an `<svg>`,
 * the avatar navigated to the person's issues, and the only way to change either with a
 * pointer was to select the row and use the toolbar at the bottom of the screen. So this file
 * is about the four things that have to be true at once for an inline edit to be worth having.
 *
 * The glyph opens a picker and does not also open the issue — a row's own click opens it, so
 * without a stopped bubble every status change would navigate away from the list it was made
 * in. The write lands on the row that was pressed, unless that row is part of a standing
 * selection, in which case it means the selection: a bulk selection that silently stopped
 * applying the moment you touched one of its members would be worse than no inline edit at
 * all. The bulk toolbar stays down for a one-row change. And exactly one glyph on screen
 * reports itself open, because that is the only thing saying which row the menu belongs to.
 */

import { render, screen, within } from '@testing-library/react';
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

/** Five rows, because the interesting case is a selection that some of them are not in. */
const TITLES = [
  'Fix the flake',
  'Ship the importer',
  'Rewrite the seeder',
  'Trim the bundle',
  'Retire the shim',
];

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | WorkflowState | Issue][] = [
    ['team', team()],
    ['workflowState', state('s-todo', 'Todo', 'unstarted')],
    // A second status, so choosing one is a change rather than a no-op the planner drops.
    ['workflowState', state('s-doing', 'In Progress', 'started')],
    ...TITLES.map((title, at): [string, Issue] => [
      'issue',
      issue(at + 1, title, String.fromCharCode('V'.charCodeAt(0) + at)),
    ]),
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

/** Where the router is now, so "did not navigate" is an assertion rather than an absence. */
function Location() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

function renderList() {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter initialEntries={['/team/ENG']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Location />
          <Routes>
            <Route path="/team/:teamKey" element={<IssueList />} />
            <Route path="*" element={null} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { store, mutate, user: userEvent.setup() };
}

function where(): string {
  return screen.getByTestId('location').textContent ?? '';
}

function row(title: string): HTMLElement {
  return screen.getByRole('option', { name: new RegExp(title) });
}

/** The status circle in one row, which is a control named by the status it is showing. */
function statusGlyph(title: string): HTMLElement {
  return within(row(title)).getByRole('button', { name: 'Todo' });
}

/** The ids a write went out with, however `updateIssues` chose to batch them. */
function writtenIds(mutate: ReturnType<typeof vi.fn>): string[] {
  return mutate.mock.calls.flatMap((call) => {
    const input = (call[0] as { variables: { input?: { ids?: string[]; id?: string } } }).variables
      .input;
    return input?.ids ?? (input?.id === undefined ? [] : [input.id]);
  });
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

describe('a property glyph in a row', () => {
  it('opens the picker for that property instead of opening the issue', async () => {
    const { user } = renderList();

    await user.click(statusGlyph('Ship the importer'));

    expect(screen.getByRole('menu', { name: 'Status' })).toBeTruthy();
    expect(where(), 'the row click that opens an issue must not have fired').toBe('/team/ENG');
  });

  it('writes to the row it was pressed on and to nothing else', async () => {
    const { user, mutate } = renderList();

    await user.click(statusGlyph('Ship the importer'));
    await user.click(screen.getByRole('menuitem', { name: 'In Progress' }));

    expect(writtenIds(mutate)).toEqual(['issue-2']);
  });

  it('names the assignee slot even where there is nobody in it', async () => {
    const { user } = renderList();

    // Previously a dashed circle with nothing behind it: the rows most in need of an
    // assignee were the ones a pointer could do least about.
    await user.click(within(row('Fix the flake')).getByRole('button', { name: 'Unassigned' }));

    expect(screen.getByRole('menu', { name: 'Assignee' })).toBeTruthy();
  });

  it('reports itself open, and is the only glyph on screen that does', async () => {
    const { user } = renderList();

    await user.click(statusGlyph('Ship the importer'));

    const expanded = screen
      .getAllByRole('button', { name: 'Todo' })
      .filter((glyph) => glyph.getAttribute('aria-expanded') === 'true');
    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toBe(statusGlyph('Ship the importer'));
  });

  it('leaves the bulk toolbar down, because one row is not a bulk edit', async () => {
    const { user } = renderList();

    await user.click(statusGlyph('Ship the importer'));

    expect(screen.queryByRole('group', { name: 'Issue actions' })).toBeNull();
  });
});

describe('a property glyph with a selection standing', () => {
  /** The first three rows, ticked one at a time from the keyboard. */
  async function selectThree(user: ReturnType<typeof userEvent.setup>) {
    await user.keyboard('x');
    await user.keyboard('jx');
    await user.keyboard('jx');
  }

  it('writes the whole selection when the row it is on is part of it', async () => {
    const { user, mutate } = renderList();

    await selectThree(user);
    await user.click(statusGlyph('Ship the importer'));
    await user.click(screen.getByRole('menuitem', { name: 'In Progress' }));

    expect(new Set(writtenIds(mutate))).toEqual(new Set(['issue-1', 'issue-2', 'issue-3']));
  });

  it('writes only its own row when that row is outside the selection', async () => {
    const { user, mutate } = renderList();

    await selectThree(user);
    await user.click(statusGlyph('Retire the shim'));
    await user.click(screen.getByRole('menuitem', { name: 'In Progress' }));

    // The selection is untouched, and so are the three issues in it: pressing a glyph on a
    // row you did not select is a statement about that row.
    expect(writtenIds(mutate)).toEqual(['issue-5']);
  });
});
