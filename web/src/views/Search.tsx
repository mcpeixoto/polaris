/**
 * Search.
 *
 * Four things about this screen are decisions rather than mechanics, and each of them is a
 * property somebody would otherwise have to rediscover by using it wrong.
 *
 * **The query is in the URL.** `?q=` is the durable copy of it. That is the same rule
 * `features/view/ui/useView` states for filters and it exists for the same reason: a result
 * set has to be a link somebody can paste into a chat, and the person who clicks it has to
 * land on what the sender was looking at. Writes `replace` rather than push, because a query
 * is refined one character at a time and a history stack with an entry per keystroke is one
 * where the back button no longer means anything. The box itself is *not* driven straight
 * from the location, and `useQueryParam` states exactly why: react-router applies a location
 * change inside a transition, and a controlled input behind a transition drops the
 * characters typed while one is pending.
 *
 * **The ranking is the server's; the rows are the replica's.** Search is the one screen in
 * the client whose answer cannot be computed locally — relevance is a GIN scan over folded
 * text, and an approximation of it in the browser would put a different order on screen from
 * the one the API and every integration return. So the response decides *which* issues and
 * *in what order*, and each row is then read out of the store by id, exactly as the issue
 * list reads its rows. A title edited in another tab is therefore current here too, and
 * labels — which the API does not populate on a searched issue, see `operations.ts` — are
 * present at all. The response's own fields are the fallback for a row the replica does not
 * hold yet, so a cold client still shows a status rather than a gap.
 *
 * **Nothing blinks.** A request in flight leaves the previous answer on screen and puts a
 * spinner in the box; a failure leaves it there too and offers a retry above it. Results
 * that vanish on every keystroke are worse than results that are a fraction of a second
 * stale, and a search box that empties itself when the network hiccups reads as broken.
 *
 * **Replies are matched to their request.** Every request takes a sequence number and only
 * the newest one is allowed to write state. A search fires on every keystroke, responses do
 * not come back in order, and without this the answer to "log" lands after the answer to
 * "login" and the screen shows the wrong rows with no way to tell.
 *
 * On the keyboard: `/` focuses the box, Escape leaves it, and the arrows then move a cursor
 * through both sections with Enter to open. The two halves of that are not a preference —
 * the keymap deliberately does not deliver plain keystrokes to a focused text field (see
 * `app/keymap`, `isTypingTarget`), because a search box in which `j` moved the cursor would
 * be a search box you cannot type "json" into. Escape is the handover, and the field's hint
 * says so rather than leaving it to be discovered.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { useActions, useKeyContext } from '~/app/keymap';
import {
  Avatar,
  Button,
  EmptyState,
  Input,
  LabelChip,
  PriorityIcon,
  Spinner,
  StateIcon,
} from '~/components';
import { FILTER_PARAM, parseFilterParam } from '~/filter';
import {
  SEARCH_QUERY,
  type SearchComment,
  type SearchIssue,
  type SearchQueryData,
  type SearchResults,
  type SearchVariables,
} from '~/features/search/operations';
import {
  canShowMore,
  describeCommentCount,
  describeIssueCount,
  excerptAround,
  highlightRuns,
  QUERY_PARAM,
  SEARCH_MAX_RESULTS,
  SEARCH_PAGE_SIZE,
  searchTerms,
  type IssueTally,
} from '~/features/search/search';
import { when } from '~/features/time';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { EntityType, StateCategory, Store, UUID } from '~/store';
import { ApiError, gql } from '~/sync/api';
import styles from './Search.module.css';

/**
 * How many issues an empty box shows.
 *
 * A blank pane is indistinguishable from one that failed to load, and in a local-first
 * client that difference matters more than usual — the data may genuinely still be arriving.
 * Recent work is the honest thing to offer: it needs no network, it is what somebody
 * arriving at search without a query in mind is most likely to want, and it makes the shape
 * of a result row visible before anybody has typed anything.
 */
const RECENT_COUNT = 20;

