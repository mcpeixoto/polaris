/**
 * Workspace initiatives list — objectives grouping curated projects, nested under parents.
 *
 * The same table the projects list draws, because an initiative is read for the same
 * things a project is: what it is, whether it is in trouble, who owns it, when it is due,
 * how far along it is. The status filter in the toolbar rides in the URL, so a shared link
 * shows what its sender was looking at, and so do the display options beside it.
 *
 * It is a tree, and that is the one thing this list does that no other list does. A parent
 * carries a chevron and folds its descendants away, remembered per person in `localStorage`
 * the way every other folded group on every other screen is (`features/view/collapse`).
 * Before that a deep tree was a wall of indented rows with no way to shut any of it, which
 * is the state a hierarchy is least useful in.
 *
 * The tree survives only while the rows on screen are the whole tree. A status filter can
 * remove a parent and leave its child behind, and a grouping puts a row under a heading its
 * parent may not share — in both cases an indent points at nothing and a chevron folds rows
 * that are not below it. So both flatten the list, `isFlatList` is the single place that
 * decides it, and the chevrons go away with the indents rather than lying.
 *
 * The keyboard is the issue list's, through `useListCursor`: `j`/`k` move, Enter opens,
 * right-click opens the same menu the row's own affordances offer. A row is keyed by the
 * path that reached it rather than by its id — an initiative may have two parents, and the
 * same initiative under two of them is two rows the cursor has to tell apart.
 */

import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeymap, useKeyContext } from '~/app/keymap';
import {
  Avatar,
  Button,
  ConfirmDialog,
  EmptyState,
  LabelChip,
  ListGroup,
  Menu,
  SegmentedControl,
  StateIcon,
  Tooltip,
  type MenuNode,
} from '~/components';
import { copyText } from '~/features/github/copy';
import { EntityLoading, useStoreSettled } from '~/features/entity-gate/EntityGate';
import {
  downloadCsv,
  exportCap,
  exportCapNote,
  initiativesToCsv,
  type ExportRole,
} from '~/features/export/csv';
import { report } from '~/features/issue/mutations';
import { ChevronGlyph } from '~/components/glyphs';
import {
  archiveInitiative,
  formatInitiativeStatus,
  INITIATIVE_STATUS_ICON,
} from '~/features/initiatives/mutations';
import {
  changedInitiativeDisplayCount,
  isFlatList,
  resolveInitiativeDisplay,
  toInitiativeDisplayParams,
  INITIATIVE_DISPLAY_PARAMS,
  type InitiativeDisplayOptions,
  type InitiativeOrderBy,
  type RequiredInitiativeDisplay,
} from '~/features/initiatives/display';
import { InitiativeDisplayMenu } from '~/features/initiatives/InitiativeDisplayMenu';
import { InitiativeGlyph } from '~/features/initiatives/glyphs';
import { initiativeProgress, type Progress } from '~/features/initiatives/progress';
import { ProgressBar } from '~/features/initiatives/ProgressBar';
import { personName } from '~/features/prefs/prefs';
import { whenDay } from '~/features/time';
import { CalendarGlyph, NoPersonGlyph, PlusGlyph } from '~/features/projects/glyphs';
import { formatTimeframe } from '~/features/projects/properties';
import { ActiveProjectsHealth } from '~/features/initiative-updates/ActiveProjectsHealth';
import {
  latestInitiativeUpdate,
  linkedProjectHealths,
  type LinkedProjectHealth,
} from '~/features/initiative-updates/helpers';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { updateAge } from '~/features/project-updates/helpers';
import { isFavorite, toggleFavorite } from '~/features/view/mutations';
import { readCollapsed, writeCollapsed } from '~/features/view/collapse';
import { entityRowMenuItems } from '~/features/entity/entityRowMenu';
import { useContextMenu } from '~/hooks/useContextMenu';
import { useListCursor, listRowDomId, type ListRowProps } from '~/hooks/useListCursor';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import { byOrderKeyThen } from '~/store';
import type {
  Initiative,
  InitiativeLabel,
  InitiativeStatus,
  ProjectUpdateHealth,
  Store,
  TimeframeGranularity,
  UUID,
} from '~/store';
import styles from './Initiatives.module.css';

