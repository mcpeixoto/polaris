/**
 * The view a screen renders: a filter, a set of display options, and the issues that fall
 * out of them — all of it held in the URL.
 *
 * The URL is the state. That is a product requirement rather than an implementation
 * choice: a filtered view has to be a link somebody can paste into a chat, and the person
 * reading it has to be able to tell what it will show before they click it. So nothing
 * here keeps a filter in component state and syncs the address bar afterwards — the
 * search params are the only copy, `web/src/filter/url.ts` is the only encoding, and the
 * back button changes the view because it changes the state.
 *
 * Writes replace rather than push. Ticking four properties in the display menu is one
 * decision and not four, and a history stack with an entry per keystroke is one where the
 * back button no longer does what the user means by it.
 *
 * Nothing is debounced, and that is deliberate: a four-clause filter over five thousand
 * issues measures well under a millisecond against a 50 ms budget, so a debounce would add
 * latency to hide a cost that is not there — and the list would then lag the keystroke
 * that caused it, which is the one thing this product cannot look like.
 */

import { useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import {
  DEFAULT_DISPLAY,
  DISPLAY_PARAMS,
  FILTER_PARAM,
  filterIssues,
  parseDisplayParams,
  parseFilterParam,
  toDisplayParams,
  toFilterParam,
  type DisplayOptions,
  type FilterNode,
} from '~/filter';
import { filterContextFor, groupIssues, type IssueGroup, type ViewClock } from '~/features/view';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import type { Issue, Store, UUID } from '~/store';

/**
 * One group, holding ids rather than issues.
 *
 * The same bargain the issue list makes, for the same reason: a parent that mapped over
 * entities would rebuild every object in the view whenever anybody in another timezone
 * edited a title, and the frame budget would be gone before React started diffing. The
 * cards read their own issues; this only says which ones, and where.
 */
export interface ViewGroup extends Omit<IssueGroup, 'issues'> {
  readonly ids: readonly UUID[];
}

export interface ViewState {
  readonly filter: FilterNode;
  /** Every option resolved, so no caller has to remember what absence means. */
  readonly display: Required<DisplayOptions>;
  /** Set when the URL carried a filter this build could not read. See `parseFilterParam`. */
  readonly error: string | null;
  readonly groups: readonly ViewGroup[];
  /**
   * How many issues are in the view.
   *
   * Not the sum of the groups' sizes: grouping by label puts an issue in a group per label
   * it carries, on purpose. This is the number of issues, which is what a header means by
   * one.
   */
  readonly count: number;
  setFilter(next: FilterNode): void;
  /** Merges a patch over the current options and writes the result back to the URL. */
  setDisplay(patch: Partial<DisplayOptions>): void;
}

export interface UseViewOptions {
  /**
   * The issues the view is over, before filtering — a team's, a project's, a person's.
   *
   * A callback rather than an array so the caller can hand over the live index instead of
   * a copy of it; building an array per keystroke would spend the whole filter budget on
   * garbage before a single clause ran.
   */
  readonly issues: (store: Store) => Iterable<Issue>;
  /** The values `issues` closes over. Part of the query's identity — see `useLiveQuery`. */
  readonly inputs?: readonly unknown[] | undefined;
  /**
   * The zone relative dates are reckoned in: the team's rather than the reader's, or two
   * people looking at one board disagree about what is overdue.
   */
  readonly timezone: string;
  /** Pins the clock. Tests only; production reads the wall clock at query time. */
  readonly now?: number | undefined;
  /**
   * ANDed with the URL filter, and not shown in the filter bar.
   *
   * The triage inbox uses this to name `stateCategory`, which is what turns the grammar's
   * default hide off. Putting that clause in the URL would make clearing the bar empty the
   * inbox; keeping it here means the bar is still the user's refinement.
   */
  readonly sourceFilter?: FilterNode | undefined;
}

/** The entity types the answer can depend on: the filter's inputs and the grouping's. */
const VIEW_DEPS = [
  'issue',
  'issueLabel',
  'issueRelation',
  'issueSubscription',
  'workflowState',
  'user',
  'team',
  'label',
  'customer',
  'customerRequest',
] as const;

const NO_INPUTS: readonly unknown[] = [];

export function useView({
  issues,
  inputs = NO_INPUTS,
  timezone,
  now,
  sourceFilter,
}: UseViewOptions): ViewState {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const viewer = useViewer();
  const hideCustomers = viewer === null || viewer.role === 'guest';

  const raw = params.get(FILTER_PARAM);
  const { filter, error } = useMemo(() => readFilter(raw), [raw]);
  const display = useMemo(() => resolveDisplay(params), [params]);

  const view = useLiveQuery(
    (store) =>
      computeView(
        store,
        issues(store),
        filter,
        display,
        {
          // Read here rather than per render: a wall clock that changed identity every
          // render would re-run this query sixty times a second to produce the same answer.
          // The consequence is that a view left open across midnight keeps yesterday's
          // "due today" until something — a keystroke, a delta — moves.
          now: now ?? Date.now(),
          timezone,
        },
        sourceFilter,
        hideCustomers,
      ),
    VIEW_DEPS,
    [
      raw,
      display.groupBy,
      display.orderBy,
      display.direction,
      display.showSubIssues,
      display.showCompleted,
      // A pinned clock is part of the question; the wall clock deliberately is not.
      now ?? 0,
      timezone,
      sourceFilter,
      hideCustomers,
      ...inputs,
    ],
  );

  const writeParams = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params);
      mutate(next);
      // `replace`, not push: a filter is refined a character at a time, and pushing each
      // keystroke fills the back button with states nobody wants to return to.
      void navigate({ search: searchStringOf(next) }, { replace: true });
    },
    [navigate, params],
  );

  const setFilter = useCallback(
    (next: FilterNode) => {
      const encoded = toFilterParam(next);
      writeParams((search) => {
        // An empty string is what a filter matching everything serialises to, and a bare
        // `?filter=` in a shared link says "filtered" about a view that is not.
        if (encoded === '') search.delete(FILTER_PARAM);
        else search.set(FILTER_PARAM, encoded);
      });
    },
    [writeParams],
  );

  const setDisplay = useCallback(
    (patch: Partial<DisplayOptions>) => {
      const next = toDisplayParams({ ...display, ...patch });
      writeParams((search) => {
        // Cleared first: `toDisplayParams` omits every value that is already the default,
        // so a param left behind would pin a choice the user has just undone.
        for (const name of Object.values(DISPLAY_PARAMS)) search.delete(name);
        for (const [name, value] of Object.entries(next)) search.set(name, value);
      });
    },
    [writeParams, display],
  );

  return {
    filter,
    display,
    error,
    groups: view.groups,
    count: view.count,
    setFilter,
    setDisplay,
  };
}