/** The entity types a row is drawn from. Anything else moving must not wake this screen. */
const ROW_DEPS: readonly EntityType[] = [
  'issue',
  'issueLabel',
  'label',
  'user',
  'workflowState',
  'team',
  'comment',
];

interface LabelRef {
  readonly id: UUID;
  readonly name: string;
  readonly color: string;
  readonly groupName: string | undefined;
}

/** One issue, resolved for rendering. The same fields an issue-list row draws. */
interface IssueRow {
  readonly key: string;
  readonly id: UUID;
  readonly identifier: string;
  readonly title: string;
  readonly priority: number;
  readonly stateName: string;
  readonly stateCategory: StateCategory;
  readonly stateColor: string | undefined;
  readonly assigneeId: UUID | null;
  readonly assigneeName: string | null;
  readonly assigneeAvatar: string | null;
  readonly labels: readonly LabelRef[];
}

interface CommentRow {
  readonly key: string;
  readonly id: UUID;
  readonly body: string;
  /**
   * The issue the comment is on, as the route spells it — or null when the replica does not
   * hold that issue. Null is a real state rather than a defensive one: the schema's `Comment`
   * has no `issue` field, so the identifier can only come from the store, and a row that
   * cannot say where it lives says so instead of linking somewhere that does not resolve.
   */
  readonly identifier: string | null;
  readonly issueTitle: string | null;
  readonly createdAt: string;
}

interface ResultView {
  readonly issues: readonly IssueRow[];
  readonly comments: readonly CommentRow[];
}

const NOTHING: ResultView = { issues: [], comments: [] };

/** Where a keystroke can go. `to` is null for a row with nowhere to send anybody. */
interface Navigable {
  readonly key: string;
  readonly to: string | null;
}

/** What the registered actions call. Named so the ref's type is a contract, not an inference. */
interface SearchCommands {
  focusBox(): void;
  boxHasFocus(): boolean;
  leaveBox(): void;
  move(delta: number): void;
  open(): void;
  canOpen(): boolean;
  showMore(): void;
  canShowMore(): boolean;
}

