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
 *
 * **Display options are also remembered per person, per screen** — `preferenceKey`. That is
 * not a second copy of the state and must not become one: what is remembered is a *starting
 * point* for the URL, written into it on arrival exactly the way `SavedView` seeds a saved
 * view's filter, after which the search params are the only copy again.
 *
 * Four things can answer "how should this page look", and they are consulted in this order:
 *
 *   1. the URL, if it says anything at all about display;
 *   2. this person's remembered options for this screen (`preferenceKey`);
 *   3. the screen's own default, where it has one — a saved view's `display`;
 *   4. `DEFAULT_DISPLAY`.
 *
 * The URL is first because the person opening a link has to see what the sender saw, and it
 * is all-or-nothing rather than merged. A link reading `?layout=board` omits every option
 * that is at its default, so filling the gaps from the reader's own preference would hand
 * them the sender's layout under the reader's grouping — a view neither of them has ever
 * looked at. Between 2 and 3, personal beats shared, because that is the only thing the word
 * personal can mean.
 *
 * All four are resolved here rather than by the screens, which is a change worth knowing
 * about: `SavedView` and `ProjectAttachedView` used to write the view's display into the URL
 * themselves. Two components racing to set the same parameters were resolved by whichever
 * effect React ran last, and that was the shared default — so the option somebody had chosen
 * was quietly overwritten by the team's on every visit. They still seed the filter, which
 * nothing else claims.
 */

import { useCallback, useEffect, useMemo } from 'react';
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
import { useEngine } from '~/app/context';
import { filterContextFor, groupIssues, type IssueGroup, type ViewClock } from '~/features/view';
import { report } from '~/features/issue/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer, useViewerId } from '~/hooks/useViewer';
import type { Issue, Store, UUID } from '~/store';

import { setViewPreference } from '../mutations';

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
  /**
   * What this screen looks like fresh — `DEFAULT_DISPLAY`, or a saved view's own display.
   *
   * The display menu draws its "Default: …" hints and its Reset button from this rather than
   * from `DEFAULT_DISPLAY`, because on a screen with a saved default the product's are not
   * the ones the reader is being returned to, and a menu that named the wrong one would send
   * somebody looking for a setting they had never changed.
   */
  readonly defaults: Required<DisplayOptions>;
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
  /**
   * The team the view is scoped to, when it is scoped to one.
   *
   * Only grouping uses it, and only to know whose status list to show the whole of.
   * Statuses belong to a team, so a team's list is the one fixed set worth padding with
   * empty columns; a view that spans teams leaves this unset. It deliberately does not
   * filter — `issues` already decided what the view is over.
   */
  readonly teamId?: UUID | undefined;
  /**
   * The name this screen's display options are remembered under, per person.
   *
   * A *screen*, not a team and not a view row: "the ENG issue list", "my issues", "this
   * project's issues". Grouping is a decision about a page, and the same person wants their
   * triage inbox and their team's backlog to look like different things — so `team:ENG` and
   * `triage:<id>` are separate keys even though they are the same team's work.
   *
   * Left unset the screen remembers nothing, which is right for a list whose identity is not
   * stable enough to be worth a row: the ad-hoc list's key would be the identifiers in its
   * own URL, and every link somebody opened would leave a preference behind that could never
   * apply to anything again.
   */
  readonly preferenceKey?: string | undefined;
  /**
   * How this screen looks to somebody who has never touched it — a saved view's own
   * `display`, and nothing on a screen that is a route rather than a row.
   *
   * Below the personal preference and above `DEFAULT_DISPLAY`. That order is the point of
   * threading it through here rather than letting the screen seed the URL itself, which is
   * what `SavedView` used to do: two components racing to write the same parameters resolved
   * by which one's effect React happened to run first, and it ran the view's default *after*
   * the preference — so the option somebody had chosen was overwritten by the shared one on
   * every visit. One fallback chain in one place cannot have that bug.
   */
  readonly defaultDisplay?: DisplayOptions | undefined;
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

