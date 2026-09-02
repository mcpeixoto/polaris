/**
 * The issue list — the screen the product is judged on.
 *
 * Three constraints shape everything here, and they pull against each other:
 *
 * **It has to stay fluid over five thousand issues.** So the parent never touches an issue.
 * It asks the store for ids, grouped and sorted, and flattens them into rows; each row
 * subscribes to its own issue and renders itself. A parent that mapped over entities would
 * rebuild five thousand objects every time somebody in another timezone changed a title, and
 * the frame budget would be gone before React started diffing. Only the thirty-odd rows on
 * screen exist as components at all — the virtualiser owns the rest as arithmetic.
 *
 * **It has to be operable entirely from the keyboard.** Every command is a registered action
 * in the `list` context, so `J`, `K`, `X`, `S`, `A`, `P`, `L`, `I`, `E` and the Shift
 * chords appear in the help overlay and the command menu without anybody maintaining a
 * second list. No component here owns a shortcut; see web/src/keys for why that is
 * architecture rather than tidiness.
 *
 * **Selection has to survive the list changing underneath it.** Deltas arrive while the user
 * is holding shift: rows appear, move between groups and vanish. The selection is held by id
 * and reconciled against the current order on every render — see hooks/useSelection, where
 * that is the whole subject.
 *
 * On accessibility: the scroller is a multi-selectable listbox and each row is an option
 * naming its own status, so a screen-reader user hears "ENG-14, Fix the flake, In Progress,
 * Ada Lovelace" without needing to have landed on a group header. The status headers are
 * therefore hidden from assistive technology rather than announced twice — they are a visual
 * grouping over rows that already say where they are, and a listbox flattened for
 * virtualisation cannot express real `role="group"` nesting without giving up the flat
 * absolute positioning that makes it fast.
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useVirtualizer } from '@tanstack/react-virtual';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext, useKeymap } from '~/app/keymap';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Menu,
  PriorityIcon,
  StateIcon,
  Tooltip,
} from '~/components';
import { copyText, gitBranchNameFor } from '~/features/github/copy';
import { issueIdsForAdhocList } from '~/features/issue/adhocList';
import {
  archiveIssues,
  deleteIssues,
  reorderIssue,
  report,
  setSubscribed,
  unarchiveIssues,
  updateIssueProperties,
  updateIssues,
  type ReorderTarget,
} from '~/features/issue/mutations';
import { RESTORE_WINDOW_DAYS, restoreIssue } from '~/features/trash/mutations';
import { offerUndo } from '~/features/undo/UndoToast';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { liveIssueCountForTeam } from '~/features/team/issueLimit';
import { TeamIssueLimitBanner } from '~/features/team/TeamIssueLimitBanner';
import { issueIdsForLabelView, labelViewTitle, userViewPath } from '~/features/labels/labelView';
import { setViewSubscription, updateView } from '~/features/view/mutations';
import { SaveViewModal } from '~/features/view/SaveViewModal';
import {
  downloadCsv,
  exportCap,
  exportCapNote,
  issuesToCsv,
  type ExportRole,
} from '~/features/export/csv';
import { personName, subscribePrefs, getPrefs } from '~/features/prefs/prefs';
import { useViewer, useViewerId } from '~/hooks/useViewer';
import { AssigneePicker, PriorityPicker, StatusPicker } from '~/features/issue/pickers';
import { DueDatePicker, EstimatePicker } from '~/features/issue/properties';
import { estimatesEnabled, issueEstimateLabel } from '~/features/estimate';
import { applyLabel, removeLabel } from '~/features/labels/mutations';
import { LabelList } from '~/features/labels/LabelList';
import { LabelPicker } from '~/features/labels/LabelPicker';
import { CyclePicker } from '~/features/cycles/CyclePicker';
import { Peek } from '~/features/peek/Peek';
import { ProjectPicker } from '~/features/projects/ProjectPicker';
import { DuplicatePicker } from '~/features/triage/DuplicatePicker';
import {
  acceptTriageIssues,
  declineTriageIssues,
  markIssuesDuplicate,
  requiresPriorityToLeave,
  snoozeIssues,
} from '~/features/triage/mutations';
import { snoozeItems } from '~/features/triage/snooze';
import { isSnoozed, useTriageClock } from '~/features/triage/wake';
import { InsightsPanel } from '~/features/insights/InsightsPanel';
import { Board } from '~/features/view/ui/Board';
import { DisplayMenu } from '~/features/view/ui/DisplayMenu';
import { FilterBar } from '~/features/view/ui/FilterBar';
import {
  displayOverrides,
  displaySignature,
  useView,
  type ViewGroup,
} from '~/features/view/ui/useView';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useSelection } from '~/hooks/useSelection';
import { browserTimezone } from '~/features/locale';
import { isOverdue, whenDay } from '~/features/time';
import {
  EMPTY_FILTER,
  isFilterGroup,
  parseDisplayParams,
  toFilterParam,
  type DisplayProperty,
  type FilterNode,
} from '~/filter';
import type { DateOnly, DueDateSource, Issue, StateCategory, Store, UUID } from '~/store';
import styles from './IssueList.module.css';

/**
 * A group heading.
 *
 * It carries the group's *name* rather than a resolved status, because the grouping is a
 * display option now and only one of its seven values is a status. `stateId` is set for that
 * one, and is what lets the heading keep its icon without every other grouping pretending to
 * have one.
 */
interface HeaderRow {
  readonly kind: 'header';
  readonly key: string;
  /** The group this heading is of, which is also what the collapse state is keyed by. */
  readonly groupKey: string;
  readonly name: string;
  readonly count: number;
  readonly stateId: UUID | undefined;
  readonly collapsed: boolean;
}

/**
 * One issue, by id and the group it is being listed in. Everything drawn in it is read by
 * the row itself.
 *
 * The group key is not decoration. Grouping by label puts one issue in a group per label it
 * carries — deliberately, see `groupIssues` — so the id alone identifies neither the row nor
 * the element: two rows shared a virtualiser key and two elements shared a DOM id, which is
 * what `aria-activedescendant` then resolved ambiguously and what made the keyboard cursor
 * unable to leave the first copy.
 */
interface IssueRowRef {
  readonly kind: 'issue';
  readonly key: string;
  readonly groupKey: string;
  readonly id: UUID;
}

type ListRow = HeaderRow | IssueRowRef;

/**
 * What the list is of.
 *
 * The screen is parameterised rather than copied because "My Issues" is the same list with
 * a different source: the same virtualiser, the same selection model, the same eleven
 * registered actions, the same bulk pickers. A second copy of all of that would be the
 * place where a shortcut gets fixed in one list and not the other, and nobody would notice
 * for a month.
 */
export type IssueListSource =
  | { readonly kind: 'team' }
  | {
      readonly kind: 'assignee';
      readonly userId: UUID;
      /** Completed work is off by default: "my issues" means the ones still asking for something. */
      readonly includeCompleted?: boolean | undefined;
    }
  | {
      readonly kind: 'project';
      readonly projectId: UUID;
    }
  | {
      readonly kind: 'cycle';
      readonly cycleId: UUID;
    }
  | {
      /**
       * Every issue carrying one label, or every child of a label group.
       *
       * A group is never applied to an issue, so its view is the union of the labels under
       * it. Team labels only exist on that team's issues; a workspace label spans teams.
       */
      readonly kind: 'label';
      readonly labelId: UUID;
    }
  | {
      /**
       * The team's triage inbox.
       *
       * A status category, not a saved view: the source names `stateCategory` so the
       * grammar's default hide turns off, and the layout stays a list so `H` can snooze.
       */
      readonly kind: 'triage';
      readonly teamId: UUID;
    }
  | {
      /**
       * A saved view.
       *
       * The view supplies the heading and the scope; the filter itself is *not* read from it
       * here. `SavedView` seeds the URL from the saved filter on arrival and this screen then
       * reads the URL like every other one — so a saved view can be refined in the filter bar,
       * shared as the refined link, and saved back, all without a second code path.
       */
      readonly kind: 'view';
      readonly viewId: UUID;
    }
  | {
      /**
       * Identifiers named in the URL, in that order.
       *
       * Not a view and not a filter: the path *is* the set. Tokens that do not resolve in
       * this replica are omitted rather than erroring, so a link from last week still
       * opens the issues that still exist.
       */
      readonly kind: 'adhoc';
      readonly identifiers: readonly string[];
    };

export interface IssueListProps {
  /** Defaults to the team named in the route. */
  readonly source?: IssueListSource | undefined;
  /** The heading, for a source that is not a team and so has no name of its own. */
  readonly heading?: string | undefined;
  /**
   * Told whenever the keyboard cursor lands on a different issue.
   *
   * For a screen that puts this list beside something showing the cursor row — the triage
   * queue and its preview pane. It is deliberately one-way: the cursor is this list's, held
   * by the same resolver that survives deltas, and a parent that could also *set* it would
   * be a second answer to where the keyboard is.
   */
  readonly onCursorChange?: ((id: UUID | null) => void) | undefined;
}

/**
 * What the list is over, resolved from the route.
 *
 * Separate from the view because it changes for different reasons and at a different rate: a
 * team's name and timezone move when somebody edits the team, not when an issue is dragged.
 * Keeping them apart means renaming a team does not re-run the filter over five thousand
 * issues, and moving an issue does not re-resolve the team.
 */
interface ListScope {
  /**
   * The heading, or null when the source does not exist.
   *
   * Null is specifically "there is nothing to show this for" — a team key that matches no
   * team — and not "this view is empty". An empty team still has a name and still renders
   * its statuses, which is the difference between a list with nothing in it and a broken
   * link.
   */
  readonly heading: string | null;
  /** Set only for a team's list, which is the only one with team settings to link to. */
  readonly team: { readonly id: UUID; readonly key: string; readonly name: string } | null;
  /**
   * The zone the view reckons relative dates in.
   *
   * The team's, not the reader's, so two people looking at one board agree about what is
   * overdue. A list with no team — one person's work across teams — has no single answer, so
   * it falls back to the reader's own zone and says as much by doing nothing clever.
   */
  readonly timezone: string;
}

/** The default, and a module constant so an inline object does not defeat the query cache. */
const TEAM_SOURCE: IssueListSource = { kind: 'team' };

/** Names the category so the grammar's default hide of triage turns off. */
const TRIAGE_SOURCE_FILTER: FilterNode = { field: 'stateCategory', op: 'eq', values: ['triage'] };

/**
 * The virtualiser's opening guess at a row's height, in pixels.
 *
 * A number rather than `var(--row-height)` because a scroll offset is arithmetic, not
 * styling — and it is only a guess: every rendered row is measured, so being wrong costs one
 * frame of slightly mis-sized scrollbar and nothing else.
 */
const ESTIMATED_ROW_PX = 32;
/*
 * 28 and not 36. A group heading is `.group`, which is --control-height-md and has no padding
 * of its own, so the old guess over-reported every unmeasured heading by eight pixels — in a
 * team grouped by status that is the scroll range being wrong by a heading's worth per group
 * until the user scrolls far enough for each one to be measured. Keep this in step with
 * `.group` in IssueList.module.css.
 */
const ESTIMATED_HEADER_PX = 28;

/** Rows kept mounted beyond the viewport, so a held-down `J` never outruns the renderer. */
const OVERSCAN = 12;

/** A Space tap keeps Peek; a hold longer than this puts it away on release. */
const PEEK_HOLD_MS = 280;

/** What the registered actions call. Named so the ref's type is a contract, not an inference. */
interface ListCommands {
  move(delta: number): void;
  extend(delta: number): void;
  toggle(): void;
  selectAll(): void;
  clearSelection(): void;
  hasSelection(): boolean;
  hasRows(): boolean;
  open(): void;
  askArchive(): void;
  askDelete(): void;
  reorder(delta: number): void;
  reorderToEnd(delta: number): void;
  canReorder(): boolean;
  collapseGroup(): void;
  exportCsv(): void;
  pickStatus(): void;
  pickAssignee(): void;
  pickPriority(): void;
  pickProject(): void;
  pickCycle(): void;
  pickLabels(): void;
  pickEstimate(): void;
  pickDue(): void;
  assignToMe(): void;
  toggleSubscribe(): void;
  peekOpen(): boolean;
  pressPeek(): void;
  togglePeek(): void;
  releasePeek(): void;
  closePeek(): void;
  acceptTriage(): void;
  declineTriage(): void;
  pickDuplicate(): void;
  pickSnooze(): void;
  inTriage(): boolean;
  copyGitBranch(): void;
  copyIssueLink(): void;
  copyIssueId(): void;
  insightsOpen(): boolean;
  toggleInsights(): void;
  saveView(): void;
  copyViewLink(): void;
  openDisplay(): void;
  toggleLayout(): void;
  canBoard(): boolean;
  canCollapse(): boolean;
}