export function Search() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [query, setQuery] = useQueryParam();
  const filterParam = params.get(FILTER_PARAM);
  const asked = query.trim();
  const showingRecent = asked === '';

  /**
   * Which query the reader pressed "show more" for.
   *
   * Held as the query rather than as a boolean so that typing another character collapses
   * the limit back to a page in the same render, with no effect and therefore no second
   * request. A limit reset in an effect would fire one request at the old limit and another
   * at the new one for every keystroke after an expansion.
   *
   * Deliberately not in the URL. The query is the view and belongs in a shareable link; how
   * far somebody scrolled through the answer to it is not.
   */
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const limit = expandedFor === query ? SEARCH_MAX_RESULTS : SEARCH_PAGE_SIZE;

  const request = useSearchResults(query, filterParam, limit);

  // The terms the *answer* was matched on, not the ones currently in the box. While a
  // request is in flight those differ by a keystroke, and highlighting the newer ones would
  // decorate rows against a query they were never matched against.
  const terms = useMemo(() => searchTerms(request.answered), [request.answered]);

  const view = useLiveQuery(
    (store) => (showingRecent ? recentView(store) : resultView(store, request.results)),
    ROW_DEPS,
    // The answer's identity, so a new response re-runs the selector even though the store
    // has not moved. See `useLiveQuery` for why a closed-over value has to be declared.
    [showingRecent, answerKey(request.results)],
  );

  const rows = useMemo<readonly Navigable[]>(
    () => [
      ...view.issues.map((issue) => ({ key: issue.key, to: `/issue/${issue.identifier}` })),
      ...view.comments.map((comment) => ({
        key: comment.key,
        to: comment.identifier === null ? null : `/issue/${comment.identifier}`,
      })),
    ],
    [view],
  );

  const [cursorKey, setCursorKey] = useState<string | null>(null);

  /**
   * Where the keyboard is, resolved against the results as they stand.
   *
   * Held as a row key and re-resolved rather than stored as a position, for the same reason
   * the issue list holds an id: a response that arrives while somebody is arrowing down
   * should leave them on the row they were looking at if it is still there, and send them
   * back to the top only when it has genuinely gone.
   */
  const cursorIndex = useMemo(() => {
    if (cursorKey !== null) {
      const at = rows.findIndex((row) => row.key === cursorKey);
      if (at !== -1) return at;
    }
    return rows.length === 0 ? -1 : 0;
  }, [cursorKey, rows]);

  const boxRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const tally: IssueTally | null =
    request.results === null
      ? null
      : { shown: view.issues.length, total: request.results.issueCount, limit };

  /**
   * Every command, rebuilt each render and reached through a ref.
   *
   * The registry captures an action's `run` once, at registration. Re-registering the whole
   * keymap on every cursor move would tear a dozen bindings down and rebuild them; reading
   * through a ref keeps the registration stable and the behaviour current.
   */
  const commands = useRef<SearchCommands>({
    focusBox: () => {},
    boxHasFocus: () => false,
    leaveBox: () => {},
    move: () => {},
    open: () => {},
    canOpen: () => false,
    showMore: () => {},
    canShowMore: () => false,
  });

  commands.current = {
    focusBox: () => boxRef.current?.focus(),
    boxHasFocus: () => boxRef.current !== null && document.activeElement === boxRef.current,
    leaveBox: () => listRef.current?.focus(),
    move: (delta) => {
      if (rows.length === 0) return;
      const at = Math.min(Math.max(cursorIndex + delta, 0), rows.length - 1);
      const next = rows[at];
      if (next === undefined) return;
      setCursorKey(next.key);
      scrollRowIntoView(next.key);
    },
    open: () => {
      const target = rows[cursorIndex];
      if (target === undefined || target.to === null) return;
      void navigate(target.to);
    },
    canOpen: () => {
      const target = rows[cursorIndex];
      return target !== undefined && target.to !== null;
    },
    showMore: () => setExpandedFor(query),
    canShowMore: () => tally !== null && canShowMore(tally),
  };

  useKeyContext('list');

  useActions(
    [
      {
        id: 'search.focus',
        title: 'Search',
        keys: ['/'],
        when: 'list',
        group: 'Search',
        run: () => commands.current.focusBox(),
      },
      {
        // Escape is one of the few chords the keymap delivers out of a text field, which is
        // what makes this the handover from typing to navigating. Gated on the box actually
        // having focus, so that with the keyboard already on the results Escape falls
        // through to the shell's own dismiss instead of being swallowed here.
        id: 'search.leaveBox',
        title: 'Move to the results',
        keys: ['Escape'],
        when: 'list',
        group: 'Search',
        hidden: true,
        enabled: () => commands.current.boxHasFocus(),
        run: () => commands.current.leaveBox(),
      },
      {
        id: 'search.next',
        title: 'Next result',
        keys: ['ArrowDown', 'j'],
        when: 'list',
        group: 'Navigation',
        // Hidden from the command menu: "Next result" is not something anybody searches for,
        // and it still appears in the help overlay, which is where it belongs.
        hidden: true,
        run: () => commands.current.move(1),
      },
      {
        id: 'search.previous',
        title: 'Previous result',
        keys: ['ArrowUp', 'k'],
        when: 'list',
        group: 'Navigation',
        hidden: true,
        run: () => commands.current.move(-1),
      },
      {
        id: 'search.open',
        title: 'Open result',
        keys: ['Enter'],
        when: 'list',
        group: 'Search',
        enabled: () => commands.current.canOpen(),
        run: () => commands.current.open(),
      },
      {
        // No key of its own. It is a rare, deliberate action with an obvious button, and a
        // shortcut for it would be one more claim on a letter for no gain — but it belongs
        // in the registry so the command menu offers it and so it is disabled in exactly the
        // case the button is.
        id: 'search.showMore',
        title: 'Show more results',
        when: 'list',
        group: 'Search',
        enabled: () => commands.current.canShowMore(),
        run: () => commands.current.showMore(),
      },
    ],
    [],
  );

  const cursor = cursorIndex === -1 ? undefined : rows[cursorIndex];
  const nothingFound =
    !showingRecent && request.results !== null && rows.length === 0 && !request.busy;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.screenTitle}>Search</h1>
        <Input
          ref={boxRef}
          className={styles.box}
          type="search"
          label="Search"
          hideLabel
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="Search issues and comments"
          hint="Escape moves to the results, then the arrow keys move through them and Enter opens one."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          prefix={<SearchGlyph />}
          // Inside the box rather than over the list, because the list is the thing that
          // must not move: the spinner has to say "still working" without taking the
          // previous answer off the screen.
          suffix={request.busy ? <Spinner size="sm" label="Searching" /> : undefined}
        />
      </header>

      {request.error === null ? null : (
        <div className={styles.failure} role="alert">
          <span>{request.error}</span>
          <div className={styles.spacer} />
          <Button size="sm" onClick={() => request.retry()}>
            Retry
          </Button>
        </div>
      )}

      {tally === null ? null : (
        // A live region, because the count is the answer to "did that do anything?" after a
        // keystroke that changed nothing visible in the first few rows.
        <div className={styles.summary} role="status" aria-live="polite">
          <span>{describeIssueCount(tally)}</span>
          <span aria-hidden="true">·</span>
          <span>{describeCommentCount(view.comments.length)}</span>
        </div>
      )}

      <div className={styles.results}>
        {nothingFound ? (
          <EmptyState
            className={styles.empty}
            title={`Nothing matches "${asked}"`}
            description="Search covers issue titles and descriptions and the text of comments. Case and accents are ignored, so acao finds Ação."
          />
        ) : showingRecent && view.issues.length === 0 ? (
          <EmptyState
            className={styles.empty}
            title="Nothing to search yet"
            description="Once this workspace has issues, what you were last working on will be here and the box above will find the rest."
          />
        ) : (
          <div
            ref={listRef}
            className={styles.list}
            // A listbox rather than a plain list: the cursor is managed here rather than by
            // the browser's focus, so the active row has to be announced as such. The rows
            // are still real links, so middle-click and "copy link address" work — they only
            // give up being announced as links, which inside a listbox they should be.
            role="listbox"
            aria-label={showingRecent ? 'Recently updated issues' : 'Search results'}
            aria-activedescendant={cursor === undefined ? undefined : rowDomId(cursor.key)}
            tabIndex={0}
          >
            {view.issues.length === 0 ? null : (
              <>
                <SectionHead
                  name={showingRecent ? 'Recently updated' : 'Issues'}
                  count={tally === null ? null : describeIssueCount(tally)}
                />
                {view.issues.map((row, at) => (
                  <IssueResult
                    key={row.key}
                    row={row}
                    terms={terms}
                    active={at === cursorIndex}
                    onFocus={setCursorKey}
                  />
                ))}
              </>
            )}

            {view.comments.length === 0 ? null : (
              <>
                <SectionHead name="Comments" count={describeCommentCount(view.comments.length)} />
                {view.comments.map((row, at) => (
                  <CommentResult
                    key={row.key}
                    row={row}
                    terms={terms}
                    active={view.issues.length + at === cursorIndex}
                    onFocus={setCursorKey}
                  />
                ))}
              </>
            )}
          </div>
        )}

        {tally === null || !canShowMore(tally) ? null : (
          <div className={styles.more}>
            <Button onClick={() => commands.current.showMore()}>Show more</Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A section heading.
 *
 * Hidden from assistive technology, exactly as the issue list's group headers are: every row
 * underneath already announces what it is, and a heading inside a listbox would be read as a
 * stray item between the options.
 */
function SectionHead({ name, count }: { name: string; count: string | null }) {
  return (
    <div className={styles.sectionHead} aria-hidden="true">
      <span className={styles.sectionName}>{name}</span>
      {count === null ? null : <span className={styles.sectionCount}>{count}</span>}
    </div>
  );
}

interface ResultProps<Row> {
  readonly row: Row;
  readonly terms: readonly string[];
  /** Under the keyboard cursor. One row at a time across both sections. */
  readonly active: boolean;
  readonly onFocus: (key: string) => void;
}

function IssueResult({ row, terms, active, onFocus }: ResultProps<IssueRow>) {
  return (
    <Link
      id={rowDomId(row.key)}
      to={`/issue/${row.identifier}`}
      role="option"
      aria-selected={active}
      // Out of the tab order: inside a listbox the container holds focus and the cursor is
      // named by aria-activedescendant. Tabbing through a hundred results is not navigation.
      tabIndex={-1}
      className={[styles.row, active ? styles.active : null].filter(Boolean).join(' ')}
      onClick={() => onFocus(row.key)}
    >
      <PriorityIcon priority={row.priority} decorative />
      <span className={styles.identifier}>{row.identifier}</span>
      <StateIcon category={row.stateCategory} color={row.stateColor} label={row.stateName} />
      <span className={styles.title}>
        <Highlighted text={row.title} terms={terms} />
      </span>
      {row.labels.length === 0 ? null : (
        <span className={styles.labels}>
          {row.labels.map((label) => (
            <LabelChip
              key={label.id}
              compact
              name={label.name}
              color={label.color}
              groupName={label.groupName}
            />
          ))}
        </span>
      )}
      {row.assigneeName === null ? (
        <span className={styles.unassigned} aria-label="Unassigned" role="img" />
      ) : (
        <Avatar
          name={row.assigneeName}
          src={row.assigneeAvatar}
          size="xs"
          colorKey={row.assigneeId ?? row.assigneeName}
        />
      )}
    </Link>
  );
}

function CommentResult({ row, terms, active, onFocus }: ResultProps<CommentRow>) {
  const className = [styles.row, styles.commentRow, active ? styles.active : null]
    .filter(Boolean)
    .join(' ');

  const body = (
    <>
      <span className={styles.commentMeta}>
        <span className={styles.identifier}>{row.identifier ?? '—'}</span>
        <span className={styles.commentIssue}>
          {row.issueTitle ?? 'On an issue this device has not received yet'}
        </span>
        <span>{when(row.createdAt)}</span>
      </span>
      <span className={styles.excerpt}>
        <Highlighted text={excerptAround(row.body, terms)} terms={terms} />
      </span>
    </>
  );

  // Nowhere to go: the replica does not hold the issue, so there is no identifier to build a
  // route from. Rendered as a row rather than dropped, because the comment did match and
  // hiding it would make the count on screen disagree with the list under it.
  if (row.identifier === null) {
    return (
      <div id={rowDomId(row.key)} role="option" aria-selected={active} className={className}>
        {body}
      </div>
    );
  }

  return (
    <Link
      id={rowDomId(row.key)}
      to={`/issue/${row.identifier}`}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      className={className}
      onClick={() => onFocus(row.key)}
    >
      {body}
    </Link>
  );
}

/** A string with the searched-for words marked. See `highlightRuns` for what counts as one. */
function Highlighted({ text, terms }: { text: string; terms: readonly string[] }) {
  return (
    <>
      {highlightRuns(text, terms).map((run, at) =>
        run.match ? (
          <mark key={at} className={styles.mark}>
            {run.text}
          </mark>
        ) : (
          // A span rather than a bare string, so that React keys the runs rather than
          // re-conciling a mixed array of strings and elements on every keystroke.
          <span key={at}>{run.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The query, in the URL, in a box that does not lose characters.
 *
 * The URL is still the durable copy — `?q=` is what makes a result set a link somebody can
 * paste — but the input cannot be driven straight from it, and the reason is specific enough
 * to be worth stating rather than rediscovering.
 *
 * `BrowserRouter` applies every location change inside `React.startTransition`
 * (react-router 7). A transition is interruptible, and the thing that interrupts it is the
 * next keystroke: React re-renders urgently with the *previous* location, finds a controlled
 * input whose `value` prop no longer matches the DOM, and resets the DOM to the prop. The
 * character that arrived during the transition is then gone from the box and from the URL
 * both, and the next one is typed onto the shorter string. Measured on this screen before
 * this hook existed: at 4x CPU throttling, "json parser" typed at a very ordinary 150 ms a
 * character arrived as "jon parsr"; at 6x, even 200 ms a character lost half of it. The same
 * input inside a dialogue, backed by plain `useState`, kept every character at 0 ms — the
 * transition is the whole difference.
 *
 * So the text lives in urgent state and the URL is written from it:
 *
 *  - the box renders `typed`, which a keystroke updates urgently and nothing rolls back;
 *  - the write effect pushes `typed` into `?q=`, `replace`d rather than pushed, because a
 *    query is refined one character at a time and a history entry per keystroke is a back
 *    button that no longer means anything;
 *  - the adopt effect takes a query that arrived from anywhere else — back, forward, a
 *    pasted link, a command-menu jump — and puts it in the box.
 *
 * `written` is what tells those two apart, and it has to be a list rather than a single
 * value. While somebody is typing there are several locations in flight at once, and each
 * lands as a separate render: seeing "jso" arrive when the box already says "json" means the
 * *older* of this screen's own writes just committed, not that anything outside changed it.
 * A value found in the list is therefore consumed and ignored, and only a location this
 * screen never asked for reaches the box.
 */
function useQueryParam(): [string, (next: string) => void] {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const initial = params.get(QUERY_PARAM) ?? '';
  const [typed, setTyped] = useState(initial);

  /** Queries this screen has asked for and not yet seen come back. Oldest first. */
  const written = useRef<string[]>([initial]);

  // The rest of the query string, so writing `q` does not drop the filter beside it. Held
  // in a ref because the write must depend on the text alone: an effect that re-ran when
  // the location changed would answer the back button by writing the old query back.
  const others = useRef(params);
  others.current = params;

  useEffect(() => {
    if (written.current[written.current.length - 1] === typed) return;
    written.current.push(typed);

    const search = new URLSearchParams(others.current);
    // Deleted rather than left empty: a bare `?q=` in a shared link says "a search" about
    // a page that is not one.
    if (typed === '') search.delete(QUERY_PARAM);
    else search.set(QUERY_PARAM, typed);

    const rest = search.toString();
    void navigate({ search: rest === '' ? '' : `?${rest}` }, { replace: true });
  }, [typed, navigate]);

  // What the box says, for the effect below to compare against without depending on it. An
  // adopt effect that re-ran on every keystroke would run against a location one write
  // behind, mistake it for an outside change, and put the box back a character.
  const current = useRef(typed);
  current.current = typed;

  useEffect(() => {
    const settled = params.get(QUERY_PARAM) ?? '';

    const mine = written.current.indexOf(settled);
    if (mine !== -1) {
      // One of this screen's own writes, arriving after the box has already moved on.
      written.current.splice(0, mine + 1);
      return;
    }
    if (settled === current.current) return;

    // Somewhere else set the query. Recorded as written so the effect above does not
    // immediately answer by putting the old one back.
    written.current = [settled];
    setTyped(settled);
  }, [params]);

  return [typed, setTyped];
}

interface SearchRequest {
  /** The last answer, kept on screen while a newer one is in flight or has failed. */
  readonly results: SearchResults | null;
  /** The query `results` answers. Not necessarily what is in the box right now. */
  readonly answered: string;
  readonly busy: boolean;
  readonly error: string | null;
  retry(): void;
}

type RequestState = Omit<SearchRequest, 'retry'>;

const IDLE: RequestState = { results: null, answered: '', busy: false, error: null };

/**
 * The one request this screen makes, run again whenever its question changes.
 *
 * The sequence number is the whole point of the hook and the reason it is not three lines
 * inline. Search fires on every keystroke, so several requests are in flight at once, and
 * responses do not arrive in the order they were sent — a slow "log" landing after a fast
 * "login" would leave the box saying one thing and the list showing another, with nothing on
 * screen to say which is true.
 *
 * `AbortController` alone does not solve it. An abort is a request to stop, not a promise
 * that nothing lands: a response already being parsed still resolves, and a fetch aborted a
 * microsecond after the server replied still delivers. So the controller is there to stop
 * paying for work nobody wants, and the counter is what decides who is allowed to write.
 *
 * Nothing is debounced, deliberately. An empty or unparseable query returns empty results
 * rather than an error, so a request per keystroke is safe; and a debounce would put the
 * list permanently behind the typing, which is the one thing this product cannot look like.
 */
function useSearchResults(query: string, filterParam: string | null, limit: number): SearchRequest {
  const [state, setState] = useState<RequestState>(IDLE);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (query.trim() === '') {
      // Bumped as well as cleared, so a reply to the query the user has just deleted cannot
      // land on top of the recent-work list that replaced it.
      latest.current += 1;
      setState(IDLE);
      return;
    }

    latest.current += 1;
    const sequence = latest.current;
    const controller = new AbortController();

    setState((previous) => ({ ...previous, busy: true, error: null }));

    void gql<SearchQueryData>(SEARCH_QUERY, variablesFor(query, filterParam, limit), {
      signal: controller.signal,
    })
      .then((data) => {
        if (sequence !== latest.current) return;
        setState({ results: data.search, answered: query, busy: false, error: null });
      })
      .catch((error: unknown) => {
        if (sequence !== latest.current) return;
        // The previous results are kept. They are still the best thing on the screen, and
        // clearing them would punish the reader for the network's problem.
        setState((previous) => ({ ...previous, busy: false, error: describeFailure(error) }));
      });

    return () => {
      latest.current += 1;
      controller.abort();
    };
  }, [query, filterParam, limit, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { ...state, retry };
}

/** What to tell somebody whose search did not run. */
function describeFailure(error: unknown): string {
  if (error instanceof ApiError && error.isOffline) {
    return 'Search runs on the server, and this device cannot reach it.';
  }
  if (error instanceof Error && error.message !== '') return error.message;
  return 'That search could not be run.';
}

/**
 * The variables for one search.
 *
 * The filter is read from the URL with the grammar's own parser and passed through as the
 * AST, untouched — which is what makes a search and a saved view with the same filter return
 * the same issues, because there is one compiler on each side and no third encoding in
 * between. A filter this build cannot read is dropped rather than sent: the parser already
 * declines to throw on a hand-edited URL, and forwarding whatever it salvaged would make the
 * server refuse a query the user could not see anything wrong with.
 */
function variablesFor(query: string, filterParam: string | null, limit: number): SearchVariables {
  let broken = false;
  const filter =
    filterParam === null || filterParam.trim() === ''
      ? undefined
      : parseFilterParam(filterParam, () => {
          broken = true;
        });

  return {
    input: {
      query,
      first: limit,
      ...(filter === undefined || broken ? null : { filter }),
    },
  };
}

/**
 * The identity of an answer: which rows, in which order.
 *
 * Used as the store subscription's input, so a response with the same ids in the same order
 * — a "show more" that turned up nothing new, a retry after a blip — does not rebuild rows
 * that have not changed.
 */
function answerKey(results: SearchResults | null): string {
  if (results === null) return 'none';
  return `${results.issues.map((issue) => issue.id).join(',')}|${results.comments
    .map((comment) => comment.id)
    .join(',')}`;
}

/** The search's answer, resolved against the replica. See the note at the top of the file. */
function resultView(store: Store, results: SearchResults | null): ResultView {
  if (results === null) return NOTHING;

  const issues: IssueRow[] = [];
  for (const found of results.issues) {
    const row = issueRow(store, found.id, found);
    if (row !== null) issues.push(row);
  }
  return { issues, comments: results.comments.map((found) => commentRow(store, found)) };
}

/** What an empty box shows: the workspace's most recently touched work. */
function recentView(store: Store): ResultView {
  const { ids } = store.query({ sortBy: 'updatedAt', direction: 'desc' });

  const issues: IssueRow[] = [];
  for (const id of ids.slice(0, RECENT_COUNT)) {
    const row = issueRow(store, id, null);
    if (row !== null) issues.push(row);
  }
  return { issues, comments: [] };
}

/**
 * One issue row, preferring the replica and falling back to what the search returned.
 *
 * The replica wins because it carries the delta stream *and* this user's own unsent writes,
 * neither of which the response has: preferring the response would flip a title somebody
 * renamed a moment ago back to what the server last indexed. The fallback exists because a
 * ranked result may name an issue this device has not received yet, and a row with a blank
 * status reads as a bug rather than as a cold cache.
 */
function issueRow(store: Store, id: UUID, wire: SearchIssue | null): IssueRow | null {
  const local = store.issues.get(id);

  if (local === undefined) {
    if (wire === null) return null;
    return {
      key: `issue-${wire.id}`,
      id: wire.id,
      identifier: wire.identifier,
      title: wire.title,
      priority: wire.priority,
      stateName: wire.state.name,
      stateCategory: wire.state.category,
      stateColor: wire.state.color,
      assigneeId: wire.assignee?.id ?? null,
      assigneeName: wire.assignee?.displayName ?? null,
      assigneeAvatar: wire.assignee?.avatarUrl ?? null,
      // No labels: the replica does not hold the issue, so it does not hold what is applied
      // to it either — and the API does not populate `Issue.labels`. See `operations.ts`.
      labels: [],
    };
  }

  const state = store.workflowStates.get(local.stateId);
  const assignee = local.assigneeId === undefined ? undefined : store.users.get(local.assigneeId);

  return {
    key: `issue-${local.id}`,
    id: local.id,
    identifier: store.identifierOf(local),
    title: local.title,
    priority: local.priority,
    stateName: state?.name ?? wire?.state.name ?? 'No status',
    stateCategory: state?.category ?? wire?.state.category ?? 'backlog',
    stateColor: state?.color ?? wire?.state.color,
    assigneeId: assignee?.id ?? null,
    assigneeName: assignee?.displayName ?? null,
    assigneeAvatar: assignee?.avatarUrl ?? null,
    labels: labelsOf(store, local.id),
  };
}

function commentRow(store: Store, wire: SearchComment): CommentRow {
  const local = store.get('comment', wire.id);
  const issue = store.issues.get(wire.issueId);

  return {
    key: `comment-${wire.id}`,
    id: wire.id,
    body: local?.body ?? wire.body,
    identifier: issue === undefined ? null : store.identifierOf(issue),
    issueTitle: issue?.title ?? null,
    createdAt: local?.createdAt ?? wire.createdAt,
  };
}

/**
 * The labels applied to an issue, with the group each belongs to.
 *
 * The group's name travels with the chip because "P0" alone is a mystery to anybody who has
 * not memorised the taxonomy, and two labels called "High" in different groups are otherwise
 * indistinguishable.
 */
function labelsOf(store: Store, issueId: UUID): LabelRef[] {
  const labels: LabelRef[] = [];
  for (const labelId of store.labelIdsFor(issueId)) {
    const label = store.get('label', labelId);
    if (label === undefined) continue;
    const group = label.parentId === undefined ? undefined : store.get('label', label.parentId);
    labels.push({ id: label.id, name: label.name, color: label.color, groupName: group?.name });
  }
  // By name, so a row's chips do not reorder when a delta re-inserts one of them.
  return labels.sort((a, b) => a.name.localeCompare(b.name));
}

/** Stable per row, because `aria-activedescendant` has to name an element that exists. */
function rowDomId(key: string): string {
  return `search-result-${key}`;
}

function scrollRowIntoView(key: string): void {
  const node = document.getElementById(rowDomId(key));
  // Guarded because this is decoration, not behaviour: jsdom lays nothing out and does not
  // implement scrollIntoView, and a cursor that cannot scroll is still a cursor.
  if (node !== null && typeof node.scrollIntoView === 'function') {
    node.scrollIntoView({ block: 'nearest' });
  }
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