/** The remembered options are one row, and nothing else can change them. */
const PREFERENCE_DEPS = ['viewPreference'] as const;

const NO_INPUTS: readonly unknown[] = [];

/** Stands in for "nothing was said", so `resolveDisplay` has one shape to read. */
const EMPTY_PARAMS = new URLSearchParams();

/**
 * The options that are not already the default — what a remembered preference holds.
 *
 * Round-tripped through the URL codec rather than compared field by field, so that the row
 * and the address bar cannot disagree about what a choice is: the same encoder decides what
 * counts as a departure from the default, and the same parser decides what is legible. A
 * hand-written comparison here would be a second definition of both, and the day
 * `DEFAULT_DISPLAY` changed, one of them would be updated.
 */
export function displayOverrides(display: DisplayOptions): DisplayOptions {
  return parseDisplayParams(new URLSearchParams(toDisplayParams(display)));
}

/**
 * A stored set of options as search params, or null when there is no such row at all.
 *
 * An *empty* one is not null, and the difference matters more than it looks. A preference
 * holding no overrides is somebody who has looked at the menu and chosen the product's
 * defaults — on a saved view whose own display says otherwise, that is a real choice and the
 * only way to express it. Folding it in with "no row" would make the view's default
 * unbeatable: every attempt to select it would encode to nothing and be read back as silence.
 *
 * `properties` is guarded because it is the one field `toDisplayParams` calls a method on,
 * and the row is JSON the server stores without reading: a client that once wrote something
 * else there would otherwise take the whole screen down on arrival.
 */
function storedDisplayParams(stored: DisplayOptions | null | undefined): URLSearchParams | null {
  if (stored === null || stored === undefined) return null;
  const safe = Array.isArray(stored.properties) ? stored : { ...stored, properties: undefined };
  return new URLSearchParams(toDisplayParams(safe));
}

/**
 * A set of options as one comparable string — what "is this already the default" asks.
 *
 * The encoded form rather than the objects, because that is the form the question is really
 * about: options that serialise identically *are* the same view, however differently the two
 * objects spell "at its default".
 */
export function displaySignature(display: DisplayOptions): string {
  return storedDisplayParams(display)?.toString() ?? '';
}

