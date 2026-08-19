import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import {
  canShowMore,
  describeCommentCount,
  describeIssueCount,
  excerptAround,
  foldForSearch,
  highlightRuns,
  matchRanges,
  searchTerms,
} from '~/features/search/search';
import {
  fold as storeFold,
  Store,
  type Change,
  type Issue,
  type Team,
  type WorkflowState,
} from '~/store';
import { ApiError, gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Search } from './Search';

/**
 * Two suites, and they are testing two different kinds of thing.
 *
 * The pure ones are the interesting half. Folding, tokenising and range-finding are where
 * search is actually right or wrong — a highlight that misses the accented row is a bug
 * nobody reports as a bug, they just stop trusting the feature — and all of it is a function
 * of a string and a query, provable in a millisecond with no DOM in sight.
 *
 * The screen suite deliberately does not re-prove any of that. What can only be checked here
 * is the wiring: that the box writes to the URL rather than to a private copy of the query,
 * that a reply which arrives late cannot overwrite a newer one, and that a failed request
 * says so while leaving the previous answer where it was.
 */

vi.mock('~/sync/api', async (importOriginal) => {
  // Spread over the real module rather than replaced: `ApiError` is a class the screen
  // branches on with `instanceof`, and a stubbed one would make the offline path untestable.
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const gqlMock = vi.mocked(gql);

// ----------------------------------------------------------------------------- pure parts

describe('folding', () => {
  it("matches the server's lower(unaccent(x))", () => {
    expect(foldForSearch('Ação')).toBe('acao');
    expect(foldForSearch('Résumé')).toBe('resume');
    expect(foldForSearch('ÉLAN')).toBe('elan');
    expect(foldForSearch('Grün')).toBe('grun');
    // Already folded text is left exactly as it is, which is what makes the fold safe to
    // apply to a query that has been through it once already.
    expect(foldForSearch('login redirect')).toBe('login redirect');
  });

  it('leaves whitespace alone, which is why it is not the store fold', () => {
    // The store's fold is a comparison key and collapses runs of whitespace; every character
    // it removes shifts every offset after it, which is fatal for a highlight.
    expect(storeFold('  two   words ')).toBe('two words');
    expect(foldForSearch('  two   words ')).toBe('  two   words ');
  });
});

describe('searchTerms', () => {
  it('splits on everything that is not a letter or a digit, and folds what is left', () => {
    expect(searchTerms('Login, redirect!')).toEqual(['login', 'redirect']);
    expect(searchTerms('Ação — já?')).toEqual(['acao', 'ja']);
    expect(searchTerms('ENG-123')).toEqual(['eng', '123']);
  });

  it('has nothing to say about an empty query', () => {
    expect(searchTerms('')).toEqual([]);
    expect(searchTerms('   ...   ')).toEqual([]);
  });

  it('stops at twelve words, as the server does', () => {
    const many = Array.from({ length: 30 }, (_, at) => `word${at}`).join(' ');
    expect(searchTerms(many)).toHaveLength(12);
  });
});

describe('matchRanges', () => {
  it('finds a plain match', () => {
    expect(matchRanges('Fix the flake', ['flake'])).toEqual([{ start: 8, end: 13 }]);
  });

  it('finds an accented match from an unaccented query', () => {
    // Normalised here so the assertion holds whatever form this file is stored in: in NFD
    // the same characters are six code points rather than four, and the offsets move.
    const text = 'Corrigir a Ação de login'.normalize('NFC');

    expect(matchRanges(text, ['acao'])).toEqual([{ start: 11, end: 15 }]);
    // The range points at the accented word in the ORIGINAL string, which is the whole
    // reason the folding keeps an index map rather than just returning a folded string.
    expect(text.slice(11, 15)).toBe('Ação'.normalize('NFC'));
  });

  it('marks a prefix of a word, because the last term is a prefix match on the server', () => {
    expect(matchRanges('Login redirect', ['redir'])).toEqual([{ start: 6, end: 11 }]);
  });

  it('only matches at the start of a word', () => {
    // The index matches words and prefixes of words, so decorating the "ao" inside "chaos"
    // would point at something that had nothing to do with why the row is on screen.
    expect(matchRanges('chaos', ['ao'])).toEqual([]);
  });

  it('merges overlapping terms into one range', () => {
    const text = 'Ação'.normalize('NFC');
    expect(matchRanges(text, ['ac', 'acao'])).toEqual([{ start: 0, end: 4 }]);
  });

  it('finds every occurrence, in reading order', () => {
    expect(matchRanges('log the log', ['log'])).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it('has nothing to mark without terms', () => {
    expect(matchRanges('Fix the flake', [])).toEqual([]);
    expect(matchRanges('', ['flake'])).toEqual([]);
  });
});

describe('highlightRuns', () => {
  it('splits a string into matched and unmatched runs', () => {
    expect(highlightRuns('Fix the flake', ['flake'])).toEqual([
      { text: 'Fix the ', match: false },
      { text: 'flake', match: true },
    ]);
  });

  it('returns the whole string as one unmatched run when nothing matched', () => {
    expect(highlightRuns('Fix the flake', ['nothing'])).toEqual([
      { text: 'Fix the flake', match: false },
    ]);
  });
});

describe('excerptAround', () => {
  it('leaves a short body alone, apart from collapsing whitespace', () => {
    expect(excerptAround('the\n\n  login   redirect', ['login'])).toBe('the login redirect');
  });

  it('centres a long body on the first match and marks both cuts', () => {
    const body = `${'padding words '.repeat(20)}the login redirect is broken${' trailing words'.repeat(20)}`;
    const excerpt = excerptAround(body, ['redirect']);

    expect(excerpt).toContain('login redirect is broken');
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('still shows something when the match is outside the window', () => {
    const body = 'a'.repeat(500);
    expect(excerptAround(body, ['nothing']).length).toBeGreaterThan(0);
  });
});

describe('the count wording', () => {
  it('says how many issues there are when they all fit', () => {
    expect(describeIssueCount({ shown: 0, total: 0, limit: 25 })).toBe('No issues');
    expect(describeIssueCount({ shown: 1, total: 1, limit: 25 })).toBe('1 issue');
    expect(describeIssueCount({ shown: 7, total: 7, limit: 25 })).toBe('7 issues');
  });

  it('says how many of how many when they do not', () => {
    expect(describeIssueCount({ shown: 25, total: 412, limit: 25 })).toBe('25 of 412 issues');
  });

  it('says the limit is reached rather than pretending there is more to fetch', () => {
    const wording = describeIssueCount({ shown: 100, total: 412, limit: 100 });
    expect(wording).toContain('100 of 412 issues');
    expect(wording).toContain('at most 100');

    expect(canShowMore({ shown: 25, total: 412, limit: 25 })).toBe(true);
    expect(canShowMore({ shown: 100, total: 412, limit: 100 })).toBe(false);
    expect(canShowMore({ shown: 7, total: 7, limit: 25 })).toBe(false);
  });

  it('counts comments without claiming a total the server never sent', () => {
    expect(describeCommentCount(0)).toBe('No comments');
    expect(describeCommentCount(1)).toBe('1 comment');
    expect(describeCommentCount(4)).toBe('4 comments');
  });
});

// -------------------------------------------------------------------------------- the screen

const WORKSPACE = 'workspace-1';
const TEAM = 'team-1';
const AT = '2026-01-01T00:00:00Z';

/** A promise somebody else decides the fate of, so a test can land two replies out of order. */
interface Deferred {
  readonly promise: Promise<unknown>;
  settle(value: unknown): Promise<void>;
}

function deferred(): Deferred {
  const box: { resolve?: (value: unknown) => void } = {};
  const promise = new Promise<unknown>((resolve) => {
    box.resolve = resolve;
  });
  return {
    promise,
    // Settling is wrapped in `act` here rather than at every call site: it is a state update
    // arriving from outside React, and the assertion after it has to see the rendered result.
    settle: async (value) => {
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
    state: { id: 's-todo', name: 'Todo', category: 'unstarted', color: '#5e6ad2' },
    assignee: null,
  };
}

function wireComment(id: string, issueId: string, body: string) {
  return { id, issueId, body, createdAt: AT };
}

function answer(
  issues: readonly unknown[],
  comments: readonly unknown[] = [],
  issueCount = issues.length,
) {
  return { search: { issues, comments, issueCount } };
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

function issue(number: number, title: string, updatedAt: string): Issue {
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
    updatedAt,
  };
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  const entities: [string, Team | WorkflowState | Issue][] = [
    ['team', team()],
    ['workflowState', state()],
    ['issue', issue(1, 'Fix the flake', '2026-01-02T00:00:00Z')],
    ['issue', issue(2, 'Ship the importer', '2026-01-03T00:00:00Z')],
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
            <Route path="/issue/:identifier" element={<div>an issue</div>} />
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

/** The rendered text of the results, which the highlight splits across several elements. */
function resultsText(): string {
  return screen.getByRole('listbox').textContent ?? '';
}

function locationSearch(): string {
  return screen.getByTestId('location').textContent ?? '';
}

beforeEach(() => {
  gqlMock.mockReset();
  // The default is a request that never answers, so a test only has to arrange the replies
  // it cares about and every other keystroke leaves the screen in its in-flight state.
  gqlMock.mockReturnValue(new Promise(() => {}));
});

describe('Search', () => {
  it('writes what is typed into the URL, and asks the server for exactly that', async () => {
    const { user } = renderSearch();

    await user.type(box(), 'flake');

    // The URL is the only copy of the query: this is what makes a result set a link somebody
    // can paste, and what makes the back button mean something.
    expect(locationSearch()).toBe('?q=flake');

    const last = gqlMock.mock.calls.at(-1);
    expect(last?.[1]).toEqual({ input: { query: 'flake', first: 25 } });
  });

  it('reads the query back out of the URL rather than keeping its own copy', () => {
    renderSearch(new Store(WORKSPACE), '/search?q=importer');

    expect(box()).toHaveProperty('value', 'importer');
    expect(gqlMock).toHaveBeenCalledWith(
      expect.any(String),
      { input: { query: 'importer', first: 25 } },
      expect.anything(),
    );
  });

  it('does not let a stale reply overwrite a newer one', async () => {
    const slow = deferred();
    const fast = deferred();
    gqlMock.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const { user } = renderSearch();
    await user.type(box(), 'lo');
    expect(gqlMock).toHaveBeenCalledTimes(2);

    // The second request answers first, which is the ordinary case rather than the exotic
    // one: a narrower query is a cheaper query.
    await fast.settle(answer([wireIssue('issue-2', 'ENG-2', 'Login redirect')]));
    expect(resultsText()).toContain('Login redirect');

    // And now the reply to "l" arrives. It answers a question nobody is asking any more.
    await slow.settle(answer([wireIssue('issue-1', 'ENG-1', 'Log rotation')]));

    expect(resultsText()).toContain('Login redirect');
    expect(resultsText()).not.toContain('Log rotation');
  });

  it('keeps the previous results on screen while a newer request is in flight', async () => {
    const first = deferred();
    gqlMock.mockReturnValueOnce(first.promise);

    const { user } = renderSearch();
    await user.type(box(), 'a');
    await first.settle(answer([wireIssue('issue-1', 'ENG-1', 'Alpha channel')]));
    expect(resultsText()).toContain('Alpha channel');

    await user.type(box(), 'b');

    // Still there, with the spinner saying why it might be a keystroke out of date. Results
    // that blink out on every keystroke are worse than results that are briefly stale.
    expect(resultsText()).toContain('Alpha channel');
    expect(screen.getByRole('status', { name: 'Searching' })).toBeTruthy();
  });

  it('says a search failed, keeps what was on screen, and offers to try again', async () => {
    const first = deferred();
    gqlMock.mockReturnValueOnce(first.promise);

    const { user } = renderSearch();
    await user.type(box(), 'a');
    await first.settle(answer([wireIssue('issue-1', 'ENG-1', 'Alpha channel')]));

    gqlMock.mockRejectedValueOnce(new ApiError('INTERNAL', 'the search index is rebuilding'));
    await user.type(box(), 'b');

    const failure = await screen.findByRole('alert');
    expect(failure.textContent).toContain('the search index is rebuilding');
    expect(resultsText()).toContain('Alpha channel');

    const before = gqlMock.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(gqlMock.mock.calls.length).toBe(before + 1);
  });

  it('says how much of the answer it is showing, and fetches the rest on request', async () => {
    const first = deferred();
    gqlMock.mockReturnValueOnce(first.promise);

    const { user } = renderSearch();
    await user.type(box(), 'a');
    await first.settle(
      answer(
        Array.from({ length: 25 }, (_, at) => wireIssue(`issue-${at}`, `ENG-${at}`, `Issue ${at}`)),
        [],
        412,
      ),
    );

    expect(screen.getAllByText('25 of 412 issues').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Show more' }));

    // Straight to the server's maximum rather than another page: 100 is as much as search
    // will ever return, so stepping there in one request saves three round trips.
    expect(gqlMock.mock.calls.at(-1)?.[1]).toEqual({ input: { query: 'a', first: 100 } });
  });

  it('shows a comment with the issue it is on, and links to that issue', async () => {
    const reply = deferred();
    // Every keystroke of a five-letter word is its own request, and the newest one is the
    // only one the screen will accept an answer from — so all of them share one promise
    // rather than the first getting it and the last waiting for ever.
    gqlMock.mockReturnValue(reply.promise);

    const { user } = renderSearch(seeded());
    await user.type(box(), 'flake');
    await reply.settle(answer([], [wireComment('c-1', 'issue-1', 'the flake is a timeout')]));

    expect(resultsText()).toContain('the flake is a timeout');
    // The identifier comes from the replica: the schema's Comment has no issue field, so
    // this is the only place the route can come from.
    expect(resultsText()).toContain('ENG-1');
    expect(resultsText()).toContain('Fix the flake');

    const option = screen.getByRole('option');
    expect(option.getAttribute('href')).toBe('/issue/ENG-1');
  });

  it('shows recent work rather than a blank page when nothing has been typed', () => {
    renderSearch(seeded());

    // No query, no request: an empty box is not a search, and firing one would put a
    // pointless round trip on every visit to the screen.
    expect(gqlMock).not.toHaveBeenCalled();
    expect(resultsText()).toContain('Ship the importer');
    expect(resultsText()).toContain('Fix the flake');
  });

  it('says when nothing matched, rather than showing an empty list', async () => {
    const reply = deferred();
    gqlMock.mockReturnValue(reply.promise);

    const { user } = renderSearch();
    await user.type(box(), 'zzz');
    await reply.settle(answer([], [], 0));

    expect(screen.getByText('Nothing matches "zzz"')).toBeTruthy();
  });

  it('highlights the terms the answer was matched on, accents folded away', async () => {
    const reply = deferred();
    gqlMock.mockReturnValue(reply.promise);

    const { user } = renderSearch();
    await user.type(box(), 'acao');
    await reply.settle(
      answer([wireIssue('issue-1', 'ENG-1', 'Corrigir a Ação de login'.normalize('NFC'))]),
    );

    // The point of the whole folding exercise: the server matched "acao" against "Ação",
    // and the mark has to land on the accented word rather than on nothing.
    const marks = [...document.querySelectorAll('mark')].map((mark) => mark.textContent);
    expect(marks).toContain('Ação'.normalize('NFC'));
  });

  it('moves a cursor through the results and opens the one under it', async () => {
    const first = deferred();
    gqlMock.mockReturnValueOnce(first.promise);

    const { user } = renderSearch();
    await user.type(box(), 'a');
    await first.settle(
      answer([
        wireIssue('issue-1', 'ENG-1', 'Alpha channel'),
        wireIssue('issue-2', 'ENG-2', 'Beta blocker'),
      ]),
    );

    // Escape hands the keyboard from the box to the results. It has to: the keymap does not
    // deliver plain keystrokes to a focused text field, or `j` could not be typed.
    await user.keyboard('{Escape}');
    const list = screen.getByRole('listbox');
    expect(cursorText(list)).toContain('Alpha channel');

    await user.keyboard('{ArrowDown}');
    expect(cursorText(list)).toContain('Beta blocker');

    await user.keyboard('{ArrowUp}');
    expect(cursorText(list)).toContain('Alpha channel');

    await user.keyboard('{Enter}');
    expect(screen.getByText('an issue')).toBeTruthy();
  });
});

/** The row the keyboard is on, which the listbox names rather than focuses. */
function cursorText(list: HTMLElement): string {
  const id = list.getAttribute('aria-activedescendant');
  return id === null ? '' : (document.getElementById(id)?.textContent ?? '');
}
