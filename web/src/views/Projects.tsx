/**
 * The workspace (or team) project list.
 *
 * A scan, not a dashboard: a table with one row per project — name and the milestone it is
 * on, health and how old that claim is, priority, lead, target, how much work is in it and
 * how much of that is done. Empty teaches the next action — create a project — rather than
 * decorating a blank pane.
 *
 * How it is grouped, ordered and columned is the reader's, not the file's. It used to be
 * hard-wired to priority bands, which is one good answer to "what shape is this work" and a
 * poor answer to the other four people ask — whose is it, what state is it in, which team
 * owns it. The bands are now the default of a `grouping` option that lives in the URL beside
 * the filters, so the arrangement is part of what a shared link carries.
 *
 * Three layouts over the same rows: the table, a board of columns per project status, and
 * the timeline. All three sit behind one loading gate. The timeline used to be returned
 * before it, which meant it drew an unsettled replica as an empty plan — the exact claim the
 * gate exists to refuse, and the one this file's own comment already warned about for the
 * list.
 *
 * The keyboard is the issue list's, through `useListCursor`: `j`/`k` move, Enter opens,
 * Space peeks the row without leaving the list, right-click opens the row's menu. Before this the screen registered one action — export —
 * and claimed no key context at all, so every affordance on it was mouse-only.
 *
 * Drag a row onto another to reorder it, and onto a group heading to move it into that
 * band. A drop writes manual order, so it is offered only where manual order is what the
 * list is in — under any other ordering the drop would be a `sortOrder` write with no
 * visible effect, which is how people learn not to trust a list.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext, useKeymap } from '~/app/keymap';
import {
  Avatar,
  Button,
  ConfirmDialog,
  EmptyState,
  ListGroup,
  Menu,
  PriorityIcon,
  priorityLabel,
  SegmentedControl,
  Select,
  type MenuNode,
} from '~/components';
import {
  downloadCsv,
  exportCap,
  exportCapNote,
  projectsToCsv,
  type ExportRole,
} from '~/features/export/csv';
import { copyText } from '~/features/github/copy';
import { report } from '~/features/issue/mutations';
import {
  matchesProjectCustomerFilter,
  projectCustomerFilterOptions,
  type ProjectCustomerFilter,
} from '~/features/projects/customerFilter';
import {
  matchesDependencyFilter,
  ProjectDependencyFilterSelect,
} from '~/features/projects/dependencies';
import { EntityLoading, useStoreSettled } from '~/features/entity-gate/EntityGate';
import {
  activeProjectFilterCount,
  changedProjectDisplayCount,
  DEFAULT_PROJECT_FILTERS,
  matchesProjectStatusFilter,
  PROJECT_DISPLAY_PARAMS,
  PROJECT_FILTER_PARAMS,
  resolveProjectDisplay,
  resolveProjectFilters,
  toProjectDisplayParams,
  toProjectFilterParams,
  type ProjectColumn,
  type ProjectDirection,
  type ProjectDisplayOptions,
  type ProjectFilterOptions,
  type ProjectGrouping,
  type ProjectOrdering,
  type ProjectStatusFilter,
} from '~/features/projects/display';
import {
  PROJECT_STATUS_CATEGORIES,
  PROJECT_STATUS_CATEGORY_LABELS,
} from '~/features/projects/statusCategories';
import { buildProjectGraph } from '~/features/projects/computeProjectGraph';
import {
  CalendarGlyph,
  MilestoneGlyph,
  NoPersonGlyph,
  PlusGlyph,
  ProjectGlyph,
} from '~/features/projects/glyphs';
import { ProjectDisplayMenu } from '~/features/projects/ProjectDisplayMenu';
import { ProgressRing } from '~/features/projects/ProgressRing';
import { ProjectStatusPicker } from '~/features/projects/ProjectStatusPicker';
import { ProjectTimeline } from '~/features/projects/ProjectTimeline';
import { archiveProject, updateProject } from '~/features/projects/mutations';
import { formatTimeframe } from '~/features/projects/properties';
import { isFavorite, toggleFavorite } from '~/features/view/mutations';
import { UserPicker } from '~/features/members/UserPicker';
import { listProjectMilestones } from '~/features/project-milestones/helpers';
import { ProjectHealthCell } from '~/features/project-updates/ProjectHealthCell';
import { projectProgress, type Progress } from '~/features/initiatives/progress';
import { ProjectPeek } from '~/features/peek/ProjectPeek';
import { entityRowMenuItems } from '~/features/entity/entityRowMenu';
import { useContextMenu } from '~/hooks/useContextMenu';
import { useListCursor, listRowDomId } from '~/hooks/useListCursor';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import { PRIORITY_LEVELS } from '~/components/PriorityIcon';
import { compareOrderKeys } from '~/store';
import type { Project, ProjectStatus, Store, TimeframeGranularity, UUID } from '~/store';
import styles from './Projects.module.css';

/** A Space tap keeps Peek; a hold longer than this puts it away on release. */
const PEEK_HOLD_MS = 280;

interface ProjectRow {
  readonly id: UUID;
  readonly name: string;
  readonly icon: string | undefined;
  readonly color: string;
  readonly priority: number;
  readonly sortOrder: string;
  readonly updatedAt: string;
  readonly statusId: UUID;
  readonly statusName: string;
  readonly statusColor: string;
  /** Where the status sits in the workspace's own order, so groups line up as settings do. */
  readonly statusRank: number;
  readonly leadName: string | null;
  readonly leadId: UUID | undefined;
  readonly leadAvatar: string | null;
  /**
   * The team a project is filed under on this screen, which is one of possibly several.
   * A project on three teams is listed once, under the first team by name: the cursor and
   * the selection are keyed by row id, and a project drawn in three groups would be three
   * rows claiming to be one.
   */
  readonly teamId: UUID | null;
  readonly teamName: string | null;
  readonly issueCount: number;
  readonly progress: Progress;
  /** The next milestone with work left — the one the project is on right now. */
  readonly milestone: string | null;
  /** What the project is for, shown in the milestone's slot while there is no milestone. */
  readonly summary: string;
  readonly targetDate: string | undefined;
  readonly targetGranularity: TimeframeGranularity;
  /**
   * Completed work at the end of each week, cumulative, for the sparkline. Null when the
   * store has no history to draw — a project not yet in progress — so the cell stays
   * empty rather than showing a flat line that means nothing.
   */
  readonly sparkline: readonly number[] | null;
}

