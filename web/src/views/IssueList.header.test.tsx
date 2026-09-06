/**
 * The list's chrome: the breadcrumb, the scope pills, the overflow menu, the heading's "+"
 * and the row's sub-issue count.
 *
 * A sibling of `IssueList.test.tsx` rather than more cases in it, because everything here
 * is about the frame around the rows rather than the rows' keyboard — and because two of
 * the cases need routes beyond `/team/:teamKey` to say where a click went.
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

function issue(
  number: number,
  title: string,
  stateId: string,
  sortOrder: string,
  overrides: Partial<Issue> = {},
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
    ...overrides,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | WorkflowState | Issue][] = [
    ['team', team()],
    ['workflowState', state('s-backlog', 'Backlog', 'backlog')],
    ['workflowState', state('s-todo', 'Todo', 'unstarted')],
    ['issue', issue(1, 'Fix the flake', 's-todo', 'V')],
    ['issue', issue(2, 'Ship the importer', 's-backlog', 'W')],
    // A child of ENG-1, so the parent row has something to count.
    ['issue', issue(3, 'Find the flaky assertion', 's-todo', 'X', { parentId: 'issue-1' })],
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

/** Where the router is now, for the cases that assert on a navigation. */
function Location() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
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

/** See `IssueList.test.tsx`: a virtualiser told its viewport is zero pixels tall draws nothing. */
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

describe('the breadcrumb', () => {
  it('names the team as the heading and the screen as the leaf', () => {
    renderList();

    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('heading', { name: 'Engineering' })).toBeTruthy();
    expect(crumbs.textContent).toContain('Issues');
  });

  it('stars the team through the favourites mutation', async () => {
    const { user, mutate } = renderList();

    await user.click(screen.getByRole('button', { name: 'Favourite' }));

    const sent = mutate.mock.calls[0]?.[0] as { variables: { kind: string; targetId: string } };
    expect(sent.variables).toMatchObject({ kind: 'TEAM', targetId: TEAM });
  });
});

describe('the scope pills', () => {
  it('press the same filter the bar would have written, and read it back from the URL', async () => {
    const { user } = renderList();

    expect(screen.getByRole('button', { name: 'All issues' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Backlog' }));
    expect(where()).toContain('filter=');
    expect(screen.getByRole('button', { name: 'Backlog' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'All issues' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    // The filter did something: only the backlog issue is left.
    expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual([
      'ENG-2Ship the importer',
    ]);

    await user.click(screen.getByRole('button', { name: 'All issues' }));
    expect(where()).toBe('/team/ENG');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });
});

describe('the overflow menu', () => {
  it("keeps the team's other screens one click away", async () => {
    const { user } = renderList();

    await user.click(screen.getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('menu', { name: 'More' });
    for (const name of ['Projects', 'Cycles', 'Triage', 'Team settings']) {
      expect(within(menu).getByRole('menuitem', { name })).toBeTruthy();
    }

    await user.click(within(menu).getByRole('menuitem', { name: 'Team settings' }));
    expect(where()).toBe('/team/ENG/settings');
  });
});

describe('the group heading', () => {
  it('files into its own status from the +', async () => {
    const { user } = renderList();

    await user.click(screen.getByRole('button', { name: 'Create issue in Backlog' }));

    const url = new URL(where(), 'http://polaris.test');
    expect(url.pathname).toBe('/team/ENG/new');
    expect(url.searchParams.get('status')).toBe('Backlog');
  });
});

describe('the row', () => {
  it('counts the live sub-issues on the parent and says nothing on the rest', () => {
    renderList();

    const parent = screen.getByRole('option', { name: /Fix the flake/ });
    expect(within(parent).getByRole('img', { name: '1 sub-issue' })).toBeTruthy();

    const child = screen.getByRole('option', { name: /Find the flaky assertion/ });
    expect(within(child).queryByRole('img', { name: /sub-issue/ })).toBeNull();
  });
});
