import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider, useActions, useKeymap } from '~/app/keymap';
import { detectPlatform } from '~/keys';
import { Store, type Change, type Issue, type Team, type WorkflowState } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { AdHocIssues } from './AdHocIssues';
import { IssueList } from './IssueList';
import { Triage } from './Triage';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'user-ada',
  useViewer: () => ({ id: 'user-ada', role: 'admin' }),
}));

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

function team(overrides: Partial<Team> = {}): Team {
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
    ...overrides,
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

function seeded(teamOverrides: Partial<Team> = {}): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | WorkflowState | Issue][] = [
    ['team', team(teamOverrides)],
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

/**
 * Reads the registry the way the help overlay does: every action that is bound to a key.
 *
 * Assigned on render rather than returned, because the question is asked *after* the list's
 * own effects have registered — and a value captured at render time would answer for an
 * empty registry.
 */
let boundTitles: () => string[] = () => [];

function KeymapProbe() {
  const { registry } = useKeymap();
  boundTitles = () => [...registry.byGroup().values()].flat().map((action) => action.title);
  return null;
}

function renderList(search = '', teamOverrides: Partial<Team> = {}) {
  const store = seeded(teamOverrides);
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  const dismissed = vi.fn();

  render(
    <MemoryRouter initialEntries={[`/team/ENG${search}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <GlobalDismiss onDismiss={dismissed} />
          <KeymapProbe />
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
  /**
   * The board mounts inside the list, so both register into the same `list` context — and
   * the registry refuses a second unguarded binding on a key rather than letting one of
   * them silently never fire. A board action that claimed `H` or `L` therefore threw inside
   * a passive effect and took the screen down to a blank page, which the URL then made
   * permanent: `?layout=board` crashed again on every reload.
   */
  it('renders the board layout without a keymap conflict', () => {
    renderList('?layout=board');

    // Two columns' worth of cards, so the assertion is that the board rendered rather
    // than that anything at all survived.
    expect(screen.getByText('Fix the flake')).toBeTruthy();
    expect(screen.getByText('Rewrite the seeder')).toBeTruthy();
  });

  it('groups the issues by status, in workflow order', () => {
    renderList();

    const rows = screen.getAllByRole('option').map((option) => option.textContent);
    expect(rows).toEqual([
      'ENG-1Fix the flake',
      'ENG-2Ship the importer',
      'ENG-3Rewrite the seeder',
    ]);
  });

  /**
   * A team whose scale is `none` has no state in which an estimate can be set, so the whole
   * affordance goes: no button, and no `⇧E` in the registry.
   *
   * Registered-and-disabled is not good enough, and the difference only shows up in the help
   * overlay. `enabled` is what the *matcher* asks, and it correctly leaves the key unbound —
   * but the overlay lists every registered binding on purpose (that is what keeps Escape and
   * ⌘⏎ on the sheet) and cannot ask whether one is runnable right now. So an action that is
   * disabled for the lifetime of the team is a row in the keyboard reference that never works
   * — which is the one thing a generated reference exists to prevent.
   */
  it('offers no estimate button and binds no key when the team does not estimate', () => {
    renderList();

    expect(screen.queryByRole('button', { name: 'Estimate' })).toBeNull();
    expect(boundTitles()).not.toContain('Set estimate');
  });

  it('offers both again when the team turns a scale on', () => {
    renderList('', { estimateScale: 'fibonacci' });

    expect(screen.getByRole('button', { name: 'Estimate' })).toBeTruthy();
    expect(boundTitles()).toContain('Set estimate');
  });

  /**
   * Grouping by status pads the view with a group per status, so the row list is never
   * empty in a team view however narrow the filter is. That made the "nothing matches"
   * message unreachable from the default view: a filter that excluded everything left five
   * zero-count headers on screen, no explanation, and no way back to the unfiltered list.
   */
  it('says so when a filter has excluded everything, even though the status groups remain', () => {
    renderList('?filter=title.contains(nothing-matches-this)');

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Nothing matches this filter')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear the filter' })).toBeTruthy();
  });

  it('clears the filter from the empty state', async () => {
    const { user } = renderList('?filter=title.contains(nothing-matches-this)');

    await user.click(screen.getByRole('button', { name: 'Clear the filter' }));

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
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

  it('opens Peek with Space without leaving the list, and Esc puts it away', async () => {
    const { user } = renderList();

    await user.keyboard('{Space}');

    expect(screen.getByRole('complementary', { name: 'Peek ENG-1' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fix the flake' })).toBeTruthy();
    expect(screen.getByText('No description.')).toBeTruthy();

    await user.keyboard('j');
    expect(cursorText()).toBe('ENG-2Ship the importer');
    expect(screen.getByRole('complementary', { name: 'Peek ENG-2' })).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Peek ENG-1' })).toBeNull();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).toBeNull();
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

  it('assigns the cursor row to the viewer with i', async () => {
    const { user, mutate } = renderList();

    await user.keyboard('i');

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0].variables.input).toMatchObject({
      id: 'issue-1',
      assigneeId: 'user-ada',
    });
  });

  it('opens the label picker with l', async () => {
    const { user } = renderList();

    await user.keyboard('l');

    expect(screen.getByRole('menu', { name: 'Labels' })).toBeTruthy();
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

/**
 * A list with nothing in it, grouped by status — which is the default and so the case
 * everybody meets first.
 *
 * Grouping pads a group per status whether or not anything is in it, so a brand-new team's
 * list was never made of zero rows and the explanation below never rendered: five headers
 * reading zero, no sentence, and no create button. The padding is right when there is work
 * to place beside it and says nothing at all when there is none.
 */
describe('an empty list', () => {
  it('explains itself instead of showing a column of zeroes', () => {
    const store = seeded();
    store.applyChanges(
      [1, 2, 3].map((n, index) => ({
        v: 20 + index,
        type: 'issue',
        id: `issue-${n}`,
        op: 'delete',
        actor: { type: 'system' },
      })) as Change[],
    );
    const mutate = vi.fn().mockResolvedValue({});
    const engine = { store, mutate } as unknown as SyncEngine;
    render(
      <MemoryRouter initialEntries={['/team/ENG']}>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <Routes>
              <Route path="/team/:teamKey" element={<IssueList />} />
            </Routes>
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('No issues in this team yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create an issue' })).toBeTruthy();
  });
});

describe('triage', () => {
  function triageStore(enabled = true): Store {
    const store = seeded();
    const dup = { ...state('s-dup', 'Duplicate', 'duplicate'), isSystem: true };
    store.applyChanges([
      {
        v: 10,
        type: 'team',
        id: TEAM,
        op: 'upsert',
        actor: { type: 'system' },
        payload: { ...team(), triageEnabled: enabled },
      },
      {
        v: 11,
        type: 'workflowState',
        id: 's-triage',
        op: 'upsert',
        actor: { type: 'system' },
        payload: state('s-triage', 'Triage', 'triage'),
      },
      {
        v: 12,
        type: 'workflowState',
        id: 's-canceled',
        op: 'upsert',
        actor: { type: 'system' },
        payload: state('s-canceled', 'Canceled', 'canceled'),
      },
      {
        v: 13,
        type: 'workflowState',
        id: 's-dup',
        op: 'upsert',
        actor: { type: 'system' },
        payload: dup,
      },
      {
        v: 14,
        type: 'issue',
        id: 'issue-9',
        op: 'upsert',
        actor: { type: 'system' },
        payload: issue(9, 'Incoming from Slack', 's-triage', 'Z'),
      },
    ] as Change[]);
    return store;
  }

  function renderTriage(store = triageStore()) {
    const mutate = vi.fn().mockResolvedValue({});
    const engine = { store, mutate } as unknown as SyncEngine;
    render(
      <MemoryRouter initialEntries={['/team/ENG/triage']}>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <Routes>
              <Route path="/team/:teamKey/triage" element={<Triage />} />
            </Routes>
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );
    return { store, mutate, user: userEvent.setup() };
  }

  it('keeps triage issues out of the team list', () => {
    const store = triageStore();
    const mutate = vi.fn().mockResolvedValue({});
    const engine = { store, mutate } as unknown as SyncEngine;
    render(
      <MemoryRouter initialEntries={['/team/ENG']}>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <Routes>
              <Route path="/team/:teamKey" element={<IssueList />} />
            </Routes>
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByText('Incoming from Slack')).toBeNull();
    expect(screen.getByText('Fix the flake')).toBeTruthy();
  });

  it('shows only the inbox, and 1 accepts the cursor row', async () => {
    const { user, mutate } = renderTriage();

    expect(screen.getByRole('heading', { name: 'Engineering triage' })).toBeTruthy();
    expect(screen.getByText('Incoming from Slack')).toBeTruthy();
    expect(screen.queryByText('Fix the flake')).toBeNull();

    await user.keyboard('1');
    expect(mutate).toHaveBeenCalled();
    const sent = mutate.mock.calls[0]?.[0] as { mutation: string; variables: { id: string } };
    expect(sent.mutation).toContain('acceptTriageIssue');
    expect(sent.variables.id).toBe('issue-9');
  });

  it('hides snoozed issues until the display option is on', () => {
    const store = triageStore();
    store.applyChanges([
      {
        v: 15,
        type: 'issue',
        id: 'issue-10',
        op: 'upsert',
        actor: { type: 'system' },
        payload: {
          ...issue(10, 'Snoozed until later', 's-triage', 'Y'),
          snoozedUntil: '2099-01-01T00:00:00Z',
        },
      },
    ] as Change[]);
    const mutate = vi.fn().mockResolvedValue({});
    const engine = { store, mutate } as unknown as SyncEngine;

    const tree = (path: string) => (
      <MemoryRouter initialEntries={[path]}>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <Routes>
              <Route path="/team/:teamKey/triage" element={<Triage />} />
            </Routes>
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>
    );

    const { unmount } = render(tree('/team/ENG/triage'));
    expect(screen.getByText('Incoming from Slack')).toBeTruthy();
    expect(screen.queryByText('Snoozed until later')).toBeNull();
    unmount();

    render(tree('/team/ENG/triage?snoozed=true'));
    expect(screen.getByText('Snoozed until later')).toBeTruthy();
  });

  /**
   * Turning intake off does not empty the queue — the server keeps the statuses and the
   * issues sitting in them on purpose — so the screen has to stay usable while anything is
   * still waiting on a decision. It used to refuse, and since every ordinary view hides
   * triage-category work, those issues were then reachable only from Search.
   */
  it('still lists a queue left behind when intake is turned off', async () => {
    const { user, mutate } = renderTriage(triageStore(false));

    expect(screen.getByText('Incoming from Slack')).toBeTruthy();
    expect(screen.queryByText('Triage is off')).toBeNull();

    await user.keyboard('1');
    const sent = mutate.mock.calls[0]?.[0] as { mutation: string; variables: { id: string } };
    expect(sent.mutation).toContain('acceptTriageIssue');
    expect(sent.variables.id).toBe('issue-9');
  });

  it('says intake is off, and where to turn it back on', () => {
    renderTriage(triageStore(false));

    const notice = screen.getByText(/intake is off/i);
    expect(notice.textContent).toContain('1 issue is still waiting on a decision');
    expect(within(notice).getByRole('link', { name: /team settings/i })).toBeTruthy();
  });

  /** Off and drained is the one state with nothing to say but "this is off". */
  it('is off once the queue it was holding open is empty', () => {
    const store = triageStore(false);
    store.applyChanges([
      { v: 20, type: 'issue', id: 'issue-9', op: 'delete', actor: { type: 'system' } },
    ] as Change[]);
    renderTriage(store);

    expect(screen.getByText('Triage is off')).toBeTruthy();
    expect(screen.queryByRole('listbox', { name: /issues/i })).toBeNull();
  });

  /**
   * The inbox's only account of its own keyboard, and it lives in the empty state — which
   * padding made unreachable, because a status group with no rows in it is still a row.
   */
  it('explains its shortcuts when the inbox is clear', () => {
    const store = triageStore();
    store.applyChanges([
      { v: 20, type: 'issue', id: 'issue-9', op: 'delete', actor: { type: 'system' } },
    ] as Change[]);
    renderTriage(store);

    expect(screen.getByText('Inbox is clear')).toBeTruthy();
    expect(screen.getByText(/Press C to file into triage/)).toBeTruthy();
  });
});

describe('an ad-hoc identifier URL', () => {
  it('lists exactly the named issues, in the URL order of their identifiers', () => {
    const store = seeded();
    const mutate = vi.fn().mockResolvedValue({});
    const engine = { store, mutate } as unknown as SyncEngine;
    render(
      <MemoryRouter initialEntries={['/issues/ENG-3,ENG-1,MISSING-9']}>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <Routes>
              <Route path="/issues/:identifiers" element={<AdHocIssues />} />
            </Routes>
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'ENG-3, ENG-1, MISSING-9' })).toBeTruthy();
    expect(screen.getByText('Rewrite the seeder')).toBeTruthy();
    expect(screen.getByText('Fix the flake')).toBeTruthy();
    expect(screen.queryByText('Ship the importer')).toBeNull();
  });
});