interface InitiativeRow {
  readonly id: UUID;
  readonly name: string;
  readonly status: InitiativeStatus;
  readonly health: ProjectUpdateHealth | null;
  /** When the latest update was posted, for the age beside the health word. */
  readonly healthAt: string | null;
  readonly projects: readonly LinkedProjectHealth[];
  readonly labels: readonly InitiativeLabel[];
  readonly ownerName: string | null;
  readonly ownerId: UUID | undefined;
  readonly ownerAvatar: string | null;
  readonly targetDate: string | undefined;
  readonly targetGranularity: TimeframeGranularity | undefined;
  readonly progress: Progress;
  readonly depth: number;
  /** Whether anything hangs below this row, which is what earns it a chevron. */
  readonly hasChildren: boolean;
  /**
   * The chain of initiatives that reached this row, as one string.
   *
   * The id is not a key here: an initiative may have several parents, so the same child is
   * visited once per parent and two root parents put it at the same depth twice. Keying by
   * `id:depth` collided on exactly that, and React then carried focus and scroll between
   * two rows that are not the same row.
   *
   * It is also what a fold is remembered by, for the same reason: shutting one parent must
   * not shut the same initiative where it appears under another.
   */
  readonly path: string;
}

/** A run of rows under one heading, when the display options ask for headings. */
interface RowGroup {
  readonly key: string;
  readonly name: string;
  readonly rows: readonly InitiativeRow[];
}

/** How many label chips fit the cell before the rest become a count. */
const LABELS_SHOWN = 2;

/** Which screen's folds these are. One list, one bucket — see `features/view/collapse`. */
const PREFERENCE_KEY = 'initiatives';

export type InitiativeStatusFilter = 'all' | InitiativeStatus;

const STATUS_PILLS: readonly { readonly value: InitiativeStatusFilter; readonly label: string }[] =
  [
    { value: 'all', label: 'All initiatives' },
    ...(['proposed', 'planned', 'active', 'completed', 'canceled'] as const).map((status) => ({
      value: status,
      label: formatInitiativeStatus(status),
    })),
  ];

/** The `status` query parameter, or "all" for anything that is not a status. */
export function resolveInitiativeStatusFilter(params: URLSearchParams): InitiativeStatusFilter {
  const value = params.get('status');
  return STATUS_PILLS.some((pill) => pill.value === value)
    ? (value as InitiativeStatusFilter)
    : 'all';
}

