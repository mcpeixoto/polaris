import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { SEARCH_QUERY } from '~/features/search/operations';
import { Store, type Change, type Issue, type Team, type WorkflowState } from '~/store';
import { gql, setWorkspace } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Search } from './Search';

/**
 * The states this screen has between "nothing typed" and "here are your results", and the
 * two places it writes to the address bar.
 *
 * `Search.test.tsx` covers the query, the sequence guard and the failure path, and none of
 * that is re-proved here. What is only checkable here is what the screen does while it has
 * no answer at all, what it remembers between searches, and that neither of its two writers
 * puts the filter grammar's punctuation through `URLSearchParams.toString()`.
 */

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const gqlMock = vi.mocked(gql);

/** Comfortably past the screen's own delay, so the held request has certainly gone out. */
const REFINE_DELAY_CEILING = 500;

const WORKSPACE = 'ws-1';
const TEAM = 'team-1';
const AT = '2026-01-01T00:00:00Z';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => void values.set(name, value),
    removeItem: (name: string) => void values.delete(name),
    clear: () => values.clear(),
  };
}

/** A promise somebody else decides the fate of. The same shape `Search.test.tsx` uses. */
function deferred() {
  const box: { resolve?: (value: unknown) => void } = {};
  const promise = new Promise<unknown>((resolve) => {
    box.resolve = resolve;
  });
  return {
    promise,
    // Wrapped in `act` here rather than at every call site: it is a state update arriving
    // from outside React, and the assertion after it has to see the rendered result.
    settle: async (value: unknown) => {
      await act(async () => {
        box.resolve?.(value);
        await promise;
      });
    },
  };
}

function wireIssue(id: string, identifier: string, title: string) {
  return {
    id,
    identifier,
    title,
    priority: 0,
    state: { id: 's-todo', name: 'Todo', color: '#5e6ad2', category: 'unstarted' },
    assignee: null,
  };
}

function answer(issues: ReturnType<typeof wireIssue>[] = [], issueCount = issues.length) {
  return { search: { issues, comments: [], issueCount } };
}

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

function issue(number: number, title: string): Issue {
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
    sortOrder: 'V',
    createdAt: AT,
    updatedAt: AT,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | WorkflowState | Issue][] = [
    ['team', team()],
    ['workflowState', state()],
    ['issue', issue(1, 'Fix the flake')],
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

/** The address bar, rendered, so a test can assert what a shared link would say. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

function renderSearch(store: Store = new Store(WORKSPACE), path = '/search') {
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;

  render(
    <MemoryRouter initialEntries={[path]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route
              path="/search"
              element={
                <>
                  <Search />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { store, user: userEvent.setup() };
}

function box(): HTMLElement {
  return screen.getByRole('searchbox', { name: 'Search' });
}

function locationSearch(): string {
  return screen.getByTestId('location').textContent ?? '';
}

/**
 * The search requests, which are not the only requests on this screen any more.
 *
 * The filter bar asks who the viewer is, once per workspace per process, and that call goes
 * through the same mocked `gql`. Counting every call would make "how many searches did that
 * keystroke fire" depend on which test happened to warm the viewer cache first.
 */
function searchCalls() {
  return gqlMock.mock.calls.filter((call) => call[0] === SEARCH_QUERY);
}

function lastVariables(): unknown {
  return searchCalls().at(-1)?.[1];
}

/** A request nobody answers, which is what every unarranged call gets. */
function pending(): Promise<never> {
  return new Promise(() => {});
}

/** Answers the searches with `replies` in order, and everything else with silence. */
function replySearches(...replies: readonly Promise<unknown>[]): void {
  const queue = [...replies];
  gqlMock.mockImplementation(
    (document: unknown) =>
      (document === SEARCH_QUERY ? (queue.length > 1 ? queue.shift() : queue[0]) : undefined) ??
      pending(),
  );
}

beforeEach(() => {
  gqlMock.mockReset();
  gqlMock.mockImplementation(() => pending());
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  setWorkspace(null);
  vi.unstubAllGlobals();
});

describe('while the first answer is still coming', () => {
  it('shows skeleton rows rather than an empty listbox', async () => {
    const reply = deferred();
    replySearches(reply.promise);

    const { user } = renderSearch();
    await user.type(box(), 'flake');

    // There is no previous answer to keep, so this is the one moment the screen has nothing
    // to say. It used to say it with a listbox holding no options, which reads as "nothing
    // matched" a fraction of a second before the rows land.
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();

    await reply.settle(answer([wireIssue('issue-1', 'ENG-1', 'Fix the flake')]));

    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByRole('listbox').textContent).toContain('Fix the flake');
  });

  it('keeps the previous answer instead of the skeleton once there is one', async () => {
    const first = deferred();
    replySearches(first.promise, pending());

    const { user } = renderSearch();
    await user.type(box(), 'a');
    await first.settle(answer([wireIssue('issue-1', 'ENG-1', 'Alpha channel')]));

    await user.type(box(), 'b');

    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByRole('listbox').textContent).toContain('Alpha channel');
  });
});

