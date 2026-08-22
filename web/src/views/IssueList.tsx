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

import { memo, useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useVirtualizer } from '@tanstack/react-virtual';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext, useKeymap } from '~/app/keymap';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  LabelChip,
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
  report,
  setSubscribed,
  updateIssueProperties,
  updateIssues,
} from '~/features/issue/mutations';
import { RESTORE_WINDOW_DAYS, restoreIssue } from '~/features/trash/mutations';
import { offerUndo } from '~/features/undo/UndoToast';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { liveIssueCountForTeam } from '~/features/team/issueLimit';
import { TeamIssueLimitBanner } from '~/features/team/TeamIssueLimitBanner';
import {
  issueIdsForLabelView,
  labelViewPath,
  labelViewTitle,
  userViewPath,
} from '~/features/labels/labelView';
import { setViewSubscription, updateView } from '~/features/view/mutations';
import { SaveViewModal } from '~/features/view/SaveViewModal';
import { downloadCsv, exportCap, issuesToCsv, type ExportRole } from '~/features/export/csv';
import { personName, subscribePrefs, getPrefs } from '~/features/prefs/prefs';
import { useViewer, useViewerId } from '~/hooks/useViewer';
import { AssigneePicker, PriorityPicker, StatusPicker } from '~/features/issue/pickers';
import { DueDatePicker, EstimatePicker } from '~/features/issue/properties';
import { estimatesEnabled } from '~/features/estimate';
import { applyLabel, removeLabel } from '~/features/labels/mutations';
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
import { useView, type ViewGroup } from '~/features/view/ui/useView';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useSelection } from '~/hooks/useSelection';
import { browserTimezone } from '~/features/locale';
import { EMPTY_FILTER, isFilterGroup, parseDisplayParams, type FilterNode } from '~/filter';
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
  readonly name: string;
  readonly count: number;
  readonly stateId: UUID | undefined;
}

/** One issue, by id and nothing else. Everything drawn in it is read by the row itself. */
interface IssueRowRef {
  readonly kind: 'issue';
  readonly key: string;
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
const ESTIMATED_HEADER_PX = 36;

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
  archive(): void;
  askDelete(): void;
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
  insightsOpen(): boolean;
  toggleInsights(): void;
  saveView(): void;
  copyViewLink(): void;
}