export function Initiatives() {
  const engine = useEngine();
  const navigate = useNavigate();
  const viewer = useViewer();
  const { registry, context } = useKeymap();
  const create = () => registry.invoke('initiative.create', { source: 'menu', context });
  const [searchParams, setSearchParams] = useSearchParams();
  const status = useMemo(() => resolveInitiativeStatusFilter(searchParams), [searchParams]);
  const display = useMemo(() => resolveInitiativeDisplay(searchParams), [searchParams]);
  const displayChanges = changedInitiativeDisplayCount(display);
  const displayTrigger = useMenuTrigger();
  const scrollerRef = useRef<HTMLDivElement>(null);
  /** What the last export left out, or null. See the note below the toolbar. */
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<{ id: string; name: string } | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const flat = isFlatList(display.grouping, status !== 'all');

  const setStatus = useCallback(
    (next: InitiativeStatusFilter) => {
      const params = new URLSearchParams(searchParams);
      if (next === 'all') params.delete('status');
      else params.set('status', next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setDisplay = useCallback(
    (patch: Partial<InitiativeDisplayOptions>) => {
      const next: RequiredInitiativeDisplay = { ...display, ...patch };
      const params = new URLSearchParams(searchParams);
      for (const key of Object.values(INITIATIVE_DISPLAY_PARAMS)) params.delete(key);
      for (const [key, value] of Object.entries(toInitiativeDisplayParams(next))) {
        params.set(key, value);
      }
      setSearchParams(params, { replace: true });
    },
    [display, searchParams, setSearchParams],
  );

  const rows = useLiveQuery(
    (store) => listInitiatives(store, status, display.ordering, flat),
    [
      'initiative',
      'initiativeProject',
      'initiativeUpdate',
      'initiativeLabel',
      'initiativeLabelLink',
      'initiativeRelation',
      'issue',
      'project',
      'projectUpdate',
      'user',
    ],
    [status, display.ordering, flat],
  );

  // Held in state as well as in storage: the fold has to re-render the list, and the rows
  // the cursor may land on are the rows that are not inside a shut parent.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() =>
    readCollapsed(PREFERENCE_KEY),
  );

  const toggleCollapsed = useCallback((path: string) => {
    setCollapsed((held) => {
      const next = new Set(held);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      // Read-modify-write against storage rather than against `next`, because other screens
      // share nothing here but this one screen's own key may have been written by another
      // tab since it was read.
      const stored = new Set(readCollapsed(PREFERENCE_KEY));
      if (stored.has(path)) stored.delete(path);
      else stored.add(path);
      writeCollapsed(PREFERENCE_KEY, stored);
      return next;
    });
  }, []);

  const visible = useMemo(
    () =>
      flat
        ? rows
        : rows.filter((row) => {
            for (const shut of collapsed) {
              if (row.path.startsWith(`${shut}/`)) return false;
            }
            return true;
          }),
    [rows, collapsed, flat],
  );

  const groups = useMemo(() => groupRows(visible, display.grouping), [visible, display.grouping]);

  // The cursor walks paths, not ids: two rows may be the same initiative under two parents,
  // and a cursor that could not tell them apart would jump between them on every `j`.
  const paths = useMemo(() => visible.map((row) => row.path), [visible]);
  const byPath = useMemo(() => new Map(visible.map((row) => [row.path, row] as const)), [visible]);

  const open = useCallback(
    (path: string) => {
      const row = byPath.get(path);
      if (row !== undefined) void navigate(`/initiative/${row.id}`);
    },
    [byPath, navigate],
  );

  useKeyContext('list');
  const cursor = useListCursor({
    ids: paths,
    prefix: 'initiativeList',
    noun: 'initiative',
    onOpen: open,
  });

  const contextMenu = useContextMenu<string>({
    onOpen: (path) => cursor.setCursor(path),
    returnFocusTo: scrollerRef,
  });
  const contextRow = contextMenu.id === null ? null : (byPath.get(contextMenu.id) ?? null);

  useActions(
    [
      {
        id: 'initiatives.exportCsv',
        title: 'Export initiatives as CSV',
        group: 'Initiatives',
        // Guests cannot export. The cap refuses them anyway; this is so the command is not
        // offered and then found to do nothing.
        enabled: () => viewer !== null && viewer.role !== 'guest',
        run: () => {
          const role: ExportRole = viewer?.role ?? 'member';
          const cap = exportCap(role, 'initiatives');
          if (cap === 0) return;
          // The rows on screen, deduplicated: an initiative under two parents is two rows
          // and one initiative, and a file with it twice is a file somebody has to clean.
          const ids = [...new Set(visible.map((row) => row.id))];
          downloadCsv('initiatives.csv', initiativesToCsv(engine.store, ids.slice(0, cap)));
          setExportNote(exportCapNote(ids.length, cap, 'initiatives'));
        },
      },
    ],
    [engine, visible, viewer],
  );

  const favorited =
    viewer !== null && contextRow !== null
      ? isFavorite(engine.store, viewer.id, 'initiative', contextRow.id)
      : false;

  const contextItems: MenuNode[] =
    contextRow === null
      ? []
      : entityRowMenuItems(
          { noun: 'initiative', name: contextRow.name, favorited },
          {
            open: () => {
              contextMenu.close();
              void navigate(`/initiative/${contextRow.id}`);
            },
            openIcon: <InitiativeGlyph />,
            copyLink: () => {
              contextMenu.close();
              void copyText(`${window.location.origin}/initiative/${contextRow.id}`);
            },
            toggleFavorite: () => {
              contextMenu.close();
              if (viewer === null) return;
              void toggleFavorite(engine, viewer.id, 'initiative', contextRow.id).catch(report);
            },
            archive: () => {
              contextMenu.close();
              setArchiving({ id: contextRow.id, name: contextRow.name });
            },
          },
        );

  // An empty replica is not an empty workspace. Until the first sync settles, "No initiatives
  // yet" is a claim the client cannot make — and it came with an invitation to create one.
  const settled = useStoreSettled();

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Initiatives</h1>
        <Button
          variant="ghost"
          icon={<PlusGlyph />}
          onClick={create}
          className={styles.newInitiative}
        >
          New initiative
        </Button>
      </header>

      <div className={styles.toolbar}>
        <SegmentedControl
          className={styles.pills}
          variant="bare"
          aria-label="Status"
          value={status}
          onChange={setStatus}
          options={STATUS_PILLS}
        />
        <div className={styles.toolbarEnd}>
          <Button {...displayTrigger.props} variant="ghost">
            Display{displayChanges > 0 ? ` · ${displayChanges}` : ''}
          </Button>
        </div>
      </div>

      {/* What the last export left out. On the screen rather than in a toast: it is the only
          record that the file in the downloads folder is a fragment. */}
      {exportNote === null ? null : (
        <div className={styles.exportNote} role="status">
          <p className={styles.exportNoteCopy}>{exportNote}</p>
          <Button size="sm" variant="ghost" onClick={() => setExportNote(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <InitiativeDisplayMenu
        display={display}
        onChange={setDisplay}
        open={displayTrigger.open}
        onClose={displayTrigger.hide}
        trigger={displayTrigger.ref}
      />

      {rows.length === 0 && !settled ? (
        <EntityLoading className={styles.loading} label="Loading initiatives…" lines={6} />
      ) : rows.length === 0 && status !== 'all' ? (
        <EmptyState
          title="Nothing matches this filter"
          description="Every initiative here has a different status."
          action={
            <Button variant="secondary" onClick={() => setStatus('all')}>
              Show all initiatives
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No initiatives yet"
          description="An initiative is a curated set of projects tied to one objective. Use it when you need to track work over time, not just filter what matches today."
          action={
            <Button variant="primary" onClick={create}>
              New initiative
            </Button>
          }
        />
      ) : (
        <div
          className={styles.table}
          ref={scrollerRef}
          role="listbox"
          aria-label="Initiatives"
          aria-activedescendant={
            cursor.cursorId === null ? undefined : listRowDomId('initiativeList', cursor.cursorId)
          }
          tabIndex={0}
        >
          <div className={columnsClass(display)} aria-hidden="true">
            <span>Name</span>
            {display.columns.includes('labels') ? <span>Labels</span> : null}
            <span>Status</span>
            {display.columns.includes('health') ? <span>Health</span> : null}
            <span>Projects</span>
            <span>Owner</span>
            {display.columns.includes('targetDate') ? <span>Target date</span> : null}
            {display.columns.includes('progress') ? <span>Progress</span> : null}
          </div>
          {groups.map((group) => {
            const list = (
              <ul className={styles.list} role="presentation">
                {group.rows.map((row) => (
                  <Row
                    key={row.path}
                    row={row}
                    display={display}
                    flat={flat}
                    collapsed={collapsed.has(row.path)}
                    cursorProps={cursor.rowProps(row.path)}
                    onCursor={() => cursor.setCursor(row.path)}
                    onToggle={() => toggleCollapsed(row.path)}
                    onContextMenu={(x, y) => contextMenu.openAt(x, y, row.path)}
                  />
                ))}
              </ul>
            );
            return group.key === '' ? (
              <div key="all">{list}</div>
            ) : (
              <ListGroup
                key={group.key}
                groupKey={group.key}
                preferenceKey={PREFERENCE_KEY}
                name={group.name}
                count={group.rows.length}
              >
                {list}
              </ListGroup>
            );
          })}
        </div>
      )}

      {contextMenu.at === null ? null : <div {...contextMenu.anchorProps} />}
      <Menu
        open={contextMenu.at !== null && contextRow !== null}
        onClose={contextMenu.close}
        trigger={contextMenu.anchorRef}
        label={contextRow === null ? 'Initiative options' : `Options for ${contextRow.name}`}
        keysPresentation="kbd"
        density="compact"
        items={contextItems}
      />

      <ConfirmDialog
        open={archiving !== null}
        title={archiving === null ? 'Archive initiative?' : `Archive ${archiving.name}?`}
        consequence="Archived initiatives leave the list. Nothing is deleted, and an admin can restore them from Archives."
        confirmLabel="Archive initiative"
        destructive
        busy={archiveBusy}
        onClose={() => {
          if (archiveBusy) return;
          setArchiving(null);
        }}
        onConfirm={() => {
          if (archiving === null) return;
          setArchiveBusy(true);
          void archiveInitiative(engine, archiving.id)
            .then(() => {
              setArchiveBusy(false);
              setArchiving(null);
            })
            .catch((error) => {
              setArchiveBusy(false);
              report(error);
            });
        }}
      />
    </div>
  );
}

interface RowProps {
  readonly row: InitiativeRow;
  readonly display: RequiredInitiativeDisplay;
  readonly flat: boolean;
  readonly collapsed: boolean;
  readonly cursorProps: ListRowProps;
  onCursor(): void;
  onToggle(): void;
  onContextMenu(x: number, y: number): void;
}

function Row({
  row,
  display,
  flat,
  collapsed,
  cursorProps,
  onCursor,
  onToggle,
  onContextMenu,
}: RowProps) {
  // The chevron is a command of its own and cannot live inside the link that opens the
  // initiative, so the row is a flex line: disclosure, then the grid of cells. The indent
  // is on the line rather than on the link, which keeps the cells aligned across depths.
  return (
    <li
      {...cursorProps}
      role="option"
      className={[styles.item, collapsed ? styles.itemShut : null].filter(Boolean).join(' ')}
      style={flat ? undefined : ({ '--depth': row.depth } as CSSProperties)}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event.clientX, event.clientY);
      }}
    >
      {flat || !row.hasChildren ? (
        <span className={styles.disclosureSpacer} aria-hidden="true" />
      ) : (
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${row.name}`}
          onClick={onToggle}
        >
          <span
            className={[styles.chevron, collapsed ? styles.chevronShut : null]
              .filter(Boolean)
              .join(' ')}
            aria-hidden="true"
          >
            <ChevronGlyph />
          </span>
        </button>
      )}
      <Link to={`/initiative/${row.id}`} className={rowClass(display)} onClick={onCursor}>
        <span className={styles.nameCell}>
          <span className={styles.icon} aria-hidden="true">
            <InitiativeGlyph />
          </span>
          <span className={styles.name}>{row.name}</span>
        </span>
        {/* Past two chips the rest become a count, which is the one thing that cannot
            overflow a fixed-height row. */}
        {display.columns.includes('labels') ? (
          <span className={styles.labels}>
            {row.labels.slice(0, LABELS_SHOWN).map((label) => (
              <LabelChip key={label.id} name={label.name} color={label.color} compact />
            ))}
            {row.labels.length > LABELS_SHOWN && (
              <Tooltip
                label={row.labels
                  .slice(LABELS_SHOWN)
                  .map((label) => label.name)
                  .join(', ')}
              >
                <span className={styles.labelsMore}>+{row.labels.length - LABELS_SHOWN}</span>
              </Tooltip>
            )}
          </span>
        ) : null}
        <span className={styles.status}>
          <StateIcon category={INITIATIVE_STATUS_ICON[row.status]} decorative />
          {formatInitiativeStatus(row.status)}
        </span>
        {display.columns.includes('health') ? (
          <span className={styles.health}>
            {row.health === null ? (
              <span className={styles.muted}>No updates</span>
            ) : (
              <ProjectHealthBadge
                health={row.health}
                compact
                since={row.healthAt === null ? undefined : updateAge(row.healthAt)}
              />
            )}
          </span>
        ) : null}
        <span className={styles.projects}>
          <ActiveProjectsHealth projects={row.projects} />
        </span>
        <span className={styles.owner}>
          {row.ownerName === null ? (
            <Tooltip label="No owner">
              <span className={styles.noOwner}>
                <NoPersonGlyph />
              </span>
            </Tooltip>
          ) : (
            <>
              <Avatar
                name={row.ownerName}
                src={row.ownerAvatar}
                size="sm"
                colorKey={row.ownerId}
                decorative
              />
              <span className={styles.ownerName}>{row.ownerName}</span>
            </>
          )}
        </span>
        {display.columns.includes('targetDate') ? (
          <span className={styles.target}>
            {row.targetDate === undefined ? (
              <span className={styles.muted}>No target</span>
            ) : (
              <>
                <CalendarGlyph />
                {formatTarget(row.targetDate, row.targetGranularity)}
              </>
            )}
          </span>
        ) : null}
        {display.columns.includes('progress') ? (
          <span className={styles.progress}>
            <ProgressBar progress={row.progress} label={row.name} compact />
          </span>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * The grid template, as a class per set of columns turned off.
 *
 * The column header and the rows share it — one template, so the two cannot drift — and the
 * modifiers are additive, because four independent toggles are sixteen templates and only
 * four rules.
 */
function gridClasses(display: RequiredInitiativeDisplay): string[] {
  return [
    display.columns.includes('labels') ? null : styles.noLabels,
    display.columns.includes('health') ? null : styles.noHealth,
    display.columns.includes('targetDate') ? null : styles.noTarget,
    display.columns.includes('progress') ? null : styles.noProgress,
  ].filter((name): name is string => typeof name === 'string');
}

function columnsClass(display: RequiredInitiativeDisplay): string {
  return [styles.columns, ...gridClasses(display)].join(' ');
}

function rowClass(display: RequiredInitiativeDisplay): string {
  return [styles.row, ...gridClasses(display)].join(' ');
}

/**
 * A day target reads the way every other date in the product does; a coarser one — "Q3
 * 2026" — reads at the precision it was set with, which `whenDay` cannot express.
 */
function formatTarget(day: string, granularity: TimeframeGranularity | undefined): string {
  return granularity === undefined || granularity === 'day'
    ? whenDay(day)
    : formatTimeframe(day, granularity);
}

/**
 * The rows under their headings, or one nameless group holding all of them.
 *
 * A group with no key is drawn without a `ListGroup`, so the ungrouped list is the rows and
 * nothing else — a heading reading "Initiatives" above every initiative is a row of pixels
 * that says what the page title already said.
 */
function groupRows(rows: readonly InitiativeRow[], grouping: string): RowGroup[] {
  if (grouping === 'none') return [{ key: '', name: '', rows }];

  const buckets = new Map<string, { name: string; rows: InitiativeRow[] }>();
  for (const row of rows) {
    const [key, name] =
      grouping === 'status'
        ? [row.status, formatInitiativeStatus(row.status)]
        : [row.ownerId ?? 'no-owner', row.ownerName ?? 'No owner'];
    const bucket = buckets.get(key) ?? { name, rows: [] };
    bucket.rows.push(row);
    buckets.set(key, bucket);
  }

  const groups = [...buckets].map(([key, bucket]) => ({
    key,
    name: bucket.name,
    rows: bucket.rows,
  }));
  // Status keeps the product's order — proposed through canceled — and owners are
  // alphabetical with "No owner" last, where an absence belongs.
  if (grouping === 'status') {
    const order = STATUS_PILLS.map((pill) => pill.value);
    groups.sort((a, b) => order.indexOf(a.key as never) - order.indexOf(b.key as never));
  } else {
    groups.sort((a, b) =>
      a.key === 'no-owner' ? 1 : b.key === 'no-owner' ? -1 : a.name.localeCompare(b.name),
    );
  }
  return groups;
}

/** How siblings are arranged. Manual is the workspace's own order, which is the default. */
function comparatorFor(
  store: Store,
  ordering: InitiativeOrderBy,
): (a: Initiative, b: Initiative) => number {
  switch (ordering) {
    case 'name':
      return (a, b) => a.name.localeCompare(b.name);
    case 'updated':
      return (a, b) => b.updatedAt.localeCompare(a.updatedAt);
    case 'targetDate':
      // No target sorts last: a date somebody has committed to is the thing this ordering
      // was asked for, and an initiative without one is not "due first".
      return (a, b) =>
        a.targetDate === undefined
          ? b.targetDate === undefined
            ? a.name.localeCompare(b.name)
            : 1
          : b.targetDate === undefined
            ? -1
            : a.targetDate.localeCompare(b.targetDate);
    case 'progress':
      return (a, b) =>
        initiativeProgress(store, b.id).percent - initiativeProgress(store, a.id).percent;
    case 'manual':
    default:
      return byOrderKeyThen('sortOrder', 'name');
  }
}

function listInitiatives(
  store: Store,
  status: InitiativeStatusFilter,
  ordering: InitiativeOrderBy,
  flat: boolean,
): InitiativeRow[] {
  const live = [...store.initiatives.values()].filter(
    (initiative) => initiative.archivedAt === undefined && initiative.deletedAt === undefined,
  );
  const liveIds = new Set(live.map((row) => row.id));
  const compare = comparatorFor(store, ordering);

  const childrenOf = (id: UUID, ancestors: ReadonlySet<UUID>): Initiative[] =>
    [...store.initiativeChildIdsFor(id)]
      .map((childId) => store.initiatives.get(childId))
      .filter(
        (child): child is Initiative =>
          child !== undefined &&
          child.archivedAt === undefined &&
          child.deletedAt === undefined &&
          !ancestors.has(child.id),
      )
      .sort(compare);

  const toRow = (
    id: UUID,
    depth: number,
    path: string,
    hasChildren: boolean,
  ): InitiativeRow | null => {
    const initiative = store.initiatives.get(id);
    if (
      initiative === undefined ||
      initiative.archivedAt !== undefined ||
      initiative.deletedAt !== undefined
    ) {
      return null;
    }
    // Through `personName`, so the "full names" preference reaches this list. It used to
    // read `.name` while the overview read `.displayName`, which showed one person under two
    // names on two screens.
    const ownerUser =
      initiative.ownerId === undefined ? undefined : store.users.get(initiative.ownerId);
    const owner = ownerUser === undefined ? null : personName(ownerUser);
    const labels = [...store.initiativeLabelIdsFor(id)]
      .map((labelId) => store.initiativeLabels.get(labelId))
      .filter(
        (label): label is InitiativeLabel => label !== undefined && label.archivedAt === undefined,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    const latest = latestInitiativeUpdate(store, initiative.id);
    return {
      id: initiative.id,
      name: initiative.name,
      status: initiative.status,
      health: latest?.health ?? null,
      healthAt: latest?.createdAt ?? null,
      projects: linkedProjectHealths(store, initiative.id),
      labels,
      ownerName: owner,
      ownerId: initiative.ownerId,
      ownerAvatar: ownerUser?.avatarUrl ?? null,
      targetDate: initiative.targetDate,
      targetGranularity: initiative.targetDateGranularity,
      progress: initiativeProgress(store, initiative.id),
      depth,
      hasChildren,
      path,
    };
  };

  const roots = live.filter((initiative) => {
    for (const parentId of store.initiativeParentIdsFor(initiative.id)) {
      if (liveIds.has(parentId)) return false;
    }
    return true;
  });
  roots.sort(compare);

  const rows: InitiativeRow[] = [];
  const walk = (id: UUID, depth: number, ancestors: ReadonlySet<UUID>, path: string) => {
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    const children = childrenOf(id, nextAncestors);
    const row = toRow(id, depth, path, children.length > 0);
    if (row === null) return;
    rows.push(row);
    for (const child of children) {
      walk(child.id, depth + 1, nextAncestors, `${path}/${child.id}`);
    }
  };
  for (const root of roots) {
    walk(root.id, 0, new Set(), root.id);
  }

  // A flat list is flat all the way down: a child whose parent was filtered out or sorted
  // under another heading has nothing to indent under, and an indent with no parent above
  // it reads as a mistake. `isFlatList` is where that is decided; this only obeys it.
  const filtered = status === 'all' ? rows : rows.filter((row) => row.status === status);
  if (!flat) return filtered;
  return filtered.map((row) => ({ ...row, depth: 0, hasChildren: false }));
}