/** One heading and the rows under it. `key` is what the fold is remembered by. */
interface RowGroup {
  readonly key: string;
  readonly name: string;
  /** The band's glyph, where the grouping has one. */
  readonly glyph: ReactNode;
  /** Set when a drop on this heading means something: the priority it would write. */
  readonly dropPriority: number | null;
  readonly rows: readonly ProjectRow[];
}

const STATUS_PILLS: readonly { readonly value: ProjectStatusFilter; readonly label: string }[] = [
  { value: 'all', label: 'All projects' },
  ...PROJECT_STATUS_CATEGORIES.map((category) => ({
    value: category,
    label: PROJECT_STATUS_CATEGORY_LABELS[category],
  })),
];

/** The width of each optional column. Read into the grid template — see the module's CSS. */
const COLUMN_TRACKS: Readonly<Record<ProjectColumn, string>> = {
  health: 'var(--col-health)',
  priority: 'var(--col-priority)',
  lead: 'var(--col-lead)',
  targetDate: 'var(--col-target)',
  issues: 'var(--col-issues)',
  status: 'var(--col-status)',
};

const COLUMN_HEADINGS: Readonly<Record<ProjectColumn, string>> = {
  health: 'Health',
  priority: 'Priority',
  lead: 'Lead',
  targetDate: 'Target date',
  issues: 'Issues',
  status: 'Status',
};

const CURSOR_PREFIX = 'projects';
const PREFERENCE_KEY = 'projects';

