import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import {
  Store,
  type Change,
  type Issue,
  type Project,
  type Team,
  type WorkflowState,
} from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Search } from './Search';

/**
 * Several results can be changed together.
 *
 * The gestures are the issue list's, and the thing that is easy to get wrong here is that
 * a result is a link: a modifier click that also navigates has selected a row the reader
 * can no longer see. `aria-selected` stays the keyboard cursor — these tests read
 * `aria-checked` for the selection so the two cannot be confused.
 */

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn(() => new Promise(() => {})) };
});

const WORKSPACE = 'ws-1';
const TEAM = 'team-1';
const AT = '2026-01-01T00:00:00Z';

function team(id = TEAM, key = 'MI', name = 'Miguel'): Team {
  return {
    id,
    workspaceId: WORKSPACE,
    key,
    name,
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
  };
}

function project(): Project {
  return {
    id: 'p-escolas',
    workspaceId: WORKSPACE,
    name: 'Escolas de Oeiras',
    description: '',
    color: '#5e6ad2',
    statusId: 'ps-1',
    priority: 0,
    sortOrder: 'a0',
    updateSchedule: 'default',
    createdAt: AT,
    updatedAt: AT,
  };
}

function issue(number: number, title: string, projectId?: string): Issue {
  return {
    id: `issue-${number}`,
    workspaceId: WORKSPACE,
    teamId: TEAM,
    number,
    identifier: `MI-${number}`,
    title,
    dueDateSource: 'manual',
    description: '',
    stateId: 's-todo',
    priority: 0,
    sortOrder: 'V',
    ...(projectId === undefined ? {} : { projectId }),
    createdAt: AT,
    updatedAt: `2026-01-0${number}T00:00:00Z`,
  };
}

function apply(store: Store, entities: readonly [string, { id: string }][]) {
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
}

/** Newest first on an empty box: issue 3, then 2, then 1. */
function seeded(): Store {
  const store = new Store(WORKSPACE);
  apply(store, [
    ['team', team()],
    ['workflowState', state()],
    ['project', project()],
    ['issue', issue(1, 'Oldest', 'p-escolas')],
    ['issue', issue(2, 'Middle')],
    ['issue', issue(3, 'Newest')],
  ]);
  return store;
}

/** Two issues the status picker cannot share a workflow between. */
function seededTwoTeams(): Store {
  const store = new Store(WORKSPACE);
  const elsewhere = {
    ...issue(4, 'Elsewhere'),
    teamId: 'team-2',
    updatedAt: '2026-01-04T00:00:00Z',
  };
  apply(store, [
    ['team', team()],
    ['team', team('team-2', 'OT', 'Other')],
    ['workflowState', state()],
    ['issue', issue(1, 'Here')],
    ['issue', elsewhere],
  ]);
  return store;
}