export function IssueList({ source = TEAM_SOURCE, heading, onCursorChange }: IssueListProps = {}) {
  const { teamKey = '' } = useParams<{ teamKey: string }>();
  const navigate = useNavigate();
  const engine = useEngine();
  const viewerId = useViewerId();
  const viewer = useViewer();
  const { registry, context } = useKeymap();

  // The source is part of the query's identity, so a change of assignee re-runs the
  // selector. Serialised rather than passed by reference because a caller writing the
  // object inline creates a new one every render, and the query would never be reused.
  const sourceKey =
    source.kind === 'team'
      ? `team:${teamKey}`
      : source.kind === 'assignee'
        ? `assignee:${source.userId}`
        : source.kind === 'project'
          ? `project:${source.projectId}`
          : source.kind === 'cycle'
            ? `cycle:${source.cycleId}`
            : source.kind === 'triage'
              ? `triage:${source.teamId}`
              : source.kind === 'label'
                ? `label:${source.labelId}`
                : source.kind === 'adhoc'
                  ? `adhoc:${source.identifiers.join(',')}`
                  : `view:${source.viewId}`;

  /**
   * What this screen's display options are remembered under, or nothing.
   *
   * The source key already names the screen, so it is reused rather than invented a second
   * time — two spellings of "the ENG issue list" would be two preferences, and the one you
   * set would be the one you did not get.
   *
   * The ad-hoc list is excluded because its key *is* the set of identifiers in its URL: every
   * link somebody opened would leave behind a row that can never apply to anything again, and
   * the identifiers are unbounded where the server's key is not.
   */
  const preferenceKey = source.kind === 'adhoc' ? undefined : sourceKey;
  const includeCompleted = source.kind === 'assignee' && source.includeCompleted === true;
  const inTriage = source.kind === 'triage';
  const [searchParams] = useSearchParams();
  const showSnoozed = inTriage && parseDisplayParams(searchParams).showSnoozed === true;
  const viewId = source.kind === 'view' ? source.viewId : null;

  const scope = useLiveQuery(
    (store) => scopeOf(store, source, teamKey, heading),
    // `view` too, because a saved view supplies the heading and the team a view-sourced list
    // is scoped to — renaming the view has to move this heading.
    ['team', 'view', 'cycle', 'label', 'user'],
    [sourceKey, heading],
  );

  const watch = useLiveQuery(
    (store) => {
      if (viewId === null || viewerId === null) return null;
      const id = store.viewSubscriptionIdFor(viewerId, viewId);
      return id === undefined ? null : (store.get('viewSubscription', id) ?? null);
    },
    ['viewSubscription'],
    [viewId, viewerId],
  );

  const savedMeta = useLiveQuery(
    (store) => {
      if (viewId === null) return null;
      const row = store.views.get(viewId);
      if (row === undefined) return null;
      return {
        ownerId: row.ownerId,
        teamId: row.teamId,
        display: row.display,
        filter: row.filter,
        // The saved filter as its encoded form, so "has this been departed from" is one
        // string comparison against the bar rather than a structural walk over two trees
        // that would have to be kept in step with the grammar every time it grew.
        filterParam: toFilterParam(row.filter),
        // The saved display as its encoded form too, so "already the default" is one string
        // comparison rather than a field-by-field walk that would have to be kept in step
        // with `DisplayOptions` every time an option is added.
        signature: displaySignature(row.display),
      };
    },
    ['view'],
    [viewId],
  );

  const liveCount = useLiveQuery(
    (store) => {
      const teamId = scope.team?.id;
      if (teamId === undefined) return 0;
      return liveIssueCountForTeam(store, teamId);
    },
    ['issue'],
    [scope.team?.id ?? ''],
  );

  /**
   * Whether estimating is possible anywhere in this list.
   *
   * Not the same question as `canEstimate`, which is about the rows targeted right now and
   * changes with every cursor move — that one decides whether the button is *disabled*, and
   * carries a tooltip saying why. This one decides whether the affordance exists at all,
   * because a team that has turned estimates off has no state in which `⇧E` does anything,
   * and a key that can never work is a key the help overlay should not be teaching. (The
   * overlay lists every registered binding on purpose and cannot filter on `enabled`; see
   * `HelpOverlay`.) The detail rail already draws this line — no estimate row for a team
   * whose scale is `none` — and the list follows it.
   *
   * A cross-team list has no single answer, so it asks whether *any* team could: dropping
   * the shortcut there would take it away from a selection that is in one estimating team,
   * which is a real thing to do from My Issues.
   */
  const estimatesPossible = useLiveQuery(
    (store) => {
      const teamId = scope.team?.id;
      if (teamId === undefined) return [...store.teams.values()].some(estimatesEnabled);
      const team = store.teams.get(teamId);
      return team !== undefined && estimatesEnabled(team);
    },
    ['team'],
    [scope.team?.id ?? ''],
  );

  const now = useTriageClock(scope.team?.id, inTriage);

  /**
   * The filter, the display options and the issues that fall out of them.
   *
   * All of it held in the URL — which is a product requirement rather than an implementation
   * choice, because a filtered list has to be a link somebody can paste into a chat. The
   * screen contributes only the *corpus*: which issues were ever candidates. Everything after
   * that is `useView`, and is the same code the board and the saved views run.
   */
  const view = useView({
    issues: (store) => corpusOf(store, source, scope.team?.id, includeCompleted, now, showSnoozed),
    inputs: [sourceKey, scope.team?.id ?? '', includeCompleted, now, showSnoozed],
    timezone: scope.timezone,
    now: inTriage ? now : undefined,
    sourceFilter: inTriage ? TRIAGE_SOURCE_FILTER : undefined,
    teamId: scope.team?.id,
    preferenceKey,
    defaultDisplay: savedMeta?.display,
  });

  /**
   * The optional properties every row draws, resolved once for the whole list.
   *
   * Built here rather than in the row for the reason the board builds it in the column: a
   * `Set` made inside a memoised row is a new reference on every render of the parent, which
   * would defeat the memo on all thirty mounted rows for a scroll that changed nothing.
   */
  const rowProperties = useMemo(
    () => new Set<DisplayProperty>(view.display.properties),
    [view.display.properties],
  );

  /**
   * Saves what is on screen as the view's own display options.
   *
   * The one "default" on this screen that is not merely personal: `View.display` is what
   * `SavedView` seeds the URL from, so it is what *everybody* who opens the view gets. Every
   * control in the display menu already remembers itself for the person using it, which is
   * why this button is about other people or it is about nothing.
   *
   * Undefined — and so not drawn — on the screens that are routes rather than rows. A team's
   * issue list, My Issues and a project's issues have nowhere shared to write it: the only
   * store for remembered options is `ViewPreference`, which is unique per person by
   * construction. A button there would promise a workspace default the schema cannot keep.
   */
  const setViewDefault = useMemo(
    () =>
      viewId === null || viewer === null || viewer.role === 'guest'
        ? undefined
        : () => {
            void updateView(engine, viewId, {
              display: displayOverrides(view.display),
            }).catch(report);
          },
    [engine, viewId, viewer, view.display],
  );

  const groups = view.groups;

  /**
   * Which groups are shut, per screen, remembered across visits.
   *
   * In `localStorage` rather than in `DisplayOptions`, and that is a deliberate line rather
   * than a shortcut. Everything in the display options is *shared*: it rides in the URL so a
   * filtered view is a link somebody can paste, and it is what a saved view hands the next
   * reader. A collapsed group is neither — it is where one person has folded away work they
   * are not looking at this afternoon, and putting it in the URL would mean sending a
   * colleague a link that opens with half the board hidden and no hint why.
   *
   * Keyed by the same `preferenceKey` the remembered display options use, so "the ENG issue
   * list" and "my issues" fold independently, and so the ad-hoc list — whose key is the
   * identifiers in its own URL — remembers nothing at all.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() =>
    readCollapsed(preferenceKey),
  );
  const toggleGroup = useCallback(
    (key: string) => {
      setCollapsed((current) => {
        const next = new Set(current);
        if (!next.delete(key)) next.add(key);
        writeCollapsed(preferenceKey, next);
        return next;
      });
    },
    [preferenceKey],
  );

  const rows = useMemo(() => rowsOf(groups, collapsed), [groups, collapsed]);

  // Derived outside the selector on purpose: the store compares a subscription's result
  // structurally, and a Map has no enumerable own properties — two different maps would
  // compare equal and the list would stop updating.
  const ids = useMemo(
    () => rows.filter((row): row is IssueRowRef => row.kind === 'issue').map((row) => row.id),
    [rows],
  );
  /**
   * The issues in the view, each named once.
   *
   * Grouping by label lists an issue once per label it carries, so the flat order above is
   * not a set. Everything that acts on *issues* rather than on rows — the insights panel,
   * the CSV export, every bulk mutation — takes this one, because firing three mutations for
   * one issue because it wears three labels is not a bulk edit, it is a bug with a count.
   */
  const uniqueIds = useMemo(() => [...new Set(ids)], [ids]);

  /** Rows that are issues, by their index in `rows` — what J and K actually step through. */
  const issueRows = useMemo(
    () => rows.flatMap((row, at) => (row.kind === 'issue' ? [at] : [])),
    [rows],
  );

  const selection = useSelection(ids);
  /**
   * Where the keyboard is: a row, not an issue.
   *
   * Both halves are needed and neither is enough. The id alone cannot say *which* copy of a
   * duplicated issue the cursor is on — grouping by label lists one issue in a group per
   * label — so `ids.indexOf` always answered with the first, and standing on the second copy
   * and pressing J stepped from the first one's position and teleported to the top. The row
   * index alone cannot survive a delta that inserts a row above, which is the ordinary case
   * this list is built for. Held together, each covers the other's blind spot.
   */
  const [cursor, setCursor] = useState<{ rowIndex: number; id: UUID } | null>(null);

  /**
   * Where the keyboard is, resolved against the list as it stands.
   *
   * Three answers in order of confidence. The row it was on, if that row is still that
   * issue — the ordinary case, and the only one that distinguishes two copies of one issue.
   * Failing that the same issue wherever the deltas have moved it to, which is what keeps the
   * cursor under the row somebody is looking at when the list reorders around them. Failing
   * *that* the issue has actually gone, and the answer is the next row down rather than the
   * top of the list: archiving or deleting takes the row out of the replica optimistically,
   * and a cursor that jumped to row one on every such write meant pressing the key twice
   * acted on the row you meant and then on the first row of the whole list.
   */
  const { cursorId, cursorRow, cursorGroupKey } = useMemo(() => {
    const issueAt = (at: number): IssueRowRef | null => {
      const row = rows[at];
      return row !== undefined && row.kind === 'issue' ? row : null;
    };
    const found = (at: number, row: IssueRowRef) => ({
      cursorId: row.id,
      cursorRow: at,
      cursorGroupKey: row.groupKey,
    });

    if (cursor !== null) {
      const held = issueAt(cursor.rowIndex);
      if (held !== null && held.id === cursor.id) return found(cursor.rowIndex, held);

      const moved = issueRows.find((at) => issueAt(at)?.id === cursor.id);
      if (moved !== undefined) {
        const row = issueAt(moved);
        if (row !== null) return found(moved, row);
      }

      const next = issueRows.find((at) => at >= cursor.rowIndex) ?? issueRows.at(-1);
      if (next !== undefined) {
        const row = issueAt(next);
        if (row !== null) return found(next, row);
      }
    }

    const first = issueRows[0];
    const row = first === undefined ? null : issueAt(first);
    if (first === undefined || row === null) {
      return { cursorId: null, cursorRow: -1, cursorGroupKey: '' };
    }
    return found(first, row);
  }, [cursor, rows, issueRows]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      rows[index]?.kind === 'header' ? ESTIMATED_HEADER_PX : ESTIMATED_ROW_PX,
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: OVERSCAN,
  });

  const status = useMenuTrigger();
  const assignee = useMenuTrigger();
  const priority = useMenuTrigger();
  const project = useMenuTrigger();
  const cycle = useMenuTrigger();
  const labelMenu = useMenuTrigger();
  const estimate = useMenuTrigger();
  const due = useMenuTrigger();
  const display = useMenuTrigger();
  const subscribe = useMenuTrigger();
  const share = useMenuTrigger();
  const duplicate = useMenuTrigger();
  const snooze = useMenuTrigger();
  /**
   * Where a right-click landed, and the row it landed on.
   *
   * The anchor is a real element placed at the pointer rather than the row itself, because
   * `Menu` positions against its trigger *and* returns focus to it, and a row is neither
   * focusable nor where a context menu should open. The list's scroller is refocused on
   * close, which is where a keyboard user was and where `aria-activedescendant` lives — the
   * failure this avoids is the one the inbox's hidden trigger has, where focus falls to
   * `<body>` and the reader drops out of the list entirely.
   */
  const [contextAt, setContextAt] = useState<{ x: number; y: number } | null>(null);
  const contextAnchor = useRef<HTMLDivElement>(null);
  const [peekOpen, setPeekOpen] = useState(false);
  const peekOpenRef = useRef(false);
  const peekHoldAt = useRef<number | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const insightsOpenRef = useRef(false);
  const [saveOpen, setSaveOpen] = useState(false);
  /**
   * The rows a confirmed delete would take, captured when the dialogue opens.
   *
   * Held rather than re-read from `targets` on confirmation, because the two are not the same
   * set at the two moments. Opening the dialogue moves focus into it, a delta from another
   * session can land while it is open, and the cursor fallback means an empty selection makes
   * `targets` whatever row the keyboard happens to be on. The list the user was shown the
   * count and the identifiers of is the list that gets deleted.
   */
  const [pendingDelete, setPendingDelete] = useState<readonly UUID[] | null>(null);
  /** The same bargain as `pendingDelete`, for the archive that now asks before it hides work. */
  const [pendingArchive, setPendingArchive] = useState<readonly UUID[] | null>(null);

  /**
   * What the last export left out, or null.
   *
   * Kept on the screen rather than shown as a toast, and not cleared on the next store
   * delta, because it is the only record that the file in the downloads folder is a
   * fragment. A notice about a file the user is about to open in a spreadsheet has to
   * outlive the three seconds a toast lasts; it goes when they export again or leave.
   */
  const [exportNote, setExportNote] = useState<string | null>(null);

  const setInsights = (open: boolean) => {
    insightsOpenRef.current = open;
    setInsightsOpen(open);
  };

  const setPeek = (open: boolean) => {
    peekOpenRef.current = open;
    setPeekOpen(open);
  };

  /**
   * What a command acts on: the selection when there is one, the cursor row otherwise.
   *
   * The fallback is what makes the shortcuts usable without ever pressing `X`. Someone
   * arrowing down a list and pressing `S` means "this one", and requiring them to select it
   * first would make the fast path two keystrokes longer than the slow one.
   */
  /*
   * De-duplicated at the source. `selection.ordered` is the flat row order filtered by the
   * selection, and under a label grouping that order names one issue once per label it
   * carries — so `applyLabel`, `removeLabel` and `updateIssueProperties` each fired N times
   * for one issue, and a confirmation offering to delete three rows was offering to delete
   * two issues. A selection is a set of issues; a bulk edit writes each one once.
   */
  const targets = useMemo(
    () => [
      ...new Set(selection.size > 0 ? selection.ordered : cursorId === null ? [] : [cursorId]),
    ],
    [selection.size, selection.ordered, cursorId],
  );
  const excludeFromDuplicate = useMemo(() => new Set(targets), [targets]);

  /**
   * How the board scrolls one of its cards into view, handed up by `Board` while it is
   * mounted.
   *
   * The list's virtualiser cannot do it: its `getScrollElement` is `scrollRef.current`, which
   * is null under the board layout because the list's scroller is not rendered at all. Each
   * board column owns its own virtualiser — that is what makes a column a column — so the
   * board keeps the registry and exposes one function over it, and J and K delegate rather
   * than scrolling a scroller that is not on screen.
   */
  const boardScrollTo = useRef<((id: UUID) => void) | null>(null);
  const registerBoardScroll = useCallback((scrollTo: ((id: UUID) => void) | null) => {
    boardScrollTo.current = scrollTo;
  }, []);

  const scrollToRow = useCallback(
    (rowIndex: number, id: UUID) => {
      const toCard = boardScrollTo.current;
      if (toCard !== null) {
        toCard(id);
        return;
      }
      if (rowIndex >= 0) virtualizer.scrollToIndex(rowIndex, { align: 'auto' });
    },
    [virtualizer],
  );

  /**
   * Every command, rebuilt each render and reached through a ref.
   *
   * The registry captures an action's `run` once, at registration. Re-registering the whole
   * keymap on every cursor move would tear down and rebuild a dozen bindings sixty times a
   * second; reading through a ref keeps the registration stable and the behaviour current.
   */
  const commands = useRef<ListCommands>({
    move: () => {},
    extend: () => {},
    toggle: () => {},
    selectAll: () => {},
    clearSelection: () => {},
    hasSelection: () => false,
    hasRows: () => false,
    open: () => {},
    askArchive: () => {},
    askDelete: () => {},
    reorder: () => {},
    reorderToEnd: () => {},
    canReorder: () => false,
    collapseGroup: () => {},
    exportCsv: () => {},
    pickStatus: () => {},
    pickAssignee: () => {},
    pickPriority: () => {},
    pickProject: () => {},
    pickCycle: () => {},
    pickLabels: () => {},
    pickEstimate: () => {},
    pickDue: () => {},
    assignToMe: () => {},
    toggleSubscribe: () => {},
    peekOpen: () => false,
    pressPeek: () => {},
    togglePeek: () => {},
    releasePeek: () => {},
    closePeek: () => {},
    acceptTriage: () => {},
    declineTriage: () => {},
    pickDuplicate: () => {},
    pickSnooze: () => {},
    inTriage: () => false,
    copyGitBranch: () => {},
    copyIssueLink: () => {},
    copyIssueId: () => {},
    insightsOpen: () => false,
    toggleInsights: () => {},
    saveView: () => {},
    copyViewLink: () => {},
    openDisplay: () => {},
    toggleLayout: () => {},
    canBoard: () => false,
    canCollapse: () => false,
  });

  /** The row `delta` steps away from the one the cursor is on, clamped to the ends. */
  const step = (delta: number): IssueRowRef | null => {
    if (issueRows.length === 0) return null;
    const at = issueRows.indexOf(cursorRow);
    const next =
      issueRows[Math.min(Math.max((at === -1 ? 0 : at) + delta, 0), issueRows.length - 1)];
    if (next === undefined) return null;
    const row = rows[next];
    return row !== undefined && row.kind === 'issue' ? row : null;
  };

  /** Where a moved row lands: the row itself, and the index it is at right now. */
  const land = (row: IssueRowRef) => {
    const at = rows.indexOf(row);
    setCursor({ rowIndex: at, id: row.id });
    scrollToRow(at, row.id);
  };

  commands.current = {
    move: (delta) => {
      const next = step(delta);
      if (next === null) return;
      land(next);
    },
    extend: (delta) => {
      const next = step(delta);
      if (next === null) return;
      // The cursor is the fallback anchor, so the first shift-arrow of a gesture takes the
      // row the user is on as well as the one they are moving to.
      selection.extendTo(next.id, cursorId);
      land(next);
    },
    toggle: () => {
      if (cursorId !== null) selection.toggle(cursorId);
    },
    selectAll: () => selection.selectAll(),
    clearSelection: () => selection.clear(),
    hasSelection: () => selection.size > 0,
    hasRows: () => issueRows.length > 0,
    open: () => {
      if (cursorId === null) return;
      const issue = engine.store.get('issue', cursorId);
      if (issue !== undefined) void navigate(`/issue/${engine.store.identifierOf(issue)}`);
    },
    // Archiving asks first now, and offers the way back. `docs/01-features/02-issues.md`
    // says plainly that there is no manual archive at all; what survives here is the button,
    // because a workspace that has one should not have it hide a fortnight of work on a
    // single click with no confirmation and no undo — which is what a bare `E` did, while
    // the *recoverable* delete beside it got both.
    askArchive: () => {
      if (targets.length === 0) return;
      setPendingArchive(targets);
    },
    // Unlike every other bulk action on this screen, this one asks first. Archiving hides
    // work and `E` puts it back; this starts a thirty-day clock, and doing it to eleven rows
    // because the selection was one row wider than it looked is the mistake worth a dialogue.
    askDelete: () => {
      if (targets.length === 0) return;
      setPendingDelete(targets);
    },
    exportCsv: () => {
      const role: ExportRole = viewer?.role ?? 'member';
      const cap = exportCap(role, 'issues');
      if (cap === 0) return;
      // `uniqueIds` and not `ids`: grouping by label lists an issue once per label it
      // carries, so counting rows towards the cap would spend it twice on one issue and both
      // the file and the note would come out short. The de-duplication used to live here, as
      // the only one on the screen; it is at the source now and everything shares it.
      const unique = uniqueIds;
      const slug = (scope.heading ?? 'issues').toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
      downloadCsv(`${slug || 'issues'}.csv`, issuesToCsv(engine.store, unique.slice(0, cap)));
      setExportNote(exportCapNote(unique.length, cap, 'issues'));
    },
    // Guarded here rather than only on the button, because the button and the `S` shortcut
    // are two doors into the same room: disabling one and not the other is how a keyboard
    // user reaches a state the interface says is unavailable.
    pickStatus: () => {
      if (sameTeam(engine.store, targets)) status.show();
    },
    pickAssignee: assignee.show,
    pickPriority: priority.show,
    pickProject: project.show,
    pickCycle: cycle.show,
    pickLabels: () => {
      if (sameTeam(engine.store, targets) && targets.length > 0) labelMenu.show();
    },
    pickEstimate: () => {
      if (!canEstimate(engine.store, targets)) return;
      estimate.show();
    },
    pickDue: () => {
      if (targets.length === 0 || !sameTeam(engine.store, targets)) return;
      due.show();
    },
    assignToMe: () => {
      if (viewerId === null || targets.length === 0) return;
      updateIssues(engine, targets, { assigneeId: viewerId }).catch(report);
    },
    toggleSubscribe: () => {
      if (viewerId === null || targets.length === 0) return;
      const subscribe = !targets.every((id) => engine.store.subscriberIdsFor(id).has(viewerId));
      for (const id of targets) {
        setSubscribed(engine, { issueId: id, userId: viewerId, subscribed: subscribe }).catch(
          report,
        );
      }
    },
    peekOpen: () => peekOpenRef.current,
    pressPeek: () => {
      if (peekOpenRef.current) {
        setPeek(false);
        peekHoldAt.current = null;
        return;
      }
      setPeek(true);
      peekHoldAt.current = Date.now();
    },
    togglePeek: () => setPeek(!peekOpenRef.current),
    releasePeek: () => {
      const at = peekHoldAt.current;
      peekHoldAt.current = null;
      if (at !== null && Date.now() - at >= PEEK_HOLD_MS) setPeek(false);
    },
    closePeek: () => {
      peekHoldAt.current = null;
      setPeek(false);
    },
    acceptTriage: () => {
      if (targets.length === 0) return;
      if (requiresPriorityToLeave(engine, targets)) {
        priority.show();
        return;
      }
      acceptTriageIssues(engine, targets).catch(report);
    },
    declineTriage: () => {
      if (targets.length === 0) return;
      if (requiresPriorityToLeave(engine, targets)) {
        priority.show();
        return;
      }
      declineTriageIssues(engine, targets).catch(report);
    },
    pickDuplicate: () => {
      if (targets.length === 0) return;
      if (requiresPriorityToLeave(engine, targets)) {
        priority.show();
        return;
      }
      duplicate.show();
    },
    pickSnooze: () => {
      if (targets.length === 0) return;
      snooze.show();
    },
    /**
     * Steps the targeted issues one place through the manual order.
     *
     * Only under No grouping with Manual ordering, which is the one arrangement where "one
     * place up" names something: with the rows grouped, the row above may be in another
     * group, and a `sortOrder` that put it there would be a move the user did not ask for.
     * `docs/01-features/09-views-filters-layouts.md` is explicit that manual order is
     * workspace-global, which is why nothing here is scoped to the view.
     */
    reorder: (delta) => {
      const moved = reorderPlan(uniqueIds, targets, delta);
      if (moved === null) return;
      reorderIssue(engine, moved.id, moved.target).catch(report);
    },
    reorderToEnd: (delta) => {
      const moved = reorderPlan(uniqueIds, targets, delta * uniqueIds.length);
      if (moved === null) return;
      reorderIssue(engine, moved.id, moved.target).catch(report);
    },
    // Not on the board: `board.moveToTopOfColumn` owns `⌥⇧↑` there, and a column's top is a
    // different place from the list's. Both are guarded, which is what lets them share the
    // chord at all — the registry refuses two unguarded bindings on one key in one context.
    canReorder: () =>
      view.display.layout !== 'board' &&
      view.display.groupBy === 'none' &&
      view.display.orderBy === 'manual' &&
      targets.length === 1,
    collapseGroup: () => {
      if (cursorGroupKey !== '') toggleGroup(cursorGroupKey);
    },
    inTriage: () => inTriage,
    copyGitBranch: () => {
      if (cursorId === null) return;
      const row = engine.store.get('issue', cursorId);
      if (row === undefined) return;
      void copyText(gitBranchNameFor(engine.store, row, viewer?.displayName ?? ''));
    },
    copyIssueLink: () => {
      const identifier = identifierOf(engine.store, cursorId);
      if (identifier !== null) void copyText(`${window.location.origin}/issue/${identifier}`);
    },
    copyIssueId: () => {
      const identifier = identifierOf(engine.store, cursorId);
      if (identifier !== null) void copyText(identifier);
    },
    insightsOpen: () => insightsOpenRef.current,
    toggleInsights: () => setInsights(!insightsOpenRef.current),
    saveView: () => setSaveOpen(true),
    copyViewLink: () => {
      void copyText(window.location.href);
    },
    openDisplay: () => display.show(),
    // The patch is a function rather than a value, so the layout is read when the chord
    // fires rather than when the render that registered it ran. Closing over `view.display`
    // was already wrong once — it made the chord set a layout instead of toggling one — and
    // reading it here was only half the fix: a render's `view` is still a frame old, so two
    // presses inside one frame both saw `list` and both wrote `board`.
    toggleLayout: () =>
      view.setDisplay((current) => ({ layout: current.layout === 'board' ? 'list' : 'board' })),
    canBoard: () => !inTriage,
    canCollapse: () => view.display.groupBy !== 'none',
  };

  /**
   * Deletes what the dialogue named, and says how to get it back.
   *
   * The identifiers are read before the write, because a moment later they are not readable:
   * the optimistic patch takes the rows out of the replica, so a label built afterwards would
   * say "Deleted 3 issues" and mean nothing anybody could check.
   *
   * The undo restores all of them at once, and settles rather than races: each restore is its
   * own idempotent mutation with its own opId, so one being refused says nothing about the
   * rest and must not abandon them — `Promise.all` would report the first failure while the
   * others were still in flight and nobody was watching. The first reason is rethrown
   * afterwards so `report` still learns that something went wrong. This mirrors `all` in
   * features/issue/mutations, which the delete on the way out already goes through.
   */
  const confirmDelete = (ids: readonly UUID[]) => {
    setPendingDelete(null);
    if (ids.length === 0) return;

    const identifiers = ids.flatMap((id) => {
      const issue = engine.store.get('issue', id);
      return issue === undefined ? [] : [engine.store.identifierOf(issue)];
    });

    const only = identifiers.length === 1 ? identifiers[0] : undefined;

    deleteIssues(engine, ids).catch(report);
    selection.clear();
    offerUndo({
      // One issue is named, because that is what the person is thinking of. Several are
      // counted, because a toast listing eleven identifiers is a toast nobody reads — and the
      // number is the thing worth checking before pressing the button.
      label: only === undefined ? `Deleted ${issueCount(ids.length)}` : `Deleted ${only}`,
      undo: async () => {
        const results = await Promise.allSettled(ids.map((id) => restoreIssue(engine, id)));
        const failed = results.find((result) => result.status === 'rejected');
        if (failed !== undefined) throw failed.reason;
      },
    });
  };

  /**
   * Archives what the dialogue named, and offers the way back.
   *
   * The rows themselves are captured, not their ids, and that is the whole of it: an archive
   * is optimistically a *delete* — the server's own change for one — so a moment later the
   * replica no longer holds them and there is nothing left for an undo to restore from.
   * `mutations.ts` states the consequence as "a client cannot un-archive what it no longer
   * holds"; carrying the rows in the closure is what answers it.
   */
  const confirmArchive = (ids: readonly UUID[]) => {
    setPendingArchive(null);
    if (ids.length === 0) return;

    const rows = ids.flatMap((id) => {
      const issue = engine.store.get('issue', id);
      return issue === undefined ? [] : [issue];
    });
    if (rows.length === 0) return;

    const only = rows.length === 1 ? engine.store.identifierOf(rows[0]!) : undefined;

    archiveIssues(engine, ids).catch(report);
    selection.clear();
    offerUndo({
      label: only === undefined ? `Archived ${issueCount(rows.length)}` : `Archived ${only}`,
      undo: () => unarchiveIssues(engine, rows),
    });
  };

  /** The identifier the archive dialogue names, on the same terms as `deleteSubject`. */
  const archiveSubject = useMemo(() => {
    if (pendingArchive === null || pendingArchive.length !== 1) return null;
    const [id] = pendingArchive;
    const issue = id === undefined ? undefined : engine.store.get('issue', id);
    return issue === undefined ? null : engine.store.identifierOf(issue);
  }, [pendingArchive, engine]);

  /**
   * The identifier to name in the confirmation, or null when there is more than one row.
   *
   * Read straight from the store rather than through a live query: the rows are still in the
   * replica while the dialogue is open — nothing has been written yet — and a delta that took
   * one of them away underneath an open confirmation is not something the dialogue's *title*
   * should react to. `confirmDelete` re-reads at the moment of the write.
   */
  const deleteSubject = useMemo(() => {
    if (pendingDelete === null || pendingDelete.length !== 1) return null;
    const [id] = pendingDelete;
    const issue = id === undefined ? undefined : engine.store.get('issue', id);
    return issue === undefined ? null : engine.store.identifierOf(issue);
  }, [pendingDelete, engine]);

  // Reported after the commit rather than from the resolver, so a parent's own state update
  // is never queued during this component's render.
  useEffect(() => {
    onCursorChange?.(cursorId);
  }, [onCursorChange, cursorId]);

  const virtualRows = virtualizer.getVirtualItems();

  /**
   * The heading pinned to the top of the scroller, and why it is drawn rather than stuck.
   *
   * `position: sticky` cannot do this here. Every row is absolutely positioned by the
   * virtualiser — that is the whole basis of the flat, measured layout — and an absolutely
   * positioned element has no normal flow to stick within. So the heading of whichever group
   * the top of the viewport is currently inside is rendered a second time, over the scroller,
   * from the same component with the same collapse control. The rows below scroll under it,
   * which is what the reader was promised.
   */
  const pinned = useMemo(() => {
    const offset = virtualizer.scrollOffset ?? 0;
    // Nothing pinned at rest. The first group's heading is already the first row on screen, so
    // a copy of it drawn over itself would put the same words on the page twice for no gain —
    // the pin earns its place only once the heading it names has scrolled away.
    if (offset <= 0) return null;
    const firstVisible = virtualRows.find((item) => item.start + item.size > offset)?.index;
    if (firstVisible === undefined) return null;
    for (let at = firstVisible; at >= 0; at--) {
      const row = rows[at];
      if (row?.kind === 'header') return at === firstVisible ? null : row;
    }
    return null;
  }, [virtualRows, virtualizer.scrollOffset, rows]);

  useKeyContext('list');

  useActions(
    [
      {
        id: 'issueList.moveDown',
        title: 'Move down',
        keys: ['j', 'ArrowDown'],
        when: 'list',
        group: 'Navigation',
        // Hidden from the command menu: "Move down" is not something anybody searches for,
        // and it still appears in the help overlay, which is where it belongs.
        hidden: true,
        run: () => commands.current.move(1),
      },
      {
        id: 'issueList.moveUp',
        title: 'Move up',
        keys: ['k', 'ArrowUp'],
        when: 'list',
        group: 'Navigation',
        hidden: true,
        run: () => commands.current.move(-1),
      },
      {
        id: 'issueList.extendDown',
        title: 'Extend selection down',
        keys: ['shift+ArrowDown'],
        when: 'list',
        group: 'Selection',
        run: () => commands.current.extend(1),
      },
      {
        id: 'issueList.extendUp',
        title: 'Extend selection up',
        keys: ['shift+ArrowUp'],
        when: 'list',
        group: 'Selection',
        run: () => commands.current.extend(-1),
      },
      {
        id: 'issueList.toggleSelected',
        title: 'Select issue',
        keys: ['x'],
        when: 'list',
        group: 'Selection',
        run: () => commands.current.toggle(),
      },
      {
        id: 'issueList.selectAll',
        title: 'Select all issues',
        keys: ['mod+a'],
        when: 'list',
        group: 'Selection',
        run: () => commands.current.selectAll(),
      },
      {
        id: 'issueList.clearSelection',
        title: 'Clear selection',
        keys: ['Escape'],
        when: 'list',
        group: 'Selection',
        hidden: true,
        // Disabled is treated as unbound, so with nothing selected Escape falls through to
        // the shell's dismiss instead of being swallowed by a command with nothing to do.
        enabled: () => commands.current.hasSelection() && !commands.current.peekOpen(),
        run: () => commands.current.clearSelection(),
      },
      {
        id: 'issueList.peek',
        title: 'Peek issue',
        keys: ['space'],
        when: 'list',
        group: 'Issues',
        ignoreRepeat: true,
        enabled: () => commands.current.hasRows(),
        run: (ctx) => {
          if (ctx.source === 'key') commands.current.pressPeek();
          else commands.current.togglePeek();
        },
        keyup: () => commands.current.releasePeek(),
      },
      {
        id: 'issueList.peek.close',
        title: 'Close peek',
        keys: ['Escape'],
        when: 'list',
        group: 'Issues',
        hidden: true,
        enabled: () => commands.current.peekOpen(),
        run: () => commands.current.closePeek(),
      },
      {
        id: 'issueList.open',
        title: 'Open issue',
        keys: ['Enter'],
        when: 'list',
        group: 'Issues',
        run: () => commands.current.open(),
      },
      {
        id: 'issueList.status',
        title: 'Change status',
        keys: ['s'],
        when: 'list',
        group: 'Issues',
        run: () => commands.current.pickStatus(),
      },
      {
        id: 'issueList.assign',
        title: 'Assign to…',
        keys: ['a'],
        when: 'list',
        group: 'Issues',
        run: () => commands.current.pickAssignee(),
      },
      {
        id: 'issueList.priority',
        title: 'Set priority',
        keys: ['p'],
        when: 'list',
        group: 'Issues',
        run: () => commands.current.pickPriority(),
      },
      {
        id: 'issueList.project',
        title: 'Set project',
        keys: ['shift+p'],
        when: 'list',
        group: 'Issues',
        run: () => commands.current.pickProject(),
      },
      {
        id: 'issueList.cycle',
        title: 'Set cycle',
        keys: ['shift+c'],
        when: 'list',
        group: 'Issues',
        run: () => commands.current.pickCycle(),
      },
      {
        id: 'issueList.labels',
        title: 'Add label',
        keys: ['l'],
        when: 'list',
        group: 'Issues',
        run: () => commands.current.pickLabels(),
      },
      {
        id: 'issueList.assignToMe',
        title: 'Assign to me',
        keys: ['i'],
        when: 'list',
        group: 'Issues',
        enabled: () => viewerId !== null && commands.current.hasRows(),
        run: () => commands.current.assignToMe(),
      },
      // Only where a selection in this list could ever be estimated. See `estimatesPossible`.
      ...(estimatesPossible
        ? [
            {
              id: 'issueList.estimate',
              title: 'Set estimate',
              keys: ['shift+e'],
              when: 'list' as const,
              group: 'Issues',
              run: () => commands.current.pickEstimate(),
            },
          ]
        : []),
      {
        id: 'issueList.dueDate',
        title: 'Set due date',
        keys: ['shift+d'],
        when: 'list',
        group: 'Issues',
        run: () => commands.current.pickDue(),
      },
      {
        id: 'issueList.subscribe',
        title: 'Subscribe',
        keys: ['shift+s'],
        when: 'list',
        group: 'Issues',
        enabled: () => viewerId !== null && commands.current.hasRows(),
        run: () => commands.current.toggleSubscribe(),
      },
      /*
       * The four triage keys, split into the two questions they were asking as one.
       *
       * `inTriage` is a fact about the screen: this list is a triage queue or it is not, and
       * nothing the user does without navigating away can change it. `hasRows` is a fact
       * about this moment. Both leave the key unbound, so the matcher never told them apart
       * — but the help overlay lists every *registered* binding, and asked only whether an
       * action had keys, so an ordinary team list drew a whole "Triage" section teaching
       * `1`, `2`, `3` and `H`. On a default team, where triage is off, there was no screen
       * in the entire workspace on which any of the four could fire.
       *
       * `available` is what the overlay asks. `enabled` stays for the empty queue, because
       * "select a row first" is an answer the sheet should still be able to give.
       */
      {
        id: 'issueList.triageAccept',
        title: 'Accept from triage',
        keys: ['1'],
        when: 'list',
        group: 'Triage',
        available: () => commands.current.inTriage(),
        enabled: () => commands.current.hasRows(),
        run: () => commands.current.acceptTriage(),
      },
      {
        id: 'issueList.triageDuplicate',
        title: 'Mark as duplicate',
        keys: ['2', 'm m'],
        when: 'list',
        group: 'Triage',
        available: () => commands.current.inTriage(),
        enabled: () => commands.current.hasRows(),
        run: () => commands.current.pickDuplicate(),
      },
      {
        id: 'issueList.triageDecline',
        title: 'Decline from triage',
        keys: ['3'],
        when: 'list',
        group: 'Triage',
        available: () => commands.current.inTriage(),
        enabled: () => commands.current.hasRows(),
        run: () => commands.current.declineTriage(),
      },
      {
        id: 'issueList.triageSnooze',
        title: 'Snooze triage issue',
        keys: ['h'],
        when: 'list',
        group: 'Triage',
        available: () => commands.current.inTriage(),
        enabled: () => commands.current.hasRows(),
        run: () => commands.current.pickSnooze(),
      },
      /*
       * Archive keeps its command and loses its key.
       *
       * `docs/01-features/02-issues.md`: "Inline edit by clicking title/description; `E`
       * enters edit mode", and separately "**There is no manual archive.**" So `E` was bound
       * to the one destructive action on this screen that had neither a confirmation nor an
       * undo, on the letter the product documents for something else entirely — while
       * `⌘⌫`, which only files an issue in a bin it can be pulled out of for thirty days,
       * asks twice. It is reachable from the command menu and from the button, both of
       * which now go through the dialogue.
       */
      {
        id: 'issueList.archive',
        title: 'Archive issue',
        when: 'list',
        group: 'Issues',
        enabled: () => commands.current.hasRows(),
        run: () => commands.current.askArchive(),
      },
      {
        id: 'issueList.collapseGroup',
        title: 'Collapse group',
        keys: ['t'],
        when: 'list',
        group: 'Views',
        // Only where there are groups to fold. Under "No grouping" the single group holds
        // the whole view, and collapsing it would empty the screen with no heading left
        // saying what happened.
        available: () => commands.current.canCollapse(),
        run: () => commands.current.collapseGroup(),
      },
      /*
       * Manual reordering, and the four of them are `available` rather than `enabled`.
       *
       * They only mean anything under No grouping with Manual ordering — with the rows
       * grouped, "one place up" may be in another group, and with them ordered by anything
       * else the order is computed and a `sortOrder` write would not move the row at all.
       * The help overlay lists every registered binding and asks `available`, so on a
       * status-grouped list these do not appear at all rather than appearing and doing
       * nothing.
       */
      {
        id: 'issueList.moveIssueUp',
        title: 'Move issue up',
        keys: ['alt+ArrowUp'],
        when: 'list',
        group: 'Issues',
        available: () => commands.current.canReorder(),
        enabled: () => commands.current.canReorder(),
        run: () => commands.current.reorder(-1),
      },
      {
        id: 'issueList.moveIssueDown',
        title: 'Move issue down',
        keys: ['alt+ArrowDown'],
        when: 'list',
        group: 'Issues',
        available: () => commands.current.canReorder(),
        enabled: () => commands.current.canReorder(),
        run: () => commands.current.reorder(1),
      },
      {
        id: 'issueList.moveIssueToTop',
        title: 'Move issue to the top',
        keys: ['alt+shift+ArrowUp'],
        when: 'list',
        group: 'Issues',
        available: () => commands.current.canReorder(),
        enabled: () => commands.current.canReorder(),
        run: () => commands.current.reorderToEnd(-1),
      },
      {
        id: 'issueList.moveIssueToBottom',
        title: 'Move issue to the bottom',
        keys: ['alt+shift+ArrowDown'],
        when: 'list',
        group: 'Issues',
        available: () => commands.current.canReorder(),
        enabled: () => commands.current.canReorder(),
        run: () => commands.current.reorderToEnd(1),
      },
      {
        /**
         * A chord and not a letter, which is the same argument `issueDetail.delete` makes for
         * having no binding at all. On that screen the neighbours are `s`, `a`, `p` and `e`
         * and a single key would be a mis-hit away from an issue nobody can find. Here the
         * action can take a whole selection, so it is worse — and it is also the one the
         * product documents, so it is bound to the chord the documentation names rather than
         * left unreachable. Both keys, because the key labelled Delete on an Apple keyboard
         * reports as Backspace and the one on a PC keyboard does not.
         */
        id: 'issueList.delete',
        title: 'Delete issue',
        keys: ['mod+Backspace', 'mod+Delete'],
        when: 'list',
        group: 'Issues',
        enabled: () => commands.current.hasRows(),
        run: () => commands.current.askDelete(),
      },
      {
        id: 'issue.copyGitBranchName',
        title: 'Copy git branch name',
        keys: ['mod+shift+period'],
        when: 'list',
        group: 'Issues',
        enabled: () => commands.current.hasRows(),
        run: () => commands.current.copyGitBranch(),
      },
      {
        id: 'issueList.exportCsv',
        title: 'Export this view as CSV',
        when: 'list',
        group: 'Issues',
        // Guests cannot export — `docs/01-features/17-admin-security-permissions.md`. The
        // cap below already refuses them, silently, which is the wrong way round: a
        // command offered and then doing nothing reads as a broken product rather than a
        // permission. Lazily evaluated, like `saveView` below, so an unknown role during
        // the bootstrap withdraws nothing permanently.
        enabled: () => viewer !== null && viewer.role !== 'guest',
        run: () => commands.current.exportCsv(),
      },
      {
        id: 'issueList.toggleInsights',
        title: 'Toggle insights',
        keys: ['mod+shift+i'],
        when: 'list',
        group: 'Views',
        run: () => commands.current.toggleInsights(),
      },
      {
        id: 'issueList.saveView',
        title: 'Save as view',
        keys: ['alt+v'],
        when: 'list',
        group: 'Views',
        // A guest cannot save a view on any screen, in any state, ever — so `⌥V` on their
        // keyboard sheet was a promise the product had no way of keeping. An unknown role
        // during the bootstrap withdraws nothing permanently: `available` reads "not a
        // guest", which a null viewer satisfies, and `enabled` holds the key until the
        // session has actually answered.
        available: () => viewer === null || viewer.role !== 'guest',
        enabled: () => viewer !== null,
        run: () => commands.current.saveView(),
      },
      {
        id: 'issueList.copyViewLink',
        title: 'Copy view URL',
        when: 'list',
        group: 'Views',
        run: () => commands.current.copyViewLink(),
      },
      {
        id: 'view.openDisplay',
        title: 'Display options',
        keys: ['shift+v'],
        when: 'list',
        group: 'Views',
        run: () => commands.current.openDisplay(),
      },
      {
        id: 'view.toggleLayout',
        title: 'Toggle list / board layout',
        keys: ['mod+b'],
        when: 'list',
        group: 'Views',
        // Triage is a list because `H` snoozes the row under the cursor and a board has no
        // cursor — so on triage there is no board to toggle to and never will be. This used
        // to be `enabled`, argued as "the chord still reports itself in the help overlay on
        // every screen rather than appearing to be unbound on one of them". That trade is
        // gone now that the sheet can tell the two apart: a row saying ⌘B on the one screen
        // where ⌘B does nothing is not consistency, it is the sheet being wrong.
        available: () => commands.current.canBoard(),
        run: () => commands.current.toggleLayout(),
      },
    ],
    // `estimatesPossible` too, because it decides whether one of these actions is in the list
    // at all: a team turning estimates on has to re-register the keymap, or `⇧E` stays unbound
    // until the screen is remounted.
    [viewerId, estimatesPossible],
  );

  const onOpenRow = useCallback(
    (identifier: string) => navigate(`/issue/${identifier}`),
    [navigate],
  );
  /**
   * Where a pointer put the cursor.
   *
   * The row index comes with the id because a click has to be able to say *which* copy of a
   * duplicated issue was clicked; the board has no rows of its own, so it reports the id
   * alone and the resolver finds it.
   */
  const onFocusRow = useCallback((id: UUID, rowIndex = -1) => setCursor({ rowIndex, id }), []);
  const onToggleRow = useCallback((id: UUID) => selection.toggle(id), [selection]);
  const onExtendRow = useCallback(
    (id: UUID) => selection.extendTo(id, cursorId),
    [selection, cursorId],
  );
  const onToggleGroup = useCallback((key: string) => toggleGroup(key), [toggleGroup]);

  /**
   * Right-click on a row or a card.
   *
   * It moves the cursor first and then opens, so the menu acts on what was clicked: with a
   * selection standing, `targets` is that selection and the menu is the bulk one — right-
   * clicking one of six selected rows means "these six", which is the rule the toolbar and
   * the drag already follow.
   */
  const onRowContextMenu = useCallback(
    (id: UUID, rowIndex: number, x: number, y: number) => {
      onFocusRow(id, rowIndex);
      setContextAt({ x, y });
    },
    [onFocusRow],
  );

  const closeContext = useCallback(() => {
    setContextAt(null);
    // After the menu's own restore, not instead of it: it hands focus back to the anchor,
    // which is about to be unmounted, so the list takes it in the following frame.
    requestAnimationFrame(() => scrollRef.current?.focus());
  }, []);

  if (scope.heading === null) {
    /*
     * Two sources can fail to resolve, and they are not the same miss.
     *
     * `scopeOf` returns a null heading both for a team key nothing matches and for a saved
     * view this replica does not hold — and this said "No such team. Nothing in this
     * workspace has the key ." for the second, with an empty key, because a view-sourced
     * list has no `teamKey` in its route to interpolate. A link to a view in a team you are
     * not in is a normal thing to be sent, and answering it with a sentence about a team,
     * missing the noun, reads as a broken page rather than as a permission.
     */
    const missingView = source.kind === 'view';
    const missingProject = source.kind === 'project';
    const missingCycle = source.kind === 'cycle';
    const missingLabel = source.kind === 'label';
    return (
      <div className={styles.screen}>
        <EmptyState
          title={
            missingView
              ? 'No such view'
              : missingProject
                ? 'No such project'
                : missingCycle
                  ? 'No such cycle'
                  : missingLabel
                    ? 'No such label'
                    : 'No such team'
          }
          description={
            missingView
              ? 'This view has been deleted, or it belongs to a team you are not in. Ask whoever sent you the link to add you to it.'
              : missingProject
                ? 'This project has been deleted, or it belongs to a team you are not in.'
                : missingCycle
                  ? 'This cycle has been removed, or it belongs to a team you are not in.'
                  : missingLabel
                    ? 'This label has been archived, or it belongs to a team you are not in.'
                    : `Nothing in this workspace has the key ${teamKey}.`
          }
        />
      </div>
    );
  }

  const team = scope.team;
  // An empty list means two different things and deserves two different answers: a team with
  // no work yet wants a create button, and a filter that matches nothing wants a way back.
  // Telling somebody their team is empty when they have just typed four clauses is the kind
  // of wrong that makes people distrust the filter rather than fix it.
  const filtered = !isEmptyFilter(view.filter);
  // Only on a saved view, and only once its row is in the replica: a view still arriving has
  // no saved filter to have departed from, and saying so would put a strip on screen that
  // vanishes a frame later.
  const filterChanged = savedMeta !== null && savedMeta.filterParam !== toFilterParam(view.filter);
  const picking =
    status.open ||
    assignee.open ||
    priority.open ||
    project.open ||
    cycle.open ||
    labelMenu.open ||
    estimate.open ||
    due.open ||
    duplicate.open ||
    snooze.open;
  const shared = picking ? sharedProperties(engine.store, targets) : NOTHING_SHARED;
  const canAct = targets.length > 0;
  // Statuses belong to a team, so a selection spanning two of them has no correct set to
  // offer. Disabled with a reason rather than showing one team's statuses for another
  // team's issues, which would silently move an issue to a status its team does not have.
  //
  // Read from the store rather than from `shared`, which is only computed while a picker is
  // open — the first version of this line used it and the button was therefore disabled
  // whenever no menu was showing, which is exactly when somebody would want to press it.
  const canSetStatus = canAct && sameTeam(engine.store, targets);

  // `aria-activedescendant` has to name an element that is actually in the document, and a
  // virtualised list is mostly arithmetic. The cursor is scrolled into view whenever it
  // moves, so this is true in every case but a scroll that has left it behind — where a
  // dangling reference would be reported as an error by some screen readers.
  const cursorRendered = virtualRows.some((item) => item.index === cursorRow);

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{scope.heading}</h1>
        {/* The view's own count, not the row count: grouping by label puts an issue in a
            group per label it carries, on purpose, so summing the groups would report more
            issues than exist. */}
        <Badge>{view.count === 1 ? '1 issue' : `${view.count} issues`}</Badge>
        <div className={styles.spacer} />
        <Tooltip label="Insights" keys="mod+shift+i">
          <Button
            variant="ghost"
            aria-pressed={insightsOpen}
            onClick={() => setInsights(!insightsOpen)}
          >
            Insights
          </Button>
        </Tooltip>
        <Button {...display.props} variant="ghost">
          Display
        </Button>
        {viewId !== null && viewer !== null && viewer.role !== 'guest' ? (
          <Button {...subscribe.props} variant="ghost" aria-pressed={watch !== null}>
            {watch !== null ? 'Subscribed' : 'Subscribe'}
          </Button>
        ) : null}
        {viewId !== null && viewer !== null && viewer.role !== 'guest' ? (
          <Button {...share.props} variant="ghost">
            Share
          </Button>
        ) : null}
        {viewId === null && viewer !== null && viewer.role !== 'guest' && filtered ? (
          <Tooltip label="Save as view" keys="alt+v">
            <Button variant="ghost" onClick={() => setSaveOpen(true)}>
              Save view
            </Button>
          </Tooltip>
        ) : null}
        {/* Only a team has settings to link to. A person's list spans every team they can
            reach, so there is no single one this could point at — and guessing would send
            them to a team they happened to have an issue in. */}
        {team === null ? null : (
          // A link and not a button: it goes somewhere, so it should be announced as a link,
          // open in a new tab on a middle click, and be copyable from a context menu.
          <>
            <Link className={styles.link} to={`/team/${team.key}/projects`}>
              Projects
            </Link>
            <Link className={styles.link} to={`/team/${team.key}/cycles`}>
              Cycles
            </Link>
            <Link className={styles.link} to={`/team/${team.key}/triage`}>
              Triage
            </Link>
            <Link className={styles.link} to={`/team/${team.key}/settings`}>
              Team settings
            </Link>
          </>
        )}
      </header>

      {team === null ? null : <TeamIssueLimitBanner team={team} liveCount={liveCount} />}

      {exportNote === null ? null : (
        <div className={styles.exportNote} role="status">
          <p className={styles.exportNoteCopy}>{exportNote}</p>
          <Button size="sm" variant="ghost" onClick={() => setExportNote(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <FilterBar
        filter={view.filter}
        onChange={view.setFilter}
        teamId={team?.id}
        error={view.error}
        timezone={scope.timezone}
      />

      {/*
       * A saved view that has been refined, and the two ways back.
       *
       * `useSavedFilter` seeds the row's filter into the URL once, on arrival, after which
       * the bar edits it freely — and until now nothing wrote it back and nothing said the
       * view had been departed from. `updateView` has always accepted a filter; the only
       * write-back on this screen sent `display` alone, so a refinement to a saved view was
       * unsaveable and there was no route to the saved filter short of a reload.
       *
       * Gated on non-guest exactly as Save as view is: a guest cannot save a view on any
       * screen, so offering them the button would be a promise the permissions do not keep.
       * Reset is offered to everybody, because it takes nothing away from anyone.
       */}
      {filterChanged ? (
        <div className={styles.viewNote} role="status">
          <p className={styles.viewNoteCopy}>Filter changed</p>
          {viewId !== null && viewer !== null && viewer.role !== 'guest' ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                updateView(engine, viewId, { filter: view.filter }).catch(report);
              }}
            >
              Save
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => view.setFilter(savedMeta?.filter ?? EMPTY_FILTER)}
          >
            Reset
          </Button>
        </div>
      ) : null}

      {insightsOpen ? (
        <InsightsPanel
          issueIds={uniqueIds}
          filter={view.filter}
          onFilter={view.setFilter}
          onClose={() => setInsights(false)}
        />
      ) : null}

      <DisplayMenu
        display={view.display}
        defaults={view.defaults}
        onChange={view.setDisplay}
        open={display.open}
        onClose={display.hide}
        trigger={display.ref}
        triage={inTriage}
        onSetDefault={setViewDefault}
        canSetDefault={savedMeta !== null && savedMeta.signature !== displaySignature(view.display)}
      />

      {viewId !== null && viewer !== null && viewer.role !== 'guest' ? (
        <Menu
          open={subscribe.open}
          onClose={subscribe.hide}
          trigger={subscribe.ref}
          label="View notifications"
          items={[
            { kind: 'heading', label: 'Notify me when' },
            {
              id: 'added',
              label: 'An issue is added',
              selected: watch?.added === true,
              onSelect: () => {
                setViewSubscription(engine, {
                  viewId,
                  userId: viewer.id,
                  added: watch?.added !== true,
                  completed: watch?.completed === true,
                }).catch(report);
              },
            },
            {
              id: 'completed',
              label: 'An issue is completed',
              selected: watch?.completed === true,
              onSelect: () => {
                setViewSubscription(engine, {
                  viewId,
                  userId: viewer.id,
                  added: watch?.added === true,
                  completed: watch?.completed !== true,
                }).catch(report);
              },
            },
          ]}
        />
      ) : null}

      {viewId !== null && viewer !== null && viewer.role !== 'guest' ? (
        <Menu
          open={share.open}
          onClose={share.hide}
          trigger={share.ref}
          label="Share view"
          items={[
            {
              id: 'copy',
              label: 'Copy link',
              onSelect: () => {
                void copyText(window.location.href);
              },
            },
            {
              id: 'privacy',
              label:
                savedMeta?.ownerId !== undefined
                  ? savedMeta.teamId !== undefined
                    ? 'Share with team'
                    : 'Share with workspace'
                  : 'Make private',
              onSelect: () => {
                const makePrivate = savedMeta?.ownerId === undefined;
                updateView(engine, viewId, {
                  private: makePrivate,
                  ownerId: makePrivate ? viewer.id : undefined,
                }).catch(report);
              },
            },
          ]}
        />
      ) : null}

      {saveOpen ? (
        <SaveViewModal
          filter={view.filter}
          display={view.display}
          teamId={scope.team?.id ?? savedMeta?.teamId}
          onClose={() => setSaveOpen(false)}
        />
      ) : null}

      <StatusPicker
        open={status.open}
        onClose={status.hide}
        trigger={status.ref}
        teamId={shared.teamId ?? ''}
        value={shared.stateId}
        onSelect={(stateId) => updateIssues(engine, targets, { stateId }, viewerId).catch(report)}
      />
      <AssigneePicker
        open={assignee.open}
        onClose={assignee.hide}
        trigger={assignee.ref}
        value={shared.assigneeId}
        onSelect={(assigneeId) => updateIssues(engine, targets, { assigneeId }).catch(report)}
      />
      <PriorityPicker
        open={priority.open}
        onClose={priority.hide}
        trigger={priority.ref}
        value={shared.priority}
        onSelect={(priority) => updateIssues(engine, targets, { priority }).catch(report)}
      />
      <ProjectPicker
        open={project.open}
        onClose={project.hide}
        trigger={project.ref}
        teamIds={shared.teamId === undefined ? [] : [shared.teamId]}
        value={shared.projectId}
        onSelect={(projectId) => updateIssues(engine, targets, { projectId }).catch(report)}
      />
      <CyclePicker
        open={cycle.open}
        onClose={cycle.hide}
        trigger={cycle.ref}
        teamId={shared.teamId}
        value={shared.cycleId}
        onSelect={(cycleId) => updateIssues(engine, targets, { cycleId }).catch(report)}
      />
      <LabelPicker
        open={labelMenu.open}
        onClose={labelMenu.hide}
        trigger={labelMenu.ref}
        teamId={shared.teamId ?? null}
        value={shared.labelIds}
        onApply={(labelId, displaced) => {
          for (const id of targets) {
            applyLabel(engine, id, labelId, displaced).catch(report);
          }
        }}
        onRemove={(labelId) => {
          for (const id of targets) {
            removeLabel(engine, id, labelId).catch(report);
          }
        }}
      />
      {shared.teamId !== undefined ? (
        <EstimatePicker
          open={estimate.open}
          onClose={estimate.hide}
          trigger={estimate.ref}
          teamId={shared.teamId}
          value={shared.estimate}
          onSelect={(value) => {
            for (const id of targets) {
              updateIssueProperties(engine, id, { estimate: value }).catch(report);
            }
          }}
        />
      ) : null}
      {shared.teamId !== undefined ? (
        <DueDatePicker
          open={due.open}
          onClose={due.hide}
          trigger={due.ref}
          value={shared.dueDate ?? null}
          source={shared.dueDateSource}
          timezone={shared.timezone}
          onSelect={(value) => {
            for (const id of targets) {
              updateIssueProperties(engine, id, { dueDate: value }).catch(report);
            }
          }}
        />
      ) : null}
      <DuplicatePicker
        open={duplicate.open}
        onClose={duplicate.hide}
        trigger={duplicate.ref}
        teamId={shared.teamId ?? scope.team?.id}
        exclude={excludeFromDuplicate}
        onSelect={(canonicalId) => {
          duplicate.hide();
          markIssuesDuplicate(engine, targets, canonicalId).catch(report);
        }}
      />
      <Menu
        open={snooze.open}
        onClose={snooze.hide}
        trigger={snooze.ref}
        label="Snooze until"
        items={snoozeItems((until) => {
          snooze.hide();
          snoozeIssues(engine, targets, until).catch(report);
        })}
      />

      {contextAt === null ? null : (
        <>
          {/* A one-pixel element at the pointer. Not `hidden`: `Menu` measures its trigger
              to place itself, and a hidden element has no box. */}
          <div
            ref={contextAnchor}
            className={styles.contextAnchor}
            style={{ top: contextAt.y, left: contextAt.x }}
          />
          <Menu
            open
            onClose={closeContext}
            trigger={contextAnchor}
            label={
              targets.length === 1 ? 'Issue actions' : `Actions for ${issueCount(targets.length)}`
            }
            items={[
              {
                id: 'status',
                label: 'Status…',
                disabled: !canSetStatus,
                onSelect: () => {
                  closeContext();
                  status.show();
                },
              },
              {
                id: 'assignee',
                label: 'Assignee…',
                disabled: !canAct,
                onSelect: () => {
                  closeContext();
                  assignee.show();
                },
              },
              {
                id: 'priority',
                label: 'Priority…',
                disabled: !canAct,
                onSelect: () => {
                  closeContext();
                  priority.show();
                },
              },
              {
                id: 'labels',
                label: 'Labels…',
                disabled: !canSetStatus,
                onSelect: () => {
                  closeContext();
                  labelMenu.show();
                },
              },
              { kind: 'separator' },
              {
                id: 'copyLink',
                label: 'Copy link',
                disabled: cursorId === null,
                onSelect: () => {
                  closeContext();
                  commands.current.copyIssueLink();
                },
              },
              {
                id: 'copyId',
                label: 'Copy issue ID',
                disabled: cursorId === null,
                onSelect: () => {
                  closeContext();
                  commands.current.copyIssueId();
                },
              },
              { kind: 'separator' },
              {
                id: 'delete',
                label:
                  targets.length === 1 ? 'Delete issue' : `Delete ${issueCount(targets.length)}`,
                disabled: !canAct,
                onSelect: () => {
                  closeContext();
                  commands.current.askDelete();
                },
              },
            ]}
          />
        </>
      )}

      <ConfirmDialog
        open={pendingArchive !== null}
        title={
          archiveSubject === null
            ? `Archive ${issueCount(pendingArchive?.length ?? 0)}?`
            : `Archive ${archiveSubject}?`
        }
        consequence={
          archiveSubject === null
            ? `${issueCount(pendingArchive?.length ?? 0)} leave every list and board, for everybody. They stay searchable and their links keep working, and they can be brought back from the team's archives — or with the undo this offers for the next few seconds.`
            : `${archiveSubject} leaves every list and board, for everybody. It stays searchable and its links keep working, and it can be brought back from the team's archives — or with the undo this offers for the next few seconds.`
        }
        confirmLabel={
          archiveSubject === null
            ? `Archive ${issueCount(pendingArchive?.length ?? 0)}`
            : `Archive ${archiveSubject}`
        }
        onConfirm={() => confirmArchive(pendingArchive ?? [])}
        onClose={() => setPendingArchive(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={
          deleteSubject === null
            ? `Delete ${issueCount(pendingDelete?.length ?? 0)}?`
            : `Delete ${deleteSubject}?`
        }
        consequence={
          deleteSubject === null
            ? `${issueCount(pendingDelete?.length ?? 0)} leave every list and board, for everybody. They keep their comments and their links, and they can be restored from Trash for the next ${RESTORE_WINDOW_DAYS} days — after that they are gone for good.`
            : `${deleteSubject} leaves every list and board, for everybody. It keeps its comments and its links, and it can be restored from Trash for the next ${RESTORE_WINDOW_DAYS} days — after that it is gone for good.`
        }
        confirmLabel={
          deleteSubject === null
            ? `Delete ${issueCount(pendingDelete?.length ?? 0)}`
            : `Delete ${deleteSubject}`
        }
        destructive
        onConfirm={() => confirmDelete(pendingDelete ?? [])}
        onClose={() => setPendingDelete(null)}
      />

      <div className={styles.body}>
        {/*
         * `view.count` and not `rows.length`: the padding that makes an empty status column
         * information is exactly what hid this. Grouping by status adds a group per status
         * whether or not anything is in it, so `rows` is never empty in a team-scoped view
         * and everything below was unreachable from the default display — five zero-count
         * headers, no explanation, and no way back. Grouping by assignee in the same view
         * showed the message, which is worse than either answer on its own.
         *
         * "Nothing is in review" is a fact somebody wants to see *next to the work that is
         * somewhere*. With nothing in the view at all, every column reads zero, the padding
         * says nothing, and it is displacing the only sentence on the screen that explains
         * what this list is and how to put something in it. The triage inbox is where that
         * bites hardest: its empty state is the one place its accept, decline, merge and
         * snooze keys are ever named, and it is a screen meant to be driven by the keyboard.
         *
         * Why the view is empty changes the words, not whether there are any.
         */}
        {view.count === 0 ? (
          <EmptyState
            className={styles.empty}
            title={
              filtered
                ? 'Nothing matches this filter'
                : source.kind === 'project'
                  ? 'No issues in this project yet'
                  : source.kind === 'cycle'
                    ? 'No issues in this cycle yet'
                    : source.kind === 'triage'
                      ? 'Inbox is clear'
                      : source.kind === 'label'
                        ? 'No issues with this label yet'
                        : source.kind === 'assignee'
                          ? 'Nothing assigned'
                          : source.kind === 'adhoc'
                            ? 'None of these issues are here'
                            : 'No issues in this team yet'
            }
            description={
              filtered
                ? 'Every issue here is excluded by a clause in the filter bar above.'
                : source.kind === 'project'
                  ? 'Press C to file the first one. It will land in this project the moment you save.'
                  : source.kind === 'cycle'
                    ? 'Press C to file the first one. It will land in this cycle the moment you save.'
                    : source.kind === 'triage'
                      ? 'Unreviewed work from outside the team lands here. Press C to file into triage, or 1 / 2 / 3 / H to accept, merge, decline or snooze. MM also marks a duplicate.'
                      : source.kind === 'label' || source.kind === 'assignee'
                        ? 'Issues that pick up this assignment will appear here.'
                        : source.kind === 'adhoc'
                          ? 'They may have been deleted, or they belong to a team you are not in.'
                          : 'Press C to file the first one. It will land here the moment you save.'
            }
            action={
              filtered ? (
                <Button variant="secondary" onClick={() => view.setFilter(EMPTY_FILTER)}>
                  Clear the filter
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => registry.invoke('issue.create', { source: 'menu', context })}
                >
                  Create an issue
                </Button>
              )
            }
          />
        ) : !inTriage && view.display.layout === 'board' ? (
          <Board
            groups={groups}
            display={view.display}
            selected={selection.ids}
            cursorId={cursorId}
            label={`${scope.heading} issues`}
            collapsed={collapsed}
            onOpen={onOpenRow}
            onFocus={onFocusRow}
            onToggle={onToggleRow}
            onExtend={onExtendRow}
            onToggleGroup={onToggleGroup}
            onContextMenu={onRowContextMenu}
            onCreateInColumn={(url) => void navigate(url)}
            onRegisterScrollTo={registerBoardScroll}
          />
        ) : (
          <div className={styles.listPane}>
            {pinned === null ? null : (
              <div className={styles.pinned}>
                <GroupHeader row={pinned} onToggle={onToggleGroup} />
              </div>
            )}
            <div
              ref={scrollRef}
              className={styles.scroller}
              role="listbox"
              aria-multiselectable="true"
              aria-label={`${scope.heading} issues`}
              aria-activedescendant={
                cursorId !== null && cursorRendered ? rowDomId(cursorGroupKey, cursorId) : undefined
              }
              tabIndex={0}
            >
              {/* `role="presentation"` on both wrappers: a listbox may only own options,
                groups and elements it explicitly claims, and two unroled divs between the two
                made several screen readers report a list with no items in it. The sizer and
                the slot are virtualisation arithmetic and have nothing to say. */}
              <div
                className={styles.sizer}
                role="presentation"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  if (row === undefined) return null;
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      className={styles.slot}
                      role="presentation"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      {row.kind === 'header' ? (
                        <GroupHeader row={row} onToggle={onToggleGroup} />
                      ) : (
                        <IssueRow
                          id={row.id}
                          rowIndex={virtualRow.index}
                          groupKey={row.groupKey}
                          properties={rowProperties}
                          selected={selection.ids.has(row.id)}
                          active={virtualRow.index === cursorRow}
                          onOpen={onOpenRow}
                          onFocus={onFocusRow}
                          onToggle={onToggleRow}
                          onExtend={onExtendRow}
                          onContextMenu={onRowContextMenu}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {/*
         * The bulk toolbar, which appears when there is a selection and not before.
         *
         * It used to be a permanent bar under the filter: eleven controls, mostly disabled,
         * announcing "Nothing to act on" above every list in the product. `02-issues.md` calls
         * for "the bulk action toolbar at the bottom", and the reason is not only tidiness —
         * a row of disabled buttons is a row people learn to stop reading, and the count that
         * makes a bulk action safe was sitting in it all day saying nothing.
         *
         * The shortcuts are untouched and keep their cursor-row fallback: `S` on a row with
         * nothing selected still opens the status picker, with no bar on screen. The bar is
         * the pointer's route to the same commands, so it is drawn for the state a pointer
         * can get into.
         *
         * A group and not `role="toolbar"`. A toolbar promises arrow-key navigation between
         * its controls, which would mean a roving tabindex and a local key handler — and the
         * keyboard in this product belongs to the registry. Every button here is in the tab
         * order and has a shortcut; claiming a pattern we do not implement would only mislead
         * the people who rely on it.
         */}
        <SelectionBar open={selection.size > 0 || picking}>
          {/* Announced rather than merely drawn: a bulk action's whole risk is acting on more
            rows than you meant to, and the count is the only thing that says how many. */}
          <span className={styles.selectionCount} aria-live="polite">
            {selection.size > 0
              ? `${selection.size} selected`
              : 'Acting on the row under the cursor'}
          </span>
          <Tooltip
            label={
              canAct && !canSetStatus
                ? 'Those issues are in different teams, and statuses belong to a team'
                : 'Change status'
            }
            keys="s"
          >
            <Button {...status.props} disabled={!canSetStatus}>
              Status
            </Button>
          </Tooltip>
          <Tooltip label="Assign to…" keys="a">
            <Button {...assignee.props} disabled={!canAct}>
              Assignee
            </Button>
          </Tooltip>
          <Tooltip label="Set priority" keys="p">
            <Button {...priority.props} disabled={!canAct}>
              Priority
            </Button>
          </Tooltip>
          <Tooltip label="Set project" keys="shift+p">
            <Button {...project.props} disabled={!canAct}>
              Project
            </Button>
          </Tooltip>
          <Tooltip label="Set cycle" keys="shift+c">
            <Button {...cycle.props} disabled={!canAct}>
              Cycle
            </Button>
          </Tooltip>
          <Tooltip label="Add label" keys="l">
            <Button {...labelMenu.props} disabled={!canSetStatus}>
              Labels
            </Button>
          </Tooltip>
          {/* Absent, not disabled, where no selection in this list could ever be estimated —
            the same call the detail rail makes about its estimate row. Still disabled, with a
            reason, for the cases that are about *this* selection rather than about the team. */}
          {estimatesPossible ? (
            <Tooltip
              label={
                canAct && !canEstimate(engine.store, targets)
                  ? 'Those issues do not share a team that estimates, and a scale belongs to a team'
                  : 'Set estimate'
              }
              keys="shift+e"
            >
              <Button {...estimate.props} disabled={!canEstimate(engine.store, targets)}>
                Estimate
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip label="Set due date" keys="shift+d">
            <Button {...due.props} disabled={!canSetStatus}>
              Due date
            </Button>
          </Tooltip>
          {inTriage ? (
            <>
              <Tooltip label="Accept" keys="1">
                <Button
                  variant="primary"
                  disabled={!canAct}
                  onClick={() => commands.current.acceptTriage()}
                >
                  Accept
                </Button>
              </Tooltip>
              <Tooltip label="Mark as duplicate" keys="2">
                <Button {...duplicate.props} disabled={!canAct}>
                  Duplicate
                </Button>
              </Tooltip>
              <Tooltip label="Decline" keys="3">
                <Button disabled={!canAct} onClick={() => commands.current.declineTriage()}>
                  Decline
                </Button>
              </Tooltip>
              <Tooltip label="Snooze" keys="h">
                <Button {...snooze.props} disabled={!canAct}>
                  Snooze
                </Button>
              </Tooltip>
            </>
          ) : null}
          {/* Secondary, like every other trigger in this row. These two were `ghost`, which put
            two borderless words at the end of a row of bordered buttons — one group wearing
            two affordances, and at the end where a scan stops looking. Demoting the two
            riskiest commands by removing their edges was the wrong lever anyway: what makes
            Delete safe is the confirmation and the undo, not it being hard to see. */}
          <Tooltip label="Archive">
            <Button
              disabled={!canAct}
              onClick={() => commands.current.askArchive()}
              icon={<ArchiveGlyph />}
            >
              Archive
            </Button>
          </Tooltip>
          {/* Not `danger`, for the same reason the button on the issue's own page is not: this
            is recoverable for thirty days and offers an undo for the next few seconds. Red is
            for the things that are not. */}
          <Tooltip label="Delete" keys="mod+Backspace">
            <Button disabled={!canAct} onClick={() => commands.current.askDelete()}>
              Delete
            </Button>
          </Tooltip>
        </SelectionBar>
        <Peek open={peekOpen} issueId={cursorId} onClose={() => commands.current.closePeek()} />
      </div>
    </div>
  );
}

/**
 * A group heading, and the control that folds the group away.
 *
 * It used to be `aria-hidden`, argued as avoiding a stutter: every row underneath names its
 * own status, so announcing the heading as well reads it twice for the first issue in each
 * group. That argument was about the *name* and it took the count and the collapse control
 * down with it — a button that hides thirty rows cannot be invisible to the reader who has
 * to press it. So the icon is decorative, the name and the count are announced, and
 * `aria-expanded` says which way the group is folded.
 */
function GroupHeader({ row, onToggle }: { row: HeaderRow; onToggle: (key: string) => void }) {
  // Resolved here rather than carried on the row, because only one of the seven groupings has
  // a status to draw and the row type should not pretend otherwise. Cheap: the virtualiser
  // keeps a handful of headers mounted at a time, and the subscription wakes only for a
  // status change.
  const state = useLiveQuery(
    (store) => (row.stateId === undefined ? null : (store.workflowStates.get(row.stateId) ?? null)),
    ['workflowState'],
    [row.stateId ?? ''],
  );

  return (
    <button
      type="button"
      className={styles.group}
      aria-expanded={!row.collapsed}
      onClick={() => onToggle(row.groupKey)}
    >
      <span
        className={[styles.groupChevron, row.collapsed ? styles.groupChevronShut : null]
          .filter(Boolean)
          .join(' ')}
        aria-hidden="true"
      >
        <ChevronGlyph />
      </span>
      {state !== null && <StateIcon category={state.category} color={state.color} decorative />}
      <span className={styles.groupName}>{row.name}</span>
      {/* The count is read out. It was inside the `aria-hidden` wrapper, which meant the one
          fact a heading carries that its rows do not was the one nobody could hear. */}
      <span className={styles.groupCount}>{row.count}</span>
    </button>
  );
}

/**
 * The bulk action bar, which is drawn only while there is a selection.
 *
 * `usePresence` is not reached for here because the bar has no exit to speak of: a selection
 * cleared is a bar that has nothing true left to say, and animating a count out while the
 * rows behind it have already lost their wash would be the interface disagreeing with
 * itself. The entrance is `--duration-fast` with `--ease-out`, which is the house rule, and
 * `.toolbar` carries the reduced-motion answer for the translate.
 *
 * It is also drawn while a picker is open with nothing selected, which is less a special case
 * than the consequence of one: `S`, `A`, `P` and `L` fall back to the cursor row, and every
 * one of those menus is anchored to a button in this bar and returns focus to it. A bar that
 * vanished the moment the selection did would leave a keyboard-opened menu with nothing to
 * position against and nowhere to hand focus back to.
 */
function SelectionBar({ open, children }: { open: boolean; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className={styles.toolbar} role="group" aria-label="Issue actions">
      {children}
    </div>
  );
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
      <path
        d="M4 6.5 8 10.5l4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface IssueRowProps {
  id: UUID;
  /** Where this row is in the flat order, so a click can say which copy of it was clicked. */
  rowIndex: number;
  /** The group it is being listed in — half of its identity under a label grouping. */
  groupKey: string;
  /**
   * Which optional properties this view draws, from the display menu.
   *
   * The menu has always offered these five and the board has always honoured them; the list
   * ignored the set entirely, so ticking "Estimate" on the layout people actually use did
   * nothing at all, and "Assignee" could not be turned off. A control that visibly does
   * nothing is worse than an absent one — it teaches the user that the menu is decorative.
   *
   * Passed as a resolved `Set` built once by the parent, so a memoised row still compares by
   * identity rather than rebuilding the set thirty times per scroll frame.
   */
  properties: ReadonlySet<DisplayProperty>;
  selected: boolean;
  /** Under the keyboard cursor. One row at a time, and not the same thing as selected. */
  active: boolean;
  onOpen: (identifier: string) => void;
  onFocus: (id: UUID, rowIndex: number) => void;
  onToggle: (id: UUID) => void;
  onExtend: (id: UUID) => void;
  onContextMenu: (id: UUID, rowIndex: number, x: number, y: number) => void;
}

/**
 * One issue.
 *
 * It reads its own issue out of the store rather than being handed one, which is what keeps
 * the parent's re-render independent of the corpus: a title edited in another session
 * re-renders this row and nothing else, and the list's own render never allocates five
 * thousand objects to find out. The subscription is compared structurally, so a delta that
 * moves an issue this row does not care about costs a comparison and no render at all.
 *
 * The labels are `LabelList`'s job rather than this row's, which is where they had been on a
 * board card all along. The row used to slice its own run at three chips, drop the group name
 * a grouped label is meaningless without — "P0" rather than "Priority: P0" — and say nothing
 * at all about the fourth. `LabelList` measures what actually fits in the width the title
 * leaves and collapses the rest into a "+2" that names them, which is both the honest answer
 * and the one the board already gives. It reads its own labels, so `label` and `issueLabel`
 * leave this row's subscription with them.
 */
const IssueRow = memo(function IssueRow({
  id,
  rowIndex,
  groupKey,
  properties,
  selected,
  active,
  onOpen,
  onFocus,
  onToggle,
  onExtend,
  onContextMenu,
}: IssueRowProps) {
  const fullNames = useSyncExternalStore(
    subscribePrefs,
    () => getPrefs().fullNames,
    () => true,
  );
  const issue = useLiveQuery(
    (store) => {
      const found = store.issues.get(id);
      if (found === undefined) return null;
      const state = store.workflowStates.get(found.stateId);
      const assignee =
        found.assigneeId === undefined ? undefined : store.users.get(found.assigneeId);
      // The team, for the two properties that cannot be read without it: the scale an
      // estimate is a number in, and the zone a due date is a day in. Resolved here rather
      // than in the row's markup so a row subscribes to its own team and not to every team.
      const team = store.get('team', found.teamId);
      const zone = team?.timezone;
      // The parent's identifier, for the breadcrumb. With `showSubIssues` on — all that flag
      // does is hide a child whose parent is also in the view — a child was visually
      // indistinguishable from a top-level issue, so the list said nothing about a structure
      // the product is built around.
      const parent = found.parentId === undefined ? undefined : store.issues.get(found.parentId);
      return {
        identifier: store.identifierOf(found),
        parentIdentifier: parent === undefined ? null : store.identifierOf(parent),
        title: found.title,
        projectName:
          found.projectId === undefined
            ? null
            : (store.projects.get(found.projectId)?.name ?? null),
        cycleName:
          found.cycleId === undefined ? null : (store.cycles.get(found.cycleId)?.name ?? null),
        createdAt: whenDay(found.createdAt.slice(0, 10) as DateOnly, zone),
        updatedAt: whenDay(found.updatedAt.slice(0, 10) as DateOnly, zone),
        priority: found.priority,
        stateName: state?.name ?? 'No status',
        stateCategory: state?.category ?? ('backlog' as StateCategory),
        stateColor: state?.color,
        assigneeId: assignee?.id ?? null,
        assigneeName: assignee === undefined ? null : personName(assignee),
        assigneeAvatar: assignee?.avatarUrl ?? null,
        estimate:
          team !== undefined && estimatesEnabled(team)
            ? issueEstimateLabel(found.estimate, team)
            : null,
        dueDate: found.dueDate === undefined ? null : whenDay(found.dueDate, zone),
        overdue: found.dueDate !== undefined && isOverdue(found.dueDate, zone),
      };
    },
    ['issue', 'team', 'user', 'workflowState', 'project', 'cycle'],
    [id, fullNames],
  );

  // A row whose issue has just been archived or revoked. It disappears on the next query,
  // which is a frame away; rendering nothing is better than rendering a skeleton for it.
  if (issue === null) return null;

  return (
    <div
      id={rowDomId(groupKey, id)}
      role="option"
      aria-selected={selected}
      className={[
        styles.row,
        selected ? styles.selected : null,
        active ? styles.active : null,
        issue.parentIdentifier === null ? null : styles.child,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={(event) => {
        onFocus(id, rowIndex);
        // The two selection gestures a pointer has. Everything else opens the issue, because
        // opening is what clicking a row means everywhere else in the product.
        if (event.shiftKey) onExtend(id);
        else if (event.metaKey || event.ctrlKey) onToggle(id);
        else onOpen(issue.identifier);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(id, rowIndex, event.clientX, event.clientY);
      }}
    >
      {/*
       * The leading slot holds two things in one place: the status ring, and the checkbox
       * that takes its place on hover.
       *
       * `02-issues.md` calls for "the checkbox that appears on hover near the left edge",
       * and without it the only pointer route into a selection was cmd-click — a gesture
       * nothing on screen mentions. The two are stacked rather than laid side by side so
       * the row's leading edge does not shift by twenty pixels as the pointer crosses it,
       * which in a dense list reads as the whole column jumping.
       *
       * The checkbox stops the click reaching the row: without that, ticking it would also
       * open the issue, which is the row's default gesture.
       */}
      <span className={styles.lead}>
        {/* The status is not one of the optional properties, and neither is the identifier. A
            row that dropped either would stop being readable the moment somebody grouped by
            assignee, and a row whose contents depend on the grouping is one people cannot
            learn to read — the same call the board card makes about its own StateIcon. */}
        <StateIcon
          category={issue.stateCategory}
          color={issue.stateColor}
          label={issue.stateName}
        />
        <span
          className={styles.check}
          onClick={(event) => event.stopPropagation()}
          role="presentation"
        >
          {/* Named rather than labelled: `08-ui-composition.md` allows a dense surface to
              drop the visible label and never the name, and a row is the densest surface
              there is. */}
          <Checkbox
            checked={selected}
            onChange={() => onToggle(id)}
            aria-label={`Select ${issue.identifier}`}
          />
        </span>
      </span>
      <span className={styles.identifier}>{issue.identifier}</span>
      {issue.parentIdentifier === null ? null : (
        // The parent as a crumb rather than as an indent alone: an indent says "this is under
        // something" and does not say what, which in a filtered list is the only half of the
        // fact worth having.
        <span className={styles.parentCrumb}>{issue.parentIdentifier}</span>
      )}
      <span className={styles.rowTitle}>{issue.title}</span>
      {properties.has('labels') ? <LabelList issueId={id} /> : null}
      <span className={styles.meta}>
        {properties.has('project') && issue.projectName !== null ? (
          <span className={styles.property}>{issue.projectName}</span>
        ) : null}
        {properties.has('cycle') && issue.cycleName !== null ? (
          <span className={styles.property}>{issue.cycleName}</span>
        ) : null}
        {properties.has('createdAt') ? (
          <span className={styles.property}>{issue.createdAt}</span>
        ) : null}
        {properties.has('updatedAt') ? (
          <span className={styles.property}>{issue.updatedAt}</span>
        ) : null}
        {properties.has('estimate') && issue.estimate !== null ? (
          <span className={styles.estimate}>{issue.estimate}</span>
        ) : null}
        {/*
         * Overdue says the word, and says it to everybody.
         *
         * The rendered text is `whenDay(...)` — "Yesterday" — which does not mean overdue,
         * so the tone was carrying the whole fact on its own. The composition doc uses this
         * exact case as the example that colour must never be the only carrier. The tone is
         * `--text-danger` now rather than `--priority-urgent`: a theme that recolours
         * urgency must not silently recolour a missed deadline.
         */}
        {properties.has('dueDate') && issue.dueDate !== null ? (
          <span
            className={[styles.due, issue.overdue ? styles.overdue : null]
              .filter(Boolean)
              .join(' ')}
          >
            {issue.dueDate}
            {issue.overdue ? <span className={styles.srOnly}> overdue</span> : null}
          </span>
        ) : null}
        {properties.has('priority') ? <PriorityIcon priority={issue.priority} decorative /> : null}
        {!properties.has('assignee') ? null : issue.assigneeName === null ||
          issue.assigneeId === null ? (
          <span className={styles.unassigned} aria-label="Unassigned" role="img" />
        ) : (
          <Link
            className={styles.chipLink}
            to={userViewPath(issue.assigneeId)}
            onClick={(event) => event.stopPropagation()}
            aria-label={issue.assigneeName}
          >
            <Avatar
              name={issue.assigneeName}
              src={issue.assigneeAvatar}
              size="xs"
              colorKey={issue.assigneeId}
              decorative
            />
          </Link>
        )}
      </span>
    </div>
  );
});

/**
 * Stable per row, because `aria-activedescendant` has to name exactly one element.
 *
 * Qualified by the group and not only by the issue: an issue in three label groups is three
 * rows, and three elements sharing an id is a reference that resolves to whichever the
 * document happens to hold first. The group key is user-supplied in places — a label's uuid,
 * a due date, the leading-space sentinel for "no value" — so it is reduced to the characters
 * an id may safely carry rather than trusted.
 */
function rowDomId(groupKey: string, id: UUID): string {
  return `issue-row-${domSafe(groupKey)}-${id}`;
}

/** Anything outside this set is not worth the guessing games an id with a space in it starts. */
function domSafe(key: string): string {
  return key.replaceAll(/[^A-Za-z0-9_-]/g, '_');
}

/** The identifier of an issue the cursor is on, or null when it is on nothing. */
function identifierOf(store: Store, id: UUID | null): string | null {
  if (id === null) return null;
  const issue = store.get('issue', id);
  return issue === undefined ? null : store.identifierOf(issue);
}

/**
 * Which issue a manual reorder moves, and between which neighbours it lands.
 *
 * `order` is the view's issues in the order on screen, de-duplicated; `targets` is what the
 * command acts on. One issue at a time: moving a multi-row selection through a manual order
 * is several mints with several answers about what "one place up" means for the rows in
 * between, and the spec's gesture is about the row under the cursor.
 *
 * A `delta` larger than the list is how "to the top" and "to the bottom" are said: the
 * clamp does the rest, and there is no second code path to keep in step with this one.
 */
function reorderPlan(
  order: readonly UUID[],
  targets: readonly UUID[],
  delta: number,
): { id: UUID; target: ReorderTarget } | null {
  if (targets.length !== 1) return null;
  const id = targets[0]!;
  const from = order.indexOf(id);
  if (from === -1) return null;

  const to = Math.min(Math.max(from + delta, 0), order.length - 1);
  if (to === from) return null;

  // The neighbours in the order the row will be in once it has left its old place, which is
  // not the order it is in now — off by one in the direction of travel, and getting it wrong
  // is a move that lands the row exactly where it started.
  const without = order.filter((candidate) => candidate !== id);
  return {
    id,
    target: { afterId: without[to - 1] ?? null, beforeId: without[to] ?? null },
  };
}

/** Where a screen's collapsed groups are remembered, per person, in this browser. */
function collapseStorageKey(preferenceKey: string | undefined): string | null {
  return preferenceKey === undefined ? null : `polaris.collapsedGroups:${preferenceKey}`;
}

function readCollapsed(preferenceKey: string | undefined): ReadonlySet<string> {
  const key = collapseStorageKey(preferenceKey);
  if (key === null) return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [],
    );
  } catch {
    // A private window, a full quota, a row somebody hand-edited. None of them is worth
    // taking the list down for: an unreadable preference is the same as not having one.
    return new Set();
  }
}

function writeCollapsed(preferenceKey: string | undefined, groups: ReadonlySet<string>): void {
  const key = collapseStorageKey(preferenceKey);
  if (key === null) return;
  try {
    if (groups.size === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify([...groups]));
  } catch {
    // See `readCollapsed`. A group that does not stay folded is a smaller problem than a
    // screen that will not render.
  }
}

/**
 * Whether the filter is the one that matches everything.
 *
 * A group with no nodes, at any depth — because that is what the bar leaves behind when the
 * last chip is removed, and what a URL with no `filter` param parses to. Anything else counts
 * as filtered even if it happens to match every issue, since the question being asked is "did
 * the user narrow this", not "did the narrowing change the answer".
 */
function isEmptyFilter(node: FilterNode): boolean {
  if (!isFilterGroup(node)) return false;
  return (node.nodes ?? []).every(isEmptyFilter);
}

/** The team and the heading this list is for, or the null heading that means "no such team". */
function scopeOf(
  store: Store,
  source: IssueListSource,
  teamKey: string,
  heading: string | undefined,
): ListScope {
  // Assignee first, because it is the case with no team: an issue assigned to somebody can
  // be in any team they can reach, which is exactly why the settings link and the team name
  // are absent from this list rather than guessed at.
  if (source.kind === 'assignee') {
    return { heading: heading ?? 'My issues', team: null, timezone: browserTimezone() };
  }

  if (source.kind === 'project') {
    const project = store.projects.get(source.projectId);
    if (project === undefined) return { heading: null, team: null, timezone: browserTimezone() };
    return { heading: heading ?? project.name, team: null, timezone: browserTimezone() };
  }

  if (source.kind === 'cycle') {
    const cycle = store.cycles.get(source.cycleId);
    if (cycle === undefined) return { heading: null, team: null, timezone: browserTimezone() };
    const team = store.teams.get(cycle.teamId);
    return {
      heading: heading ?? cycle.name,
      team: team === undefined ? null : { id: team.id, key: team.key, name: team.name },
      timezone: team?.timezone ?? browserTimezone(),
    };
  }

  if (source.kind === 'label') {
    const title = labelViewTitle(store, source.labelId);
    if (title === null) return { heading: null, team: null, timezone: browserTimezone() };
    const label = store.labels.get(source.labelId);
    const team = label?.teamId === undefined ? undefined : store.teams.get(label.teamId);
    return {
      heading: heading ?? title,
      team: team === undefined ? null : { id: team.id, key: team.key, name: team.name },
      timezone: team?.timezone ?? browserTimezone(),
    };
  }

  if (source.kind === 'triage') {
    const team = store.teams.get(source.teamId);
    if (team === undefined) return { heading: null, team: null, timezone: browserTimezone() };
    return {
      heading: heading ?? `${team.name} triage`,
      team: { id: team.id, key: team.key, name: team.name },
      timezone: team.timezone,
    };
  }

  if (source.kind === 'view') {
    const view = store.views.get(source.viewId);
    if (view === undefined) return { heading: null, team: null, timezone: browserTimezone() };
    const team = view.teamId === undefined ? undefined : store.teams.get(view.teamId);
    return {
      heading: view.name,
      // No settings link even for a team-scoped view: the screen is the view, and a link to
      // the team's settings from it points somewhere the heading did not promise.
      team: null,
      timezone: team?.timezone ?? browserTimezone(),
    };
  }

  if (source.kind === 'adhoc') {
    return {
      heading: heading ?? source.identifiers.join(', '),
      team: null,
      timezone: browserTimezone(),
    };
  }

  const team = [...store.teams.values()].find((candidate) => candidate.key === teamKey);
  if (team === undefined) {
    return { heading: null, team: null, timezone: browserTimezone() };
  }

  return {
    heading: team.name,
    team: { id: team.id, key: team.key, name: team.name },
    timezone: team.timezone,
  };
}

/**
 * The issues that were ever candidates, before the filter says anything.
 *
 * A generator over the live index rather than an array, because `useView` runs this on every
 * keystroke and building a five-thousand-element array per character would spend the whole
 * filter budget on garbage before a single clause ran.
 *
 * Completed work is excluded from a person's list at the *corpus* level rather than through
 * the `showCompleted` display option. That is a scope decision and not a display one: "my
 * issues" means the ones still asking something of me, and a display toggle that could pull
 * every issue I have ever finished into that list would be answering a different question
 * from the one the screen's name asks. A team's list has no such restriction — an empty
 * "Done" column on a team board is information.
 */
function* corpusOf(
  store: Store,
  source: IssueListSource,
  teamId: UUID | undefined,
  includeCompleted: boolean,
  now: number,
  showSnoozed: boolean,
): Generator<Issue> {
  const ids = corpusIdsOf(store, source, teamId);
  if (ids === null) return;

  for (const id of ids) {
    const issue = store.issues.get(id);
    if (issue === undefined) continue;
    if (source.kind === 'assignee' && !includeCompleted) {
      const category = store.workflowStates.get(issue.stateId)?.category;
      if (category === 'completed' || category === 'canceled') continue;
    }
    if (source.kind === 'triage' && !showSnoozed && isSnoozed(issue.snoozedUntil, now)) continue;
    yield issue;
  }
}

/**
 * Which index a source draws from.
 *
 * `active()` for a workspace-scoped saved view, which is the only source that spans every
 * team: archived issues are excluded there for the same reason they are excluded everywhere
 * — a filter that has to remember to say `archived is false` is one that will sometimes
 * forget, and the grammar turns that default off only when a clause mentions it.
 */
function corpusIdsOf(
  store: Store,
  source: IssueListSource,
  teamId: UUID | undefined,
): ReadonlySet<UUID> | null {
  if (source.kind === 'assignee') return store.index.byAssignee(source.userId);
  if (source.kind === 'project') return store.index.byProject(source.projectId);
  if (source.kind === 'cycle') return store.index.byCycle(source.cycleId);
  if (source.kind === 'label') return issueIdsForLabelView(store, source.labelId);
  if (source.kind === 'triage') return store.index.byTeam(source.teamId);
  if (source.kind === 'view') {
    const view = store.views.get(source.viewId);
    if (view === undefined) return null;
    if (view.projectId !== undefined) return store.index.byProject(view.projectId);
    return view.teamId === undefined ? store.index.active() : store.index.byTeam(view.teamId);
  }
  if (source.kind === 'adhoc') return new Set(issueIdsForAdhocList(store, source.identifiers));
  return teamId === undefined ? null : store.index.byTeam(teamId);
}

/**
 * Flattens the view's groups into the header-and-issue rows the virtualiser walks.
 *
 * Flat rather than nested because a virtualiser measures and positions one list: real
 * `role="group"` nesting would mean either giving up virtualisation or lying to the
 * accessibility tree about a structure that is not in the DOM.
 *
 * Reads nothing from the store. The grouping already decided both the order of the groups
 * and their names, and re-resolving a status here to reproduce a label the group is carrying
 * would be a second, divergent answer to a question already settled.
 */
function rowsOf(groups: readonly ViewGroup[], collapsed: ReadonlySet<string>): ListRow[] {
  const rows: ListRow[] = [];
  for (const group of groups) {
    const shut = collapsed.has(group.key);
    rows.push({
      kind: 'header',
      key: `header-${group.key}`,
      groupKey: group.key,
      name: group.label === '' ? 'All issues' : group.label,
      count: group.ids.length,
      stateId: group.stateId,
      collapsed: shut,
    });
    // A collapsed group keeps its heading and drops its rows. Not `display: none` on them:
    // the virtualiser measures and positions what it is given, so a hidden row is still a
    // row's worth of scroll range and the scrollbar would claim work nobody can see.
    if (shut) continue;
    for (const id of group.ids) {
      rows.push({ kind: 'issue', key: `${group.key}:${id}`, groupKey: group.key, id });
    }
  }
  return rows;
}

interface SharedProperties {
  readonly stateId: UUID | undefined;
  readonly assigneeId: UUID | null | undefined;
  readonly priority: number | undefined;
  /**
   * The team the selection is in, when it is all in one.
   *
   * Undefined for a selection that spans teams, which cannot happen in a team's list and
   * happens constantly in a person's. It matters because statuses belong to a team: there
   * is no set of statuses that is correct for two teams at once, so the status picker is
   * disabled rather than offering one team's statuses for another team's issues.
   */
  readonly teamId: UUID | undefined;
  readonly projectId: UUID | null | undefined;
  readonly cycleId: UUID | null | undefined;
  readonly estimate: number | null | undefined;
  readonly dueDate: DateOnly | null | undefined;
  readonly dueDateSource: DueDateSource;
  readonly timezone: string;
  /** Intersection of labels on every targeted issue. */
  readonly labelIds: readonly UUID[];
}

/** Nothing in common — which is also the right answer for an empty target set. */
const NOTHING_SHARED: SharedProperties = {
  teamId: undefined,
  stateId: undefined,
  assigneeId: undefined,
  priority: undefined,
  projectId: undefined,
  cycleId: undefined,
  estimate: undefined,
  dueDate: undefined,
  dueDateSource: 'manual',
  timezone: 'UTC',
  labelIds: [],
};

/**
 * What the targeted issues agree on, so a picker can tick the current value.
 *
 * `undefined` means they disagree, and it is deliberately not `null`: null is a real answer
 * for an assignee — nobody — and a picker that conflated the two would tick "No assignee"
 * over forty issues that have four different people on them.
 *
 * Computed only while a picker is open. Over a full selection it is one map lookup per
 * issue, which is nothing once, and would be a waste on every keystroke.
 */
function sharedProperties(store: Store, targets: readonly UUID[]): SharedProperties {
  let stateId: UUID | undefined;
  let assigneeId: UUID | null | undefined;
  let priority: number | undefined;
  let teamId: UUID | undefined;
  let projectId: UUID | null | undefined;
  let cycleId: UUID | null | undefined;
  let estimate: number | null | undefined;
  let dueDate: DateOnly | null | undefined;
  let dueDateSource: DueDateSource = 'manual';
  let timezone = 'UTC';
  let labelIds: UUID[] | undefined;
  let first = true;

  for (const id of targets) {
    const issue = store.issues.get(id);
    if (issue === undefined) continue;
    const labels = [...store.labelIdsFor(id)];
    if (first) {
      stateId = issue.stateId;
      assigneeId = issue.assigneeId ?? null;
      priority = issue.priority;
      teamId = issue.teamId;
      projectId = issue.projectId ?? null;
      cycleId = issue.cycleId ?? null;
      estimate = issue.estimate ?? null;
      dueDate = issue.dueDate ?? null;
      dueDateSource = issue.dueDateSource;
      timezone = store.teams.get(issue.teamId)?.timezone ?? 'UTC';
      labelIds = labels;
      first = false;
      continue;
    }
    if (stateId !== issue.stateId) stateId = undefined;
    if (assigneeId !== (issue.assigneeId ?? null)) assigneeId = undefined;
    if (priority !== issue.priority) priority = undefined;
    if (teamId !== issue.teamId) teamId = undefined;
    if (projectId !== (issue.projectId ?? null)) projectId = undefined;
    if (cycleId !== (issue.cycleId ?? null)) cycleId = undefined;
    if (estimate !== (issue.estimate ?? null)) estimate = undefined;
    if (dueDate !== (issue.dueDate ?? null)) dueDate = undefined;
    if (dueDateSource !== issue.dueDateSource) dueDateSource = 'manual';
    if (labelIds !== undefined) {
      const held = new Set(labels);
      labelIds = labelIds.filter((labelId) => held.has(labelId));
    }
  }
  return {
    stateId,
    assigneeId,
    priority,
    teamId,
    projectId,
    cycleId,
    estimate,
    dueDate,
    dueDateSource,
    timezone,
    labelIds: labelIds ?? [],
  };
}

/** Estimate picker only when every targeted issue is in one team that estimates. */
function canEstimate(store: Store, targets: readonly UUID[]): boolean {
  if (targets.length === 0 || !sameTeam(store, targets)) return false;
  const issue = store.issues.get(targets[0]!);
  if (issue === undefined) return false;
  const team = store.teams.get(issue.teamId);
  return team !== undefined && estimatesEnabled(team);
}

/**
 * "3 issues", "1 issue".
 *
 * Trivial, and it is here rather than inlined because it is used in four places that must
 * agree — the dialogue's question, its consequence, its button and the undo toast — and
 * "Delete 1 issues" in any one of them is how somebody learns not to trust the count.
 */
function issueCount(n: number): string {
  return n === 1 ? '1 issue' : `${n} issues`;
}

function ArchiveGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M2 4.5h12M3.5 4.5v8a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-8M6 7h4M4 2.5h8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Whether every issue given is in one team.
 *
 * Read from the store rather than from `sharedProperties`, because the commands object is
 * built before that runs and closing over it would capture a stale answer from the render
 * in which the shortcut was registered.
 */
function sameTeam(store: Store, targets: readonly UUID[]): boolean {
  let teamId: UUID | undefined;
  for (const id of targets) {
    const issue = store.issues.get(id);
    if (issue === undefined) continue;
    if (teamId === undefined) teamId = issue.teamId;
    else if (teamId !== issue.teamId) return false;
  }
  return teamId !== undefined;
}