export function Projects() {
  const engine = useEngine();
  const navigate = useNavigate();
  const { teamKey } = useParams<{ teamKey?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewer = useViewer();
  const viewerId = viewer?.id ?? null;
  const { registry, context } = useKeymap();
  const create = () => registry.invoke('project.create', { source: 'menu', context });
  const displayTrigger = useMenuTrigger();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<UUID | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  /** What the last export left out, or null. See the banner below the header. */
  const [exportNote, setExportNote] = useState<string | null>(null);
  /** The project a confirm is standing over, for the one menu item that cannot be undone. */
  const [archiving, setArchiving] = useState<ProjectRow | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const display = useMemo(() => resolveProjectDisplay(searchParams), [searchParams]);
  const displayChanges = changedProjectDisplayCount(display);

  // Filters live in the query string beside the display options, so a reload or a pasted
  // link shows what the sender was looking at rather than the layout without the filters.
  const filters = useMemo(() => resolveProjectFilters(searchParams), [searchParams]);

  const setFilters = useCallback(
    (patch: Partial<ProjectFilterOptions>) => {
      const next = { ...filters, ...patch };
      const params = new URLSearchParams(searchParams);
      for (const key of Object.values(PROJECT_FILTER_PARAMS)) params.delete(key);
      for (const [key, value] of Object.entries(toProjectFilterParams(next))) {
        params.set(key, value);
      }
      setSearchParams(params, { replace: true });
    },
    [filters, searchParams, setSearchParams],
  );

  const setDisplay = useCallback(
    (patch: Partial<ProjectDisplayOptions>) => {
      const next = { ...display, ...patch };
      const params = new URLSearchParams(searchParams);
      // Every parameter the display owns, from the table rather than from a list kept in
      // step by hand: an option added to the URL and forgotten here is one that could never
      // be turned back off.
      for (const key of Object.values(PROJECT_DISPLAY_PARAMS)) params.delete(key);
      for (const [key, value] of Object.entries(toProjectDisplayParams(next))) {
        params.set(key, value);
      }
      setSearchParams(params, { replace: true });
    },
    [display, searchParams, setSearchParams],
  );

  const team = useLiveQuery(
    (store) =>
      teamKey === undefined
        ? null
        : ([...store.teams.values()].find((candidate) => candidate.key === teamKey) ?? null),
    ['team'],
    [teamKey ?? ''],
  );

  const rows = useLiveQuery(
    (store) => listProjectRows(store, team?.id, filters),
    [
      'project',
      'projectStatus',
      'projectTeam',
      'projectMember',
      'projectMilestone',
      'projectUpdate',
      'projectDependency',
      'projectLabel',
      'projectLabelLink',
      'workspace',
      'issue',
      'workflowState',
      'user',
      'team',
      'customer',
      'customerRequest',
    ],
    [team?.id ?? '', filters.dependency, filters.customer, filters.status],
  );

  /** Every status in the workspace, in the workspace's order: the board's columns. */
  const statuses = useLiveQuery((store) => orderedStatuses(store), ['projectStatus']);

  const favourites = useLiveQuery(
    (store) =>
      viewerId === null
        ? new Set<UUID>()
        : new Set(
            [...store.projects.values()]
              .filter((project) => isFavorite(store, viewerId, 'project', project.id))
              .map((project) => project.id),
          ),
    ['favorite', 'project'],
    [viewerId ?? ''],
  );

  const customerOptions = useLiveQuery(
    (store) => projectCustomerFilterOptions(store),
    ['customer'],
  );
  const hideCustomers = viewer === null || viewer.role === 'guest';

  const heading = team === null ? 'Projects' : `${team.name} projects`;

  const groups = useMemo(
    () => groupRows(rows, display.grouping, display.ordering, display.direction),
    [rows, display.grouping, display.ordering, display.direction],
  );

  const columns = display.columns;
  // The sparkline column exists only when at least one row has a line to draw. A column of
  // empty cells is a promise the data is not keeping.
  const hasSparkline = rows.some((row) => row.sparkline !== null);
  const gridTemplate = useMemo(
    () =>
      [
        'minmax(0, 1fr)',
        ...columns.map((column) => COLUMN_TRACKS[column]),
        ...(hasSparkline ? ['var(--col-spark)'] : []),
      ].join(' '),
    [columns, hasSparkline],
  );

  /** Which groups are folded, so the cursor walks what is on screen and not what is not. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  const ids = useMemo(
    () =>
      display.layout === 'board'
        ? statuses.flatMap((status) =>
            rows.filter((row) => row.statusId === status.id).map((row) => row.id),
          )
        : groups.flatMap((group) =>
            collapsed.has(group.key) ? [] : group.rows.map((row) => row.id),
          ),
    [display.layout, statuses, rows, groups, collapsed],
  );

  useKeyContext('list');
  const cursor = useListCursor({
    ids,
    prefix: CURSOR_PREFIX,
    noun: 'project',
    onOpen: (id) => void navigate(`/project/${id}`),
  });

  const contextMenu = useContextMenu<UUID>({
    onOpen: (id) => cursor.setCursor(id),
    returnFocusTo: scrollerRef,
  });

  /*
    Peek, exactly as the issue list has it: a tap of Space keeps the panel, a hold is a
    glance that goes away on release, Enter is still the commitment that opens the project.

    The open state is mirrored into a ref because the registered actions read it at dispatch
    — `enabled` on the Escape binding decides whether Escape belongs to Peek or falls through
    to the screen behind it, and it has to be answered with what is true now.
  */
  const [peekOpen, setPeekOpen] = useState(false);
  const peekOpenRef = useRef(false);
  const peekHoldAt = useRef<number | null>(null);
  const setPeek = (open: boolean) => {
    peekOpenRef.current = open;
    setPeekOpen(open);
    // The list keeps the keyboard: Peek is a panel beside the rows, not a surface to move
    // into, so closing it puts focus back on the scroller the cursor lives on.
    if (!open) requestAnimationFrame(() => scrollerRef.current?.focus());
  };

  /**
   * The property picker a context-menu item opened, and where it hangs.
   *
   * Its own anchor rather than the context menu's: that one is unmounted the moment the menu
   * closes, and a picker positioned against a element that has gone lands in the corner.
   */
  const [picker, setPicker] = useState<{
    kind: 'status' | 'lead';
    row: ProjectRow;
    x: number;
    y: number;
  } | null>(null);
  const pickerAnchorRef = useRef<HTMLDivElement>(null);

  // An empty replica is not an empty workspace. Until the first sync settles, "No projects
  // yet" is a claim the client cannot make — and it came with an invitation to create one.
  const settled = useStoreSettled();

  // Whether the list is empty because there is nothing, or empty because the header's
  // dropdowns excluded everything. Without the distinction the screen tells somebody their
  // projects are gone and offers to make more — see the same flag in IssueList.
  const filtered = activeProjectFilterCount(filters) > 0;
  const clearFilters = useCallback(() => setFilters(DEFAULT_PROJECT_FILTERS), [setFilters]);

  const onDropOnRow = useCallback(
    async (target: ProjectRow) => {
      if (draggingId === null || draggingId === target.id) return;
      const store = engine.store;
      const moving = store.projects.get(draggingId);
      if (moving === undefined || store.projects.get(target.id) === undefined) return;
      try {
        await updateProject(engine, draggingId, {
          // The band is the drop's meaning only where the bands are what is on screen.
          // Grouped by lead, a row dropped under somebody else has not changed priority,
          // and writing one would be the list inventing an edit nobody made.
          ...(display.grouping === 'priority' ? { priority: target.priority } : null),
          afterProjectId: target.id,
        });
      } catch (error) {
        report(error);
      } finally {
        setDraggingId(null);
        setOverId(null);
      }
    },
    [draggingId, engine, display.grouping],
  );

  const onDropOnPriority = useCallback(
    async (priority: number) => {
      if (draggingId === null) return;
      try {
        await updateProject(engine, draggingId, { priority });
      } catch (error) {
        report(error);
      } finally {
        setDraggingId(null);
        setOverId(null);
      }
    },
    [draggingId, engine],
  );

  const onDropOnStatus = useCallback(
    async (statusId: UUID) => {
      if (draggingId === null) return;
      try {
        await updateProject(engine, draggingId, { statusId });
      } catch (error) {
        report(error);
      } finally {
        setDraggingId(null);
        setOverId(null);
      }
    },
    [draggingId, engine],
  );

  useActions(
    [
      {
        id: 'projects.peek',
        title: 'Peek project',
        keys: ['space'],
        when: 'list',
        group: 'Projects',
        ignoreRepeat: true,
        enabled: () => ids.length > 0,
        run: (ctx) => {
          if (ctx.source !== 'key') {
            setPeek(!peekOpenRef.current);
            return;
          }
          if (peekOpenRef.current) {
            setPeek(false);
            peekHoldAt.current = null;
            return;
          }
          setPeek(true);
          peekHoldAt.current = Date.now();
        },
        keyup: () => {
          const at = peekHoldAt.current;
          peekHoldAt.current = null;
          if (at !== null && Date.now() - at >= PEEK_HOLD_MS) setPeek(false);
        },
      },
      {
        id: 'projects.peek.close',
        title: 'Close peek',
        keys: ['Escape'],
        when: 'list',
        group: 'Projects',
        hidden: true,
        // Disabled reads as unbound, so with the panel shut Escape falls through to the
        // shell's dismiss rather than being swallowed by a command with nothing to do.
        enabled: () => peekOpenRef.current,
        run: () => setPeek(false),
      },
      {
        id: 'projects.exportCsv',
        title: 'Export projects as CSV',
        group: 'Projects',
        // Guests cannot export. The cap refuses them anyway; this is so the command is not
        // offered and then found to do nothing.
        enabled: () => viewer !== null && viewer.role !== 'guest',
        run: () => {
          const role: ExportRole = viewer?.role ?? 'member';
          const cap = exportCap(role, 'projects');
          if (cap === 0) return;
          const ids = rows.map((row) => row.id);
          const slug = heading.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
          downloadCsv(`${slug || 'projects'}.csv`, projectsToCsv(engine.store, ids.slice(0, cap)));
          setExportNote(exportCapNote(ids.length, cap, 'projects'));
        },
      },
    ],
    [engine, rows, heading, viewer, ids.length === 0],
  );

  const rowById = useCallback(
    (id: UUID | null): ProjectRow | null =>
      id === null ? null : (rows.find((row) => row.id === id) ?? null),
    [rows],
  );

  const copyLink = (id: UUID) => void copyText(`${window.location.origin}/project/${id}`);

  /** One menu, whichever way it was opened: right-click and the keyboard agree. */
  const itemsFor = (row: ProjectRow): MenuNode[] =>
    entityRowMenuItems(
      {
        noun: 'project',
        name: row.name,
        favorited: favourites.has(row.id),
      },
      {
        open: () => {
          contextMenu.close();
          void navigate(`/project/${row.id}`);
        },
        openIcon: <ProjectGlyph />,
        copyLink: () => {
          contextMenu.close();
          copyLink(row.id);
        },
        ...(viewerId === null
          ? {}
          : {
              toggleFavorite: () => {
                contextMenu.close();
                toggleFavorite(engine, viewerId, 'project', row.id).catch(report);
              },
            }),
        properties: [
          {
            id: 'status',
            label: 'Status…',
            keys: 's',
            onSelect: () => {
              const at = contextMenu.at;
              contextMenu.close();
              if (at !== null) setPicker({ kind: 'status', row, x: at.x, y: at.y });
            },
          },
          {
            id: 'lead',
            label: 'Lead…',
            keys: 'a',
            onSelect: () => {
              const at = contextMenu.at;
              contextMenu.close();
              if (at !== null) setPicker({ kind: 'lead', row, x: at.x, y: at.y });
            },
          },
        ],
        archive: () => {
          contextMenu.close();
          setArchiveError(null);
          setArchiving(row);
        },
      },
    );

  const contextRow = rowById(contextMenu.id);

  // A drop writes manual order, so it is offered only where manual order is what the list
  // is in. See the note the display menu puts under the ordering control.
  const draggable = display.ordering === 'manual' && display.layout === 'list';

  const rowLink = (row: ProjectRow) => (
    <ProjectRowLink
      store={engine.store}
      row={row}
      columns={columns}
      sparkline={hasSparkline}
      dragging={draggingId === row.id}
      over={overId === row.id}
      draggable={draggable}
      onSelect={() => cursor.setCursor(row.id)}
      onDragStart={() => setDraggingId(row.id)}
      onDragEnd={() => {
        setDraggingId(null);
        setOverId(null);
      }}
      onDragOver={(event) => {
        if (draggingId === null || draggingId === row.id) return;
        event.preventDefault();
        setOverId(row.id);
      }}
      onDragLeave={() => {
        if (overId === row.id) setOverId(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        // The group around the rows is the band's own drop target. Without this a drop on a
        // row would reorder it and then be told again, by the heading, to set the priority
        // it already has.
        event.stopPropagation();
        void onDropOnRow(row);
      }}
    />
  );

  return (
    <div className={`${styles.screen ?? ''} ${styles.enter ?? ''}`}>
      <header className={styles.header}>
        <h1 className={styles.title}>{heading}</h1>
        <Button variant="ghost" icon={<PlusGlyph />} onClick={create} className={styles.newProject}>
          New project
        </Button>
      </header>

      {/* The status filter as the row of pills every list view wears — one pressed at a
          time, the URL remembering which, and the shared control rather than this screen's
          own copy of it. The other two filters are rarer and keep their dropdowns at the
          far end of the row. */}
      <div className={styles.toolbar}>
        <SegmentedControl
          className={styles.pills}
          variant="bare"
          aria-label="Status"
          value={filters.status}
          onChange={(value) => setFilters({ status: value })}
          options={STATUS_PILLS.map((pill) => ({ value: pill.value, label: pill.label }))}
        />
        <div className={styles.toolbarEnd}>
          <ProjectDependencyFilterSelect
            value={filters.dependency}
            onChange={(value) => setFilters({ dependency: value })}
          />
          {hideCustomers ? null : (
            <Select
              aria-label="Customers"
              value={filters.customer}
              onChange={(event) =>
                setFilters({ customer: event.target.value as ProjectCustomerFilter })
              }
            >
              <option value="all">All customers</option>
              <option value="any">Has customer requests</option>
              <option value="none">No customer requests</option>
              {customerOptions.customers.length > 0 ? (
                <optgroup label="Customer">
                  {customerOptions.customers.map((customer) => (
                    <option key={customer.id} value={`customer:${customer.id}`}>
                      {customer.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {customerOptions.tiers.length > 0 ? (
                <optgroup label="Tier">
                  {customerOptions.tiers.map((tier) => (
                    <option key={tier} value={`tier:${tier}`}>
                      {tier}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          )}
          <Button {...displayTrigger.props} variant="ghost">
            Display{displayChanges > 0 ? ` · ${displayChanges}` : ''}
          </Button>
        </div>
      </div>

      {/* What the last export left out. On the screen rather than in a toast: it is the only
          record that the file in the downloads folder is a fragment, and it has to outlive
          the seconds a toast lasts. */}
      {exportNote === null ? null : (
        <div className={styles.exportNote} role="status">
          <p className={styles.exportNoteCopy}>{exportNote}</p>
          <Button size="sm" variant="ghost" onClick={() => setExportNote(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <ProjectDisplayMenu
        display={display}
        onChange={setDisplay}
        open={displayTrigger.open}
        onClose={displayTrigger.hide}
        trigger={displayTrigger.ref}
      />

      {/* The gate stands above the layout switch, not inside one branch of it. The timeline
          used to be returned before it and drew an unsettled replica as a plan with nothing
          in it.

          The layout and Peek share a flex row, the way the issue list's body does: the panel
          is a drawer beside the rows rather than over them, so the list narrows to make room
          and nothing the reader was looking at is covered up. */}
      <div className={styles.body}>
        {rows.length === 0 && !settled ? (
          <EntityLoading className={styles.loading} label="Loading projects…" lines={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filtered ? 'Nothing matches these filters' : 'No projects yet'}
            description={
              filtered
                ? 'Every project here is excluded by the filters above.'
                : 'A project is a unit of work with a clear outcome. Create one, then file issues into it with Shift+P.'
            }
            action={
              filtered ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear the filters
                </Button>
              ) : (
                <Button variant="primary" onClick={create}>
                  New project
                </Button>
              )
            }
          />
        ) : display.layout === 'timeline' ? (
          <ProjectTimeline
            teamId={team?.id}
            depFilter={filters.dependency}
            customerFilter={hideCustomers ? 'all' : filters.customer}
            statusFilter={filters.status}
            display={display}
            onClearFilters={clearFilters}
          />
        ) : display.layout === 'board' ? (
          <div
            ref={scrollerRef}
            className={styles.board}
            role="listbox"
            aria-label={heading}
            aria-activedescendant={
              cursor.cursorId === null ? undefined : listRowDomId(CURSOR_PREFIX, cursor.cursorId)
            }
            tabIndex={0}
          >
            {statuses.map((status) => {
              const columnRows = rows.filter((row) => row.statusId === status.id);
              const key = `status-${status.id}`;
              return (
                <section
                  key={status.id}
                  className={
                    overId === key ? `${styles.column} ${styles.columnOver}` : styles.column
                  }
                  aria-label={status.name}
                  onDragOver={(event) => {
                    if (draggingId === null) return;
                    event.preventDefault();
                    setOverId(key);
                  }}
                  onDragLeave={() => {
                    if (overId === key) setOverId(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    void onDropOnStatus(status.id);
                  }}
                >
                  <header className={styles.columnHead}>
                    <span
                      className={styles.columnDot}
                      aria-hidden="true"
                      // The status's own colour is workspace data, and no theme overrules it.
                      style={status.color === '' ? undefined : { color: status.color }}
                    />
                    <span className={styles.columnName}>{status.name}</span>
                    <span className={styles.groupCount}>{columnRows.length}</span>
                  </header>
                  <ul className={styles.columnList} role="presentation">
                    {columnRows.length === 0 ? (
                      // Kept on the board rather than dropped: an empty column is information,
                      // and a board whose columns come and go as work moves through it is one
                      // nobody can build a habit around.
                      <li role="presentation" className={styles.columnBlank}>
                        Nothing here
                      </li>
                    ) : (
                      columnRows.map((row) => (
                        <li
                          key={row.id}
                          {...cursor.rowProps(row.id)}
                          role="option"
                          className={styles.cardItem}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            contextMenu.openAt(event.clientX, event.clientY, row.id);
                          }}
                        >
                          <ProjectCard
                            row={row}
                            dragging={draggingId === row.id}
                            onSelect={() => cursor.setCursor(row.id)}
                            onDragStart={() => setDraggingId(row.id)}
                            onDragEnd={() => {
                              setDraggingId(null);
                              setOverId(null);
                            }}
                          />
                        </li>
                      ))
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <div
            ref={scrollerRef}
            className={styles.table}
            style={{ '--project-grid': gridTemplate } as CSSProperties}
            role="listbox"
            aria-label={heading}
            aria-activedescendant={
              cursor.cursorId === null ? undefined : listRowDomId(CURSOR_PREFIX, cursor.cursorId)
            }
            tabIndex={0}
          >
            <div className={styles.columns} aria-hidden="true">
              <span>Name</span>
              {columns.map((column) => (
                <span
                  key={column}
                  className={
                    column === 'issues'
                      ? styles.columnEnd
                      : column === 'targetDate'
                        ? styles.target
                        : undefined
                  }
                >
                  {COLUMN_HEADINGS[column]}
                </span>
              ))}
              {hasSparkline ? <span className={styles.spark} /> : null}
            </div>
            {groups.map((group) =>
              group.key === 'all' ? (
                <ul key={group.key} className={styles.groupList} role="presentation">
                  {group.rows.map((row) => (
                    <li
                      key={row.id}
                      {...cursor.rowProps(row.id)}
                      role="option"
                      onContextMenu={(event) => {
                        event.preventDefault();
                        contextMenu.openAt(event.clientX, event.clientY, row.id);
                      }}
                    >
                      {rowLink(row)}
                    </li>
                  ))}
                </ul>
              ) : (
                <div
                  key={group.key}
                  className={
                    overId === group.key ? `${styles.group} ${styles.groupOver}` : styles.group
                  }
                  onDragOver={(event) => {
                    if (draggingId === null || group.dropPriority === null) return;
                    event.preventDefault();
                    setOverId(group.key);
                  }}
                  onDragLeave={() => {
                    if (overId === group.key) setOverId(null);
                  }}
                  onDrop={(event) => {
                    if (group.dropPriority === null) return;
                    event.preventDefault();
                    void onDropOnPriority(group.dropPriority);
                  }}
                >
                  <ListGroup
                    groupKey={group.key}
                    preferenceKey={PREFERENCE_KEY}
                    name={group.name}
                    count={group.rows.length}
                    detail={group.glyph}
                    onToggle={(key, shut) =>
                      setCollapsed((held) => {
                        const next = new Set(held);
                        if (shut) next.add(key);
                        else next.delete(key);
                        return next;
                      })
                    }
                  >
                    {/* A real list inside the group, so a row is a list item as well as an
                      option: the outer scroller is the listbox and this only carries them. */}
                    <ul className={styles.groupList} role="presentation">
                      {group.rows.map((row) => (
                        <li
                          key={row.id}
                          {...cursor.rowProps(row.id)}
                          role="option"
                          onContextMenu={(event) => {
                            event.preventDefault();
                            contextMenu.openAt(event.clientX, event.clientY, row.id);
                          }}
                        >
                          {rowLink(row)}
                        </li>
                      ))}
                    </ul>
                  </ListGroup>
                </div>
              ),
            )}
          </div>
        )}

        <ProjectPeek open={peekOpen} projectId={cursor.cursorId} onClose={() => setPeek(false)} />
      </div>

      {contextMenu.at === null ? null : <div {...contextMenu.anchorProps} />}
      <Menu
        open={contextMenu.at !== null && contextRow !== null}
        onClose={contextMenu.close}
        trigger={contextMenu.anchorRef}
        label={contextRow === null ? 'Project options' : `Options for ${contextRow.name}`}
        keysPresentation="kbd"
        density="compact"
        items={contextRow === null ? [] : itemsFor(contextRow)}
      />

      {picker === null ? null : (
        <div
          ref={pickerAnchorRef}
          style={{
            position: 'fixed',
            width: 1,
            height: 1,
            pointerEvents: 'none',
            top: picker.y,
            left: picker.x,
          }}
        />
      )}
      <ProjectStatusPicker
        open={picker?.kind === 'status'}
        onClose={() => setPicker(null)}
        trigger={pickerAnchorRef}
        value={picker?.row.statusId}
        onSelect={(statusId) => {
          const row = picker?.row;
          setPicker(null);
          if (row !== undefined) updateProject(engine, row.id, { statusId }).catch(report);
        }}
      />
      <UserPicker
        open={picker?.kind === 'lead'}
        onClose={() => setPicker(null)}
        trigger={pickerAnchorRef}
        label="Lead"
        noneLabel="No lead"
        filterPlaceholder="Set lead…"
        value={picker?.row.leadId ?? null}
        onSelect={(leadId) => {
          const row = picker?.row;
          setPicker(null);
          if (row !== undefined) updateProject(engine, row.id, { leadId }).catch(report);
        }}
      />

      <ConfirmDialog
        open={archiving !== null}
        title={archiving === null ? 'Archive project?' : `Archive ${archiving.name}?`}
        consequence="Archived projects leave the list and every view that filters on them. Nothing is deleted, and an admin can restore it from Archives."
        confirmLabel="Archive project"
        destructive
        busy={archiveBusy}
        error={archiveError ?? undefined}
        onClose={() => {
          setArchiving(null);
          setArchiveError(null);
        }}
        onConfirm={() => {
          if (archiving === null) return;
          setArchiveBusy(true);
          setArchiveError(null);
          void archiveProject(engine, archiving.id).then(
            () => {
              setArchiveBusy(false);
              setArchiving(null);
            },
            (error: unknown) => {
              setArchiveBusy(false);
              setArchiveError(error instanceof Error ? error.message : 'Could not archive it.');
            },
          );
        }}
      />
    </div>
  );
}

interface RowLinkProps {
  readonly store: Store;
  readonly row: ProjectRow;
  readonly columns: readonly ProjectColumn[];
  readonly sparkline: boolean;
  readonly dragging: boolean;
  readonly over: boolean;
  readonly draggable: boolean;
  readonly onSelect: () => void;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onDragOver: (event: DragEvent<HTMLAnchorElement>) => void;
  readonly onDragLeave: () => void;
  readonly onDrop: (event: DragEvent<HTMLAnchorElement>) => void;
}

function ProjectRowLink({
  store,
  row,
  columns,
  sparkline,
  dragging,
  over,
  draggable,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: RowLinkProps) {
  const className = [styles.row, dragging ? styles.rowDragging : '', over ? styles.rowOver : '']
    .filter(Boolean)
    .join(' ');
  const done = `${row.progress.completed} of ${row.progress.total} issues completed`;

  return (
    <Link
      to={`/project/${row.id}`}
      className={className}
      draggable={draggable}
      onClick={onSelect}
      onDragStart={(event) => {
        onDragStart();
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className={styles.nameCell}>
        <span className={styles.icon} aria-hidden="true">
          {row.icon === undefined || row.icon === '' ? (
            <ProjectGlyph />
          ) : (
            <span style={row.color === '' ? undefined : { color: row.color }}>{row.icon}</span>
          )}
        </span>
        <span className={styles.name}>{row.name}</span>
        {row.milestone === null ? (
          row.summary === '' ? null : (
            <span className={styles.summary}>{row.summary}</span>
          )
        ) : (
          <span className={styles.milestone}>
            <MilestoneGlyph />
            {row.milestone}
          </span>
        )}
      </span>
      {columns.map((column) => {
        switch (column) {
          case 'health':
            return (
              <span key={column} className={styles.health}>
                <ProjectHealthCell store={store} projectId={row.id} compact />
              </span>
            );
          case 'priority':
            return (
              <span key={column} className={styles.priority}>
                <PriorityIcon priority={row.priority} />
              </span>
            );
          case 'lead':
            return (
              <span key={column} className={styles.lead}>
                {row.leadName === null ? (
                  <span className={styles.noLead} title="No lead">
                    <NoPersonGlyph />
                  </span>
                ) : (
                  <span title={row.leadName} className={styles.leadAvatar}>
                    <Avatar
                      name={row.leadName}
                      src={row.leadAvatar}
                      size="sm"
                      colorKey={row.leadId}
                    />
                  </span>
                )}
              </span>
            );
          case 'targetDate':
            return (
              <span key={column} className={styles.target}>
                {row.targetDate === undefined ? null : (
                  <>
                    <CalendarGlyph />
                    {formatTimeframe(row.targetDate, row.targetGranularity)}
                  </>
                )}
              </span>
            );
          case 'issues':
            return (
              <span key={column} className={styles.count}>
                {row.issueCount}
              </span>
            );
          case 'status':
            return (
              <span key={column} className={styles.status}>
                <ProgressRing
                  percent={row.progress.percent}
                  label={row.statusName}
                  detail={done}
                  // The status's own colour is workspace data, and no theme overrules it.
                  style={row.statusColor === '' ? undefined : { color: row.statusColor }}
                />
                <span aria-hidden="true">{row.progress.percent}%</span>
                {/* The ring names the status for assistive tech; this puts the word in the
                    row's text as well, so a search for it lands on the row. */}
                <span className={styles.srOnly}>{row.statusName}</span>
              </span>
            );
        }
      })}
      {sparkline ? (
        <span className={styles.spark}>
          {row.sparkline === null ? null : <Sparkline values={row.sparkline} />}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * One project on the board.
 *
 * A card rather than a row, and this is the one place in the product where that is correct:
 * the card is the unit being dragged from column to column, so it has to look liftable. It
 * carries what a column of 320px can hold and no more — the name, the lead, the target and
 * how far along it is. The rest is a click away on the project itself.
 *
 * Its own component and its own rules rather than the issue board's `Board.module.css`: that
 * column is a virtualised drop target for issue groups, its card is built around an
 * identifier and an assignee, and reusing the styles would have meant either importing a
 * stylesheet whose class names promise a component this is not, or refactoring the issue
 * board — which was rebuilt last round — to serve two callers. The tokens are the same, so
 * the two read as one product; the code is not shared, and that is deliberate.
 */
function ProjectCard({
  row,
  dragging,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  readonly row: ProjectRow;
  readonly dragging: boolean;
  readonly onSelect: () => void;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
}) {
  return (
    <Link
      to={`/project/${row.id}`}
      className={dragging ? `${styles.card} ${styles.cardDragging}` : styles.card}
      draggable
      onClick={onSelect}
      onDragStart={(event) => {
        onDragStart();
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={onDragEnd}
    >
      <span className={styles.cardTop}>
        <span className={styles.icon} aria-hidden="true">
          {row.icon === undefined || row.icon === '' ? (
            <ProjectGlyph />
          ) : (
            <span style={row.color === '' ? undefined : { color: row.color }}>{row.icon}</span>
          )}
        </span>
        <span className={styles.name}>{row.name}</span>
      </span>
      <span className={styles.cardMeta}>
        <PriorityIcon priority={row.priority} />
        {row.targetDate === undefined ? null : (
          <span className={styles.target}>
            <CalendarGlyph />
            {formatTimeframe(row.targetDate, row.targetGranularity)}
          </span>
        )}
        <span className={styles.cardSpacer} />
        <span className={styles.count}>{row.progress.percent}%</span>
        {row.leadName === null ? null : (
          <span title={row.leadName} className={styles.leadAvatar}>
            <Avatar name={row.leadName} src={row.leadAvatar} size="sm" colorKey={row.leadId} />
          </span>
        )}
      </span>
    </Link>
  );
}

/**
 * Completed work over the project's weeks, in forty pixels.
 *
 * Decorative: it repeats the status ring's number as a shape — flat, climbing, stalled —
 * and the ring's name already says the number. The last point is the current total, so
 * the line always ends at the percentage beside it.
 */
function Sparkline({ values }: { readonly values: readonly number[] }) {
  const width = 40;
  const height = 14;
  const max = Math.max(...values, 1);
  const last = Math.max(values.length - 1, 1);
  const points = values
    .map((value, index) => {
      const x = (index / last) * (width - 2) + 1;
      const y = height - 1 - (value / max) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <polyline points={points} />
    </svg>
  );
}

/** Every status in the workspace, in the order the settings screen lists them. */
function orderedStatuses(store: Store): ProjectStatus[] {
  return [...store.projectStatuses.values()]
    .filter((status) => status.archivedAt === undefined)
    .sort((a, b) => {
      const byCategory =
        PROJECT_STATUS_CATEGORIES.indexOf(a.category) -
        PROJECT_STATUS_CATEGORIES.indexOf(b.category);
      return byCategory !== 0 ? byCategory : compareOrderKeys(a.position, b.position);
    });
}

function listProjectRows(
  store: Store,
  teamId: UUID | undefined,
  filters: ProjectFilterOptions,
): ProjectRow[] {
  const statusRank = new Map(orderedStatuses(store).map((status, index) => [status.id, index]));
  const projects: Project[] = [];
  for (const project of store.projects.values()) {
    if (project.archivedAt !== undefined || project.deletedAt !== undefined) continue;
    if (!matchesDependencyFilter(store, project.id, filters.dependency)) continue;
    if (!matchesProjectCustomerFilter(store, project.id, filters.customer)) continue;
    if (!matchesProjectStatusFilter(store, project.id, filters.status)) continue;
    if (teamId !== undefined) {
      const onTeam = [...store.projectTeamIdsFor(project.id)].some(
        (id) => store.projectTeams.get(id)?.teamId === teamId,
      );
      if (!onTeam) continue;
    }
    projects.push(project);
  }

  return projects.map((project) => {
    const status: ProjectStatus | undefined = store.projectStatuses.get(project.statusId);
    const lead = project.leadId === undefined ? undefined : store.users.get(project.leadId);
    const graph = buildProjectGraph(store, project.id);
    const home = homeTeam(store, project.id);
    return {
      id: project.id,
      name: project.name,
      icon: project.icon,
      color: project.color,
      priority: project.priority,
      sortOrder: project.sortOrder,
      updatedAt: project.updatedAt,
      statusId: project.statusId,
      statusName: status?.name ?? 'No status',
      statusColor: status?.color ?? project.color,
      statusRank: statusRank.get(project.statusId) ?? statusRank.size,
      leadName: lead?.displayName ?? null,
      leadId: project.leadId,
      leadAvatar: lead?.avatarUrl ?? null,
      teamId: home?.id ?? null,
      teamName: home?.name ?? null,
      issueCount: store.index.byProject(project.id).size,
      progress: projectProgress(store, project.id),
      milestone:
        listProjectMilestones(store, project.id).find((candidate) => candidate.current)?.milestone
          .name ?? null,
      summary: project.summary ?? '',
      targetDate: project.targetDate,
      targetGranularity: project.targetDateGranularity ?? 'day',
      sparkline:
        graph === null || graph.weeks.length < 2 ? null : graph.weeks.map((week) => week.completed),
    };
  });
}

/** The team a project is filed under here: the first by name, of however many it is on. */
function homeTeam(store: Store, projectId: UUID): { id: UUID; name: string } | null {
  const teams: { id: UUID; name: string }[] = [];
  for (const linkId of store.projectTeamIdsFor(projectId)) {
    const teamId = store.projectTeams.get(linkId)?.teamId;
    if (teamId === undefined) continue;
    const team = store.teams.get(teamId);
    if (team !== undefined) teams.push({ id: team.id, name: team.name });
  }
  teams.sort((a, b) => a.name.localeCompare(b.name));
  return teams[0] ?? null;
}

/** What one row is grouped under, and how that group sorts against the others. */
interface GroupKey {
  readonly key: string;
  readonly name: string;
  readonly rank: number;
  readonly glyph: ReactNode;
  readonly dropPriority: number | null;
}

function groupKeyOf(row: ProjectRow, grouping: ProjectGrouping): GroupKey {
  switch (grouping) {
    case 'status':
      return {
        key: `status-${row.statusId}`,
        name: row.statusName,
        rank: row.statusRank,
        glyph: null,
        dropPriority: null,
      };
    case 'lead':
      // Nobody sorts last, and is a group rather than an omission: "unassigned" is the
      // answer to "whose is this" that most needs to be visible.
      return {
        key: row.leadId === undefined ? 'lead-none' : `lead-${row.leadId}`,
        name: row.leadName ?? 'No lead',
        rank: row.leadName === null ? Number.MAX_SAFE_INTEGER : 0,
        glyph: null,
        dropPriority: null,
      };
    case 'team':
      return {
        key: row.teamId === null ? 'team-none' : `team-${row.teamId}`,
        name: row.teamName ?? 'No team',
        rank: row.teamName === null ? Number.MAX_SAFE_INTEGER : 0,
        glyph: null,
        dropPriority: null,
      };
    case 'priority':
      return {
        key: `priority-${row.priority}`,
        name: priorityLabel(row.priority),
        rank: PRIORITY_LEVELS.indexOf(row.priority),
        glyph: <PriorityIcon priority={row.priority} decorative />,
        dropPriority: row.priority,
      };
    case 'none':
      return { key: 'all', name: 'All projects', rank: 0, glyph: null, dropPriority: null };
  }
}

/** `undefined` sorts last whichever way the direction points: absence is not a small date. */
function compareOptional(a: string | undefined, b: string | undefined): number | null {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return null;
}

export function groupRows(
  rows: readonly ProjectRow[],
  grouping: ProjectGrouping,
  ordering: ProjectOrdering,
  direction: ProjectDirection,
): RowGroup[] {
  const sign = direction === 'desc' ? -1 : 1;

  const compare = (a: ProjectRow, b: ProjectRow): number => {
    switch (ordering) {
      case 'name':
        return sign * a.name.localeCompare(b.name);
      case 'targetDate': {
        const absent = compareOptional(a.targetDate, b.targetDate);
        if (absent !== null) return absent === 0 ? 0 : absent;
        return sign * (a.targetDate ?? '').localeCompare(b.targetDate ?? '');
      }
      case 'priority': {
        const rank = PRIORITY_LEVELS.indexOf(a.priority) - PRIORITY_LEVELS.indexOf(b.priority);
        return sign * rank;
      }
      case 'updated':
        return sign * a.updatedAt.localeCompare(b.updatedAt);
      default: {
        // Manual: the arrangement people drag rows into. Ungrouped it still leads with the
        // priority band, because that is the order the drag writes into.
        const byPriority =
          grouping === 'none'
            ? PRIORITY_LEVELS.indexOf(a.priority) - PRIORITY_LEVELS.indexOf(b.priority)
            : 0;
        if (byPriority !== 0) return sign * byPriority;
        if (a.sortOrder !== b.sortOrder) return sign * (a.sortOrder < b.sortOrder ? -1 : 1);
        return sign * a.name.localeCompare(b.name);
      }
    }
  };

  const buckets = new Map<string, { key: GroupKey; rows: ProjectRow[] }>();
  for (const row of rows) {
    const key = groupKeyOf(row, grouping);
    const bucket = buckets.get(key.key) ?? { key, rows: [] };
    bucket.rows.push(row);
    buckets.set(key.key, bucket);
  }

  return [...buckets.values()]
    .sort((a, b) =>
      a.key.rank !== b.key.rank ? a.key.rank - b.key.rank : a.key.name.localeCompare(b.key.name),
    )
    .map((bucket) => ({
      key: bucket.key.key,
      name: bucket.key.name,
      glyph: bucket.key.glyph,
      dropPriority: bucket.key.dropPriority,
      rows: [...bucket.rows].sort(compare),
    }));
}