function renderSearch(store: Store, path = '/search') {
  const mutate = vi.fn();
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[path]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/search" element={<Search />} />
            <Route path="/issue/:identifier" element={<h1>Issue</h1>} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

function row(title: string): HTMLElement {
  const found = screen.getAllByRole('option').find((option) => option.textContent?.includes(title));
  if (found === undefined) throw new Error(`no row titled ${title}`);
  return found;
}

function checked(title: string): string | null {
  return row(title).getAttribute('aria-checked');
}

/** The title, not the row: the row's centre can be a property button, which is a different gesture. */
async function clickTitle(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
  modifier?: 'shift' | 'meta',
) {
  const target = within(row(title)).getByText(title);
  if (modifier === undefined) {
    await user.click(target);
    return;
  }
  const hold = modifier === 'shift' ? '{Shift>}' : '{Meta>}';
  const release = modifier === 'shift' ? '{/Shift}' : '{/Meta}';
  await user.keyboard(hold);
  try {
    await user.click(target);
  } finally {
    await user.keyboard(release);
  }
}

function bar(): HTMLElement {
  return screen.getByRole('group', { name: 'Issue actions' });
}

describe('Search result selection', () => {
  it('shift-click selects only the anchor, then the rows through the next click', async () => {
    const { user } = renderSearch(seeded());

    await clickTitle(user, 'Newest', 'shift');

    expect(checked('Newest')).toBe('true');
    expect(checked('Middle')).toBe('false');
    expect(checked('Oldest')).toBe('false');
    expect(bar().textContent).toContain('1 selected');
    expect(screen.queryByRole('heading', { name: 'Issue' })).toBeNull();

    await clickTitle(user, 'Oldest', 'shift');

    expect(checked('Newest')).toBe('true');
    expect(checked('Middle')).toBe('true');
    expect(checked('Oldest')).toBe('true');
    expect(bar().textContent).toContain('3 selected');
    // The cursor follows the click. It is not the selection: the first row stays checked
    // and loses aria-selected.
    expect(row('Oldest').getAttribute('aria-selected')).toBe('true');
    expect(row('Newest').getAttribute('aria-selected')).toBe('false');
    expect(screen.queryByRole('heading', { name: 'Issue' })).toBeNull();
  });

  it('cmd-click toggles one row and does not open it', async () => {
    const { user } = renderSearch(seeded());

    await clickTitle(user, 'Middle', 'meta');

    expect(checked('Middle')).toBe('true');
    expect(checked('Newest')).toBe('false');
    expect(checked('Oldest')).toBe('false');
    expect(bar().textContent).toContain('1 selected');
    expect(row('Middle').getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('heading', { name: 'Issue' })).toBeNull();

    await clickTitle(user, 'Middle', 'meta');

    expect(checked('Middle')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Issue actions' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Issue' })).toBeNull();
  });

  it('writes a priority to every selected issue, and Clear drops the selection', async () => {
    const { mutate, user } = renderSearch(seeded());

    await clickTitle(user, 'Newest', 'shift');
    await clickTitle(user, 'Oldest', 'shift');

    const actions = bar();
    expect(
      (within(actions).getByRole('button', { name: 'Status' }) as HTMLButtonElement).disabled,
    ).toBe(false);

    await user.click(within(actions).getByRole('button', { name: 'Priority' }));
    await user.click(screen.getByRole('menuitem', { name: 'Urgent' }));

    expect(mutate).toHaveBeenCalledTimes(3);
    const ids = mutate.mock.calls.map((call) => {
      const input = (call[0] as { variables: { input: { id: string } } }).variables.input;
      return input.id;
    });
    expect(ids).toEqual(['issue-3', 'issue-2', 'issue-1']);

    await user.click(within(bar()).getByRole('button', { name: 'Clear' }));

    expect(screen.queryByRole('group', { name: 'Issue actions' })).toBeNull();
    expect(checked('Newest')).toBe('false');
    expect(checked('Middle')).toBe('false');
    expect(checked('Oldest')).toBe('false');
  });

  it('disables Status when the selection spans more than one team', async () => {
    const { user } = renderSearch(seededTwoTeams());

    await clickTitle(user, 'Elsewhere', 'shift');
    await clickTitle(user, 'Here', 'shift');

    expect(
      (within(bar()).getByRole('button', { name: 'Status' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('Escape clears a selection and still leaves the box when nothing is selected', async () => {
    const { user } = renderSearch(seeded());

    await clickTitle(user, 'Newest', 'shift');
    expect(bar().textContent).toContain('1 selected');

    screen.getByRole('searchbox').focus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('group', { name: 'Issue actions' })).toBeNull();
    expect(checked('Newest')).toBe('false');
    // The box kept focus: clearing the selection consumed Escape, so the handover to the
    // results did not also run.
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));

    await user.keyboard('{Escape}');

    expect(document.activeElement).toBe(screen.getByRole('listbox'));
  });

  it('drops the selection when the query changes', async () => {
    const { user } = renderSearch(seeded());

    await clickTitle(user, 'Newest', 'shift');
    expect(bar().textContent).toContain('1 selected');

    await user.type(screen.getByRole('searchbox'), 'a');

    expect(screen.queryByRole('group', { name: 'Issue actions' })).toBeNull();
  });

  it('drops the selection when the filter changes', async () => {
    const { user } = renderSearch(seeded(), '/search?filter=priority.eq(1)');

    await clickTitle(user, 'Newest', 'shift');
    expect(bar().textContent).toContain('1 selected');

    await user.click(screen.getByRole('button', { name: /Remove filter/ }));

    expect(screen.queryByRole('group', { name: 'Issue actions' })).toBeNull();
    expect(checked('Newest')).toBe('false');
  });
});