describe('recent searches', () => {
  // The list is keyed per workspace, and a process with no workspace has nothing to remember
  // — which is its own case, covered in `features/search/recent.test.ts`.
  beforeEach(() => {
    setWorkspace(WORKSPACE);
  });

  it('remembers a settled search and offers it when the box is emptied', async () => {
    const reply = deferred();
    replySearches(reply.promise);

    const { user } = renderSearch(seeded());
    await user.type(box(), 'flake');
    await reply.settle(answer([wireIssue('issue-1', 'ENG-1', 'Fix the flake')]));

    await user.clear(box());

    const link = await screen.findByRole('link', { name: 'flake' });
    // Above the recent work rather than instead of it: an empty box still shows what the
    // workspace has been touching.
    expect(screen.getByRole('listbox').textContent).toContain('Fix the flake');

    await user.click(link);
    expect(box()).toHaveProperty('value', 'flake');
    expect(locationSearch()).toBe('?q=flake');
  });

  it('remembers nothing for a request that never answered', async () => {
    const { user } = renderSearch();
    await user.type(box(), 'flake');
    await user.clear(box());

    expect(screen.queryByRole('link', { name: 'flake' })).toBeNull();
  });

  it('forgets the list when asked', async () => {
    const reply = deferred();
    replySearches(reply.promise);

    const { user } = renderSearch();
    await user.type(box(), 'flake');
    await reply.settle(answer([wireIssue('issue-1', 'ENG-1', 'Fix the flake')]));
    await user.clear(box());

    await user.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('link', { name: 'flake' })).toBeNull();
  });
});

describe('the filter in the link', () => {
  it('shows it on a bar and sends it with the search', async () => {
    const reply = deferred();
    replySearches(reply.promise);

    const { user } = renderSearch(new Store(WORKSPACE), '/search?filter=priority.in(1,2)');
    await user.type(box(), 'flake');

    expect(screen.getByRole('group', { name: 'Filters' })).toBeTruthy();
    expect(lastVariables()).toEqual({
      input: {
        query: 'flake',
        first: 25,
        // The AST as the grammar's own parser read it, forwarded untouched — which is what
        // makes a search and a saved view with the same filter return the same issues.
        filter: { conj: 'and', nodes: [{ field: 'priority', op: 'in', values: ['1', '2'] }] },
      },
    });
  });

  it('says so when the link carried one this build cannot read', async () => {
    const reply = deferred();
    replySearches(reply.promise);

    const { user } = renderSearch(new Store(WORKSPACE), '/search?filter=nonsense.eq(1)');
    await user.type(box(), 'flake');

    // It used to be dropped inside the request builder, which left the reader with
    // unfiltered results and nothing on screen to say why.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not read');
    // And the query still runs, without the filter it could not make sense of.
    expect(lastVariables()).toEqual({ input: { query: 'flake', first: 25 } });
  });

  it('leaves the grammar readable when the box writes the URL beside it', async () => {
    const { user } = renderSearch(new Store(WORKSPACE), '/search?filter=priority.in(1,2)');
    await user.type(box(), 'x');

    // `URLSearchParams.toString()` would have written `priority.in%281%2C2%29` here: still
    // legal, still parsed, and no longer a link anybody can read before they click it.
    expect(locationSearch()).toBe('?filter=priority.in(1,2)&q=x');
  });
});

describe('the request', () => {
  it('holds a refinement back rather than asking on every keystroke', async () => {
    // A clock this test drives, and keystrokes with no wait between them. The assertion is
    // that three characters are one request, and on the wall clock that is a race between
    // how fast the runner types and how long the delay is.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });

    try {
      const first = deferred();
      replySearches(first.promise, pending());
      renderSearch();

      // The first query of a session is not held: the reader is looking at skeleton rows,
      // and a delay there is a delay with nothing to read while it elapses.
      await user.type(box(), 'a');
      expect(searchCalls()).toHaveLength(1);
      await first.settle(answer([wireIssue('issue-1', 'ENG-1', 'Alpha channel')]));

      await user.type(box(), 'uth');

      // Three more keystrokes and not one of them has been sent. Without this each was a
      // ranked query over the wire, and all but the last were thrown away by the sequence
      // guard after the server had already paid for them.
      expect(searchCalls()).toHaveLength(1);
      // The box and the URL are not held back at all — only the query is.
      expect(box()).toHaveProperty('value', 'auth');
      expect(locationSearch()).toBe('?q=auth');

      // And then one request for the word, rather than one per character.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFINE_DELAY_CEILING);
      });
      expect(searchCalls()).toHaveLength(2);
      expect(lastVariables()).toEqual({ input: { query: 'auth', first: 25 } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not hold back the same question asked again', async () => {
    const first = deferred();
    replySearches(first.promise, pending());

    const { user } = renderSearch();
    await user.type(box(), 'a');
    await first.settle(answer([wireIssue('issue-1', 'ENG-1', 'Alpha channel')], 412));

    // "Show more" is a click on a button, not a keystroke: there is nothing to coalesce it
    // with, and the reader is waiting on it.
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    expect(searchCalls()).toHaveLength(2);
    expect(lastVariables()).toEqual({ input: { query: 'a', first: 100 } });
  });
});