export function IssueList({ source = TEAM_SOURCE, heading }: IssueListProps = {}) {
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
      return { ownerId: row.ownerId, teamId: row.teamId };
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
  });

  const groups = view.groups;
  const rows = useMemo(() => rowsOf(groups), [groups]);

  // Derived outside the selector on purpose: the store compares a subscription's result
  // structurally, and a Map has no enumerable own properties — two different maps would
  // compare equal and the list would stop updating.
  const ids = useMemo(
    () => rows.filter((row): row is IssueRowRef => row.kind === 'issue').map((row) => row.id),
    [rows],
  );
  const insightIds = useMemo(() => {
    const unique: UUID[] = [];
    const seen = new Set<UUID>();
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      unique.push(id);
    }
    return unique;
  }, [ids]);
  const rowIndexOf = useMemo(() => {
    const index = new Map<UUID, number>();
    rows.forEach((row, at) => {
      if (row.kind === 'issue') index.set(row.id, at);
    });
    return index;
  }, [rows]);

  const selection = useSelection(ids);
  const [cursor, setCursor] = useState<UUID | null>(null);

  /**
   * Where the keyboard is, resolved against the list as it stands.
   *
   * Held as an id and re-resolved rather than stored as a position, for the same reason the
   * selection's anchor is: the issue the user is looking at should stay under the cursor when
   * a delta reorders the rows around it, and fall back to the top only when it has actually
   * gone.
   */
  const { cursorId, cursorIndex } = useMemo(() => {
    if (cursor !== null) {
      const at = ids.indexOf(cursor);
      if (at !== -1) return { cursorId: cursor, cursorIndex: at };
    }
    const first = ids[0] ?? null;
    return { cursorId: first, cursorIndex: first === null ? -1 : 0 };
  }, [cursor, ids]);

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
  const targets = useMemo(
    () => (selection.size > 0 ? selection.ordered : cursorId === null ? [] : [cursorId]),
    [selection.size, selection.ordered, cursorId],
  );
  const excludeFromDuplicate = useMemo(() => new Set(targets), [targets]);

  const scrollToRow = useCallback(
    (id: UUID) => {
      const at = rowIndexOf.get(id);
      if (at !== undefined) virtualizer.scrollToIndex(at, { align: 'auto' });
    },
    [rowIndexOf, virtualizer],
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
    archive: () => {},
    askDelete: () => {},
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
    insightsOpen: () => false,
    toggleInsights: () => {},
    saveView: () => {},
    copyViewLink: () => {},
  });

  const step = (delta: number): UUID | null => {
    if (ids.length === 0) return null;
    const at = Math.min(Math.max(cursorIndex + delta, 0), ids.length - 1);
    return ids[at] ?? null;
  };

  commands.current = {
    move: (delta) => {
      const next = step(delta);
      if (next === null) return;
      setCursor(next);
      scrollToRow(next);
    },
    extend: (delta) => {
      const next = step(delta);
      if (next === null) return;
      // The cursor is the fallback anchor, so the first shift-arrow of a gesture takes the
      // row the user is on as well as the one they are moving to.
      selection.extendTo(next, cursorId);
      setCursor(next);
      scrollToRow(next);
    },
    toggle: () => {
      if (cursorId !== null) selection.toggle(cursorId);
    },
    selectAll: () => selection.selectAll(),
    clearSelection: () => selection.clear(),
    hasSelection: () => selection.size > 0,
    hasRows: () => ids.length > 0,
    open: () => {
      if (cursorId === null) return;
      const issue = engine.store.get('issue', cursorId);
      if (issue !== undefined) void navigate(`/issue/${engine.store.identifierOf(issue)}`);
    },
    archive: () => {
      if (targets.length === 0) return;
      archiveIssues(engine, targets).catch(report);
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
      const unique: UUID[] = [];
      const seen = new Set<UUID>();
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        unique.push(id);
        if (unique.length >= cap) break;
      }
      const slug = (scope.heading ?? 'issues').toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
      downloadCsv(`${slug || 'issues'}.csv`, issuesToCsv(engine.store, unique));
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
    inTriage: () => inTriage,
    copyGitBranch: () => {
      if (cursorId === null) return;
      const row = engine.store.get('issue', cursorId);
      if (row === undefined) return;
      void copyText(gitBranchNameFor(engine.store, row, viewer?.displayName ?? ''));
    },
    insightsOpen: () => insightsOpenRef.current,
    toggleInsights: () => setInsights(!insightsOpenRef.current),
    saveView: () => setSaveOpen(true),
    copyViewLink: () => {
      void copyText(window.location.href);
    },
  };

  /**
   * Deletes what the dialogue named, and says how to get it back.
   *
   * The identifiers are read before the write, because a moment later they are not readable:
   * the optimistic patch takes the rows out of the replica, so a label built afterwards would
   * say "Deleted 3 issues" and mean nothing anybody could check.
   *
   * The undo restores all of them, and does it with `all` semantics rather than sequentially:
   * each restore is its own idempotent mutation with its own opId, and one of them failing
   * should not leave the rest in the trash. A partial failure surfaces through `report` like
   * any other rejected mutation, and the rows that did come back have come back.
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
        await Promise.all(ids.map((id) => restoreIssue(engine, id)));
      },
    });
  };

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
      {
        id: 'issueList.estimate',
        title: 'Set estimate',
        keys: ['shift+e'],
        when: 'list',
        group: 'Issues',
        run: () => commands.current.pickEstimate(),
      },
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
      {
        id: 'issueList.triageAccept',
        title: 'Accept from triage',
        keys: ['1'],
        when: 'list',
        group: 'Triage',
        enabled: () => commands.current.inTriage() && commands.current.hasRows(),
        run: () => commands.current.acceptTriage(),
      },
      {
        id: 'issueList.triageDuplicate',
        title: 'Mark as duplicate',
        keys: ['2', 'm m'],
        when: 'list',
        group: 'Triage',
        enabled: () => commands.current.inTriage() && commands.current.hasRows(),
        run: () => commands.current.pickDuplicate(),
      },
      {
        id: 'issueList.triageDecline',
        title: 'Decline from triage',
        keys: ['3'],
        when: 'list',
        group: 'Triage',
        enabled: () => commands.current.inTriage() && commands.current.hasRows(),
        run: () => commands.current.declineTriage(),
      },
      {
        id: 'issueList.triageSnooze',
        title: 'Snooze triage issue',
        keys: ['h'],
        when: 'list',
        group: 'Triage',
        enabled: () => commands.current.inTriage() && commands.current.hasRows(),
        run: () => commands.current.pickSnooze(),
      },
      {
        id: 'issueList.archive',
        title: 'Archive issue',
        keys: ['e'],
        when: 'list',
        group: 'Issues',
        run: () => commands.current.archive(),
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
        enabled: () => viewer !== null && viewer.role !== 'guest',
        run: () => commands.current.saveView(),
      },
      {
        id: 'issueList.copyViewLink',
        title: 'Copy view URL',
        when: 'list',
        group: 'Views',
        run: () => commands.current.copyViewLink(),
      },
    ],
    [viewerId],
  );

  const onOpenRow = useCallback(
    (identifier: string) => navigate(`/issue/${identifier}`),
    [navigate],
  );
  const onFocusRow = useCallback((id: UUID) => setCursor(id), []);
  const onToggleRow = useCallback((id: UUID) => selection.toggle(id), [selection]);
  const onExtendRow = useCallback(
    (id: UUID) => selection.extendTo(id, cursorId),
    [selection, cursorId],
  );

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
  const virtualRows = virtualizer.getVirtualItems();

  // `aria-activedescendant` has to name an element that is actually in the document, and a
  // virtualised list is mostly arithmetic. The cursor is scrolled into view whenever it
  // moves, so this is true in every case but a scroll that has left it behind — where a
  // dangling reference would be reported as an error by some screen readers.
  const cursorRendered = virtualRows.some((item) => {
    const row = rows[item.index];
    return row !== undefined && row.kind === 'issue' && row.id === cursorId;
  });

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

      <FilterBar
        filter={view.filter}
        onChange={view.setFilter}
        teamId={team?.id}
        error={view.error}
        timezone={scope.timezone}
      />

      {insightsOpen ? (
        <InsightsPanel
          issueIds={insightIds}
          filter={view.filter}
          onFilter={view.setFilter}
          onClose={() => setInsights(false)}
        />
      ) : null}

      <DisplayMenu
        display={view.display}
        onChange={view.setDisplay}
        open={display.open}
        onClose={display.hide}
        trigger={display.ref}
        triage={inTriage}
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

      {/* A group and not `role="toolbar"`. A toolbar promises arrow-key navigation between
          its controls, which would mean a roving tabindex and a local key handler — and the
          keyboard in this product belongs to the registry. Every button here is in the tab
          order and has a shortcut; claiming a pattern we do not implement would only mislead
          the people who rely on it. */}
      <div className={styles.toolbar} role="group" aria-label="Issue actions">
        {/* Announced rather than merely drawn: a bulk action's whole risk is acting on more
            rows than you meant to, and the count is the only thing that says how many. */}
        <span className={styles.selectionCount} aria-live="polite">
          {selection.size > 0
            ? `${selection.size} selected`
            : cursorId === null
              ? 'Nothing to act on'
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
        <Tooltip label="Set estimate" keys="shift+e">
          <Button {...estimate.props} disabled={!canEstimate(engine.store, targets)}>
            Estimate
          </Button>
        </Tooltip>
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
        <Tooltip label="Archive" keys="e">
          <Button
            variant="ghost"
            disabled={!canAct}
            onClick={() => commands.current.archive()}
            icon={<ArchiveGlyph />}
          >
            Archive
          </Button>
        </Tooltip>
        {/* Not `danger`, for the same reason the button on the issue's own page is not: this
            is recoverable for thirty days and offers an undo for the next few seconds. Red is
            for the things that are not. */}
        <Tooltip label="Delete" keys="mod+Backspace">
          <Button variant="ghost" disabled={!canAct} onClick={() => commands.current.askDelete()}>
            Delete
          </Button>
        </Tooltip>
      </div>

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
        {rows.length === 0 ? (
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
            onOpen={onOpenRow}
            onFocus={onFocusRow}
            onToggle={onToggleRow}
            onExtend={onExtendRow}
          />
        ) : (
          <div
            ref={scrollRef}
            className={styles.scroller}
            role="listbox"
            aria-multiselectable="true"
            aria-label={`${scope.heading} issues`}
            aria-activedescendant={
              cursorId !== null && cursorRendered ? rowDomId(cursorId) : undefined
            }
            tabIndex={0}
          >
            <div className={styles.sizer} style={{ height: virtualizer.getTotalSize() }}>
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (row === undefined) return null;
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    className={styles.slot}
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {row.kind === 'header' ? (
                      <GroupHeader row={row} />
                    ) : (
                      <IssueRow
                        id={row.id}
                        selected={selection.ids.has(row.id)}
                        active={row.id === cursorId}
                        onOpen={onOpenRow}
                        onFocus={onFocusRow}
                        onToggle={onToggleRow}
                        onExtend={onExtendRow}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {peekOpen ? <Peek issueId={cursorId} /> : null}
      </div>
    </div>
  );
}

/**
 * A status heading.
 *
 * Hidden from assistive technology: every row underneath names its own status, so announcing
 * the heading as well would read the status twice for the first issue in each group and once
 * for the rest — a pattern that reads as a stutter rather than as structure.
 */
function GroupHeader({ row }: { row: HeaderRow }) {
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
    <div className={styles.group} aria-hidden="true">
      {state !== null && <StateIcon category={state.category} color={state.color} decorative />}
      <span className={styles.groupName}>{row.name}</span>
      <span className={styles.groupCount}>{row.count}</span>
    </div>
  );
}

interface IssueRowProps {
  id: UUID;
  selected: boolean;
  /** Under the keyboard cursor. One row at a time, and not the same thing as selected. */
  active: boolean;
  onOpen: (identifier: string) => void;
  onFocus: (id: UUID) => void;
  onToggle: (id: UUID) => void;
  onExtend: (id: UUID) => void;
}

/**
 * One issue.
 *
 * It reads its own issue out of the store rather than being handed one, which is what keeps
 * the parent's re-render independent of the corpus: a title edited in another session
 * re-renders this row and nothing else, and the list's own render never allocates five
 * thousand objects to find out. The subscription is compared structurally, so a delta that
 * moves an issue this row does not care about costs a comparison and no render at all.
 */
const IssueRow = memo(function IssueRow({
  id,
  selected,
  active,
  onOpen,
  onFocus,
  onToggle,
  onExtend,
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
      const labels: { id: UUID; name: string; color: string }[] = [];
      for (const labelId of store.labelIdsFor(found.id)) {
        const label = store.get('label', labelId);
        if (label === undefined) continue;
        labels.push({ id: label.id, name: label.name, color: label.color });
      }
      labels.sort((a, b) => a.name.localeCompare(b.name));
      return {
        identifier: store.identifierOf(found),
        title: found.title,
        priority: found.priority,
        stateName: state?.name ?? 'No status',
        stateCategory: state?.category ?? ('backlog' as StateCategory),
        stateColor: state?.color,
        assigneeId: assignee?.id ?? null,
        assigneeName: assignee === undefined ? null : personName(assignee),
        assigneeAvatar: assignee?.avatarUrl ?? null,
        labels,
      };
    },
    ['issue', 'team', 'user', 'workflowState', 'label', 'issueLabel'],
    [id, fullNames],
  );

  // A row whose issue has just been archived or revoked. It disappears on the next query,
  // which is a frame away; rendering nothing is better than rendering a skeleton for it.
  if (issue === null) return null;

  return (
    <div
      id={rowDomId(id)}
      role="option"
      aria-selected={selected}
      className={[styles.row, selected ? styles.selected : null, active ? styles.active : null]
        .filter(Boolean)
        .join(' ')}
      onClick={(event) => {
        onFocus(id);
        // The two selection gestures a pointer has. Everything else opens the issue, because
        // opening is what clicking a row means everywhere else in the product.
        if (event.shiftKey) onExtend(id);
        else if (event.metaKey || event.ctrlKey) onToggle(id);
        else onOpen(issue.identifier);
      }}
    >
      <StateIcon category={issue.stateCategory} color={issue.stateColor} label={issue.stateName} />
      <span className={styles.identifier}>{issue.identifier}</span>
      <span className={styles.rowTitle}>{issue.title}</span>
      {issue.labels.length > 0 && (
        <span className={styles.labels}>
          {issue.labels.slice(0, 3).map((label) => (
            <Link
              key={label.id}
              className={styles.chipLink}
              to={labelViewPath(label.id)}
              onClick={(event) => event.stopPropagation()}
            >
              <LabelChip name={label.name} color={label.color} compact />
            </Link>
          ))}
        </span>
      )}
      <span className={styles.meta}>
        <PriorityIcon priority={issue.priority} decorative />
        {issue.assigneeName === null || issue.assigneeId === null ? (
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

/** Stable per issue, because `aria-activedescendant` has to name an element that exists. */
function rowDomId(id: UUID): string {
  return `issue-row-${id}`;
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
    return { heading: heading ?? 'My Issues', team: null, timezone: browserTimezone() };
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
function rowsOf(groups: readonly ViewGroup[]): ListRow[] {
  const rows: ListRow[] = [];
  for (const group of groups) {
    rows.push({
      kind: 'header',
      key: `header-${group.key}`,
      name: group.label === '' ? 'All issues' : group.label,
      count: group.ids.length,
      stateId: group.stateId,
    });
    for (const id of group.ids) rows.push({ kind: 'issue', key: id, id });
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