export function useView({
  issues,
  inputs = NO_INPUTS,
  timezone,
  now,
  sourceFilter,
  teamId,
  preferenceKey,
  defaultDisplay,
}: UseViewOptions): ViewState {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const engine = useEngine();
  const viewer = useViewer();
  const viewerId = useViewerId();
  const hideCustomers = viewer === null || viewer.role === 'guest';

  const raw = params.get(FILTER_PARAM);
  const { filter, error } = useMemo(() => readFilter(raw), [raw]);

  // Any one of them, not all of them: `toDisplayParams` omits everything already at its
  // default, so a link that says only `layout=board` is still a complete statement about how
  // the page should look, and the six it left out are not gaps for a preference to fill.
  const urlDisplay = useMemo(
    () => (Object.values(DISPLAY_PARAMS).some((name) => params.has(name)) ? params : null),
    [params],
  );

  const stored = useLiveQuery(
    (store) => {
      if (preferenceKey === undefined || viewerId === null) return null;
      const id = store.viewPreferenceIdFor(viewerId, preferenceKey);
      return id === undefined ? null : (store.get('viewPreference', id)?.display ?? null);
    },
    PREFERENCE_DEPS,
    [preferenceKey ?? '', viewerId ?? ''],
  );

  // Re-encoded and re-parsed rather than trusted. The row is JSON the server does not read,
  // so it can hold a grouping this build has never heard of — a colleague on a newer client,
  // or the same person before a downgrade. Running it back through the URL codec means the
  // one validator the address bar already uses decides what is legible, and an option this
  // build cannot draw falls back to the default instead of reaching a `<Select>` that has no
  // such option and rendering blank.
  const storedParams = useMemo(() => storedDisplayParams(stored), [stored]);
  const defaultParams = useMemo(() => storedDisplayParams(defaultDisplay), [defaultDisplay]);

  /**
   * What the screen falls back to when the address bar says nothing: this person's
   * remembered options, else the page's own default, else the product's.
   *
   * The `viewerId` guard is what stops the second from being used in place of the first.
   * Who the viewer is arrives over the network — one query per session — and until it does,
   * nobody's preferences can be looked up, so an unguarded chain would read "no preference"
   * and seed the screen's shared default into the URL. The moment that lands the URL is no
   * longer silent, so the preference that arrives a frame later is outranked by it: the
   * choice is not lost, it is *shadowed*, on every cold load, and it looks like the setting
   * never saved.
   */
  const preferenceSettled = preferenceKey === undefined || viewerId !== null;
  const fallbackParams = storedParams ?? (preferenceSettled ? defaultParams : null);

  const display = useMemo(
    () => resolveDisplay(urlDisplay ?? fallbackParams ?? EMPTY_PARAMS),
    [urlDisplay, fallbackParams],
  );
  const defaults = useMemo(() => resolveDisplay(defaultParams ?? EMPTY_PARAMS), [defaultParams]);

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
        teamId,
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
      teamId ?? '',
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
      const merged = { ...display, ...patch };
      const next = toDisplayParams(merged);
      writeParams((search) => {
        // Cleared first: `toDisplayParams` omits every value that is already the default,
        // so a param left behind would pin a choice the user has just undone.
        for (const name of Object.values(DISPLAY_PARAMS)) search.delete(name);
        for (const [name, value] of Object.entries(next)) search.set(name, value);
      });
      if (preferenceKey === undefined || viewerId === null) return;
      // Fire and forget, and deliberately not awaited before the URL is written: the change
      // is already on screen, and a grouping that waited for a round trip before it applied
      // would make the menu feel like a form. `setViewPreference` swallows an offline
      // failure by itself — the next change retries it.
      //
      // The overrides rather than the resolved options, for the same reason the URL omits
      // defaults: a row restating today's defaults would pin them, and somebody who never
      // touched sub-issues would keep the old default after it changed.
      void setViewPreference(engine, viewerId, preferenceKey, displayOverrides(merged)).catch(
        report,
      );
    },
    [writeParams, display, engine, preferenceKey, viewerId],
  );

  /**
   * Writes a remembered preference into the address bar on arrival.
   *
   * Not because the view needs it — `display` already resolved from the same row — but
   * because the URL is supposed to be the whole answer to "what am I looking at". A screen
   * showing a board while its address bar says nothing about layout is a link that opens as
   * something else for the person you sent it to, and the first place anyone notices is
   * "Copy view link".
   *
   * `replace`, and only when the bar says nothing at all, so it cannot fight the params it
   * has just written, and cannot leave a back button pointing at the bare URL that would
   * immediately redirect forward again.
   *
   * `params` is a dependency, which looks like it should loop and does not: the write puts a
   * display parameter in the bar, `urlDisplay` stops being null, and the guard closes. It
   * has to be one, because this is not the only effect writing to the address bar on arrival
   * — `SavedView` seeds the filter from the same commit, off its own copy of the params, and
   * whichever of the two runs second overwrites what the first wrote. Re-running on the
   * result is what lets the pair settle instead of racing.
   */
  useEffect(() => {
    if (urlDisplay !== null || fallbackParams === null) return;
    const entries = [...fallbackParams];
    if (entries.length === 0) return;
    const next = new URLSearchParams(params);
    for (const [name, value] of entries) next.set(name, value);
    void navigate({ search: searchStringOf(next) }, { replace: true });
  }, [urlDisplay, fallbackParams, params, navigate]);

  return {
    filter,
    display,
    defaults,
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
  teamId: UUID | undefined,
): ViewResult {
  const combined =
    sourceFilter === undefined ? filter : { conj: 'and' as const, nodes: [sourceFilter, filter] };
  const matched = filterIssues(source, combined, filterContextFor(store, clock, { hideCustomers }));

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
    groups: groupIssues(
      issues,
      store,
      display.groupBy,
      display.orderBy,
      display.direction,
      teamId,
    ).map(toViewGroup),
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