interface ViewResult {
  readonly groups: readonly ViewGroup[];
  readonly count: number;
}

/**
 * Filters, applies the two display options that hide rows, then groups and orders.
 *
 * The order matters. `showSubIssues` asks whether a child whose parent is *in the view*
 * should be listed twice over, so it can only be answered once the filter has decided what
 * the view is — running it before would hide children whose parents the filter had already
 * excluded, and those are not duplicates of anything on screen.
 */
function computeView(
  store: Store,
  source: Iterable<Issue>,
  filter: FilterNode,
  display: Required<DisplayOptions>,
  clock: ViewClock,
  sourceFilter: FilterNode | undefined,
  hideCustomers: boolean,
): ViewResult {
  const combined =
    sourceFilter === undefined ? filter : { conj: 'and' as const, nodes: [sourceFilter, filter] };
  const matched = filterIssues(
    source,
    combined,
    filterContextFor(store, clock, { hideCustomers }),
  );

  let issues: Issue[] = [];
  for (const id of matched) {
    const issue = store.issues.get(id);
    if (issue !== undefined) issues.push(issue);
  }

  if (!display.showCompleted) {
    // Completed only, and not canceled with it. Canceled work is not finished work, and
    // making it vanish under a switch labelled "Show completed" would take issues off the
    // screen for a reason the label does not give.
    issues = issues.filter(
      (issue) => store.workflowStates.get(issue.stateId)?.category !== 'completed',
    );
  }

  if (!display.showSubIssues) {
    const present = new Set(issues.map((issue) => issue.id));
    issues = issues.filter((issue) => issue.parentId === undefined || !present.has(issue.parentId));
  }

  return {
    count: issues.length,
    groups: groupIssues(issues, store, display.groupBy, display.orderBy, display.direction).map(
      toViewGroup,
    ),
  };
}

function toViewGroup({ issues, ...rest }: IssueGroup): ViewGroup {
  return { ...rest, ids: issues.map((issue) => issue.id) };
}

/**
 * Parses the filter, keeping hold of why it failed.
 *
 * `parseFilterParam` reports through a callback because it must not throw — a link that
 * opens an unfiltered list is a mild disappointment, a link that throws is a page the
 * reader cannot open and cannot repair. Capturing the message here is what lets the filter
 * bar say so instead of silently showing everything.
 */
function readFilter(raw: string | null): { filter: FilterNode; error: string | null } {
  let error: string | null = null;
  const filter = parseFilterParam(raw, (message) => {
    error = message;
  });
  return { filter, error };
}

/** Absence means the default, and `DEFAULT_DISPLAY` is the one place that says which. */
function resolveDisplay(params: URLSearchParams): Required<DisplayOptions> {
  const parsed = parseDisplayParams(params);
  return {
    layout: parsed.layout ?? DEFAULT_DISPLAY.layout,
    groupBy: parsed.groupBy ?? DEFAULT_DISPLAY.groupBy,
    orderBy: parsed.orderBy ?? DEFAULT_DISPLAY.orderBy,
    direction: parsed.direction ?? DEFAULT_DISPLAY.direction,
    showSubIssues: parsed.showSubIssues ?? DEFAULT_DISPLAY.showSubIssues,
    showCompleted: parsed.showCompleted ?? DEFAULT_DISPLAY.showCompleted,
    showSnoozed: parsed.showSnoozed ?? DEFAULT_DISPLAY.showSnoozed,
    properties: parsed.properties ?? DEFAULT_DISPLAY.properties,
  };
}

/**
 * The characters that would change what a query string means, and their escapes.
 *
 * `%` is the load-bearing one. `toFilterParam` percent-encodes the values inside a filter
 * — that is what makes a `contains` clause holding "a, b)" unambiguous — so writing its
 * output into the URL raw would let the URL's own decoder unwrap those escapes a second
 * time, and the clause would come back as three values. Doubling the `%` puts the escaping
 * back where it belongs. The rest are insurance: the grammar's field and operator names
 * cannot contain them today, and a link that breaks because one day they can is not a
 * failure anybody would trace back to here.
 */
const QUERY_ESCAPES: Readonly<Record<string, string>> = {
  '%': '%25',
  '&': '%26',
  '#': '%23',
  '+': '%2B',
  ' ': '%20',
};

/**
 * The query string, with the filter grammar's own punctuation left readable.
 *
 * `URLSearchParams.toString()` is the obvious way to do this and it is the wrong one: it
 * escapes the parentheses and commas the grammar is built from, so a shared view arrives
 * as `?filter=priority.in%281%2C2%29`. It parses — but "a link a human reads before they
 * click it" is the entire reason `url.ts` is a grammar rather than base64, and that link
 * says nothing at all. Every character `toFilterParam` leaves raw is legal in a query
 * component; the ones that are not are escaped above.
 */
function searchStringOf(params: URLSearchParams): string {
  const parts: string[] = [];
  for (const [key, value] of params) {
    parts.push(
      key === FILTER_PARAM
        ? `${key}=${value.replace(/[%&#+ ]/g, (char) => QUERY_ESCAPES[char] ?? char)}`
        : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    );
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}
