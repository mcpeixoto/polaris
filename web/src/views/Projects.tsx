/**
 * The workspace (or team) project list.
 *
 * A scan, not a dashboard: a table with one row per project — name and the milestone it is
 * on, health and how old that claim is, priority, lead, target, how much work is in it and
 * how much of that is done. Empty teaches the next action — create a project — rather than
 * decorating a blank pane.
 *
 * Projects sort by priority band, then manual order within the band. Drag a row onto another
 * to reorder; drag onto a priority heading to change band.
 */

import { useCallback, useMemo, useState, type DragEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeymap } from '~/app/keymap';
import { Avatar, Button, EmptyState, PriorityIcon, priorityLabel, Select } from '~/components';
import {
  downloadCsv,
  exportCap,
  exportCapNote,
  projectsToCsv,
  type ExportRole,
} from '~/features/export/csv';
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
  PROJECT_FILTER_PARAMS,
  resolveProjectDisplay,
  resolveProjectFilters,
  toProjectDisplayParams,
  toProjectFilterParams,
  type ProjectDisplayOptions,
  type ProjectFilterOptions,
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
import { ProjectTimeline } from '~/features/projects/ProjectTimeline';
import { updateProject } from '~/features/projects/mutations';
import { compareProjectsByPriority } from '~/features/projects/projectHelpers';
import { formatTimeframe } from '~/features/projects/properties';
import { listProjectMilestones } from '~/features/project-milestones/helpers';
import { ProjectHealthCell } from '~/features/project-updates/ProjectHealthCell';
import { projectProgress, type Progress } from '~/features/initiatives/progress';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import { PRIORITY_LEVELS } from '~/components/PriorityIcon';
import type { Project, ProjectStatus, Store, TimeframeGranularity, UUID } from '~/store';
import styles from './Projects.module.css';

interface ProjectRow {
  readonly id: UUID;
  readonly name: string;
  readonly icon: string | undefined;
  readonly color: string;
  readonly priority: number;
  readonly sortOrder: string;
  readonly statusName: string;
  readonly statusColor: string;
  readonly leadName: string | null;
  readonly leadId: UUID | undefined;
  readonly leadAvatar: string | null;
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

interface PriorityGroup {
  readonly priority: number;
  readonly rows: readonly ProjectRow[];
}

const STATUS_PILLS: readonly { readonly value: ProjectStatusFilter; readonly label: string }[] = [
  { value: 'all', label: 'All projects' },
  ...PROJECT_STATUS_CATEGORIES.map((category) => ({
    value: category,
    label: PROJECT_STATUS_CATEGORY_LABELS[category],
  })),
];

export function Projects() {
  const engine = useEngine();
  const { teamKey } = useParams<{ teamKey?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewer = useViewer();
  const { registry, context } = useKeymap();
  const create = () => registry.invoke('project.create', { source: 'menu', context });
  const displayTrigger = useMenuTrigger();
  const [draggingId, setDraggingId] = useState<UUID | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  /** What the last export left out, or null. See the banner below the header. */
  const [exportNote, setExportNote] = useState<string | null>(null);

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
      for (const key of ['layout', 'zoom', 'deps', 'milestones'] as const) {
        params.delete(key);
      }
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

  const groups = useLiveQuery(
    (store) => listProjectGroups(store, team?.id, filters),
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
      'customer',
      'customerRequest',
    ],
    [team?.id ?? '', filters.dependency, filters.customer, filters.status],
  );

  const customerOptions = useLiveQuery(
    (store) => projectCustomerFilterOptions(store),
    ['customer'],
  );
  const hideCustomers = viewer === null || viewer.role === 'guest';

  const heading = team === null ? 'Projects' : `${team.name} projects`;
  const rowCount = groups.reduce((sum, group) => sum + group.rows.length, 0);
  // The sparkline column exists only when at least one row has a line to draw. A column of
  // empty cells is a promise the data is not keeping.
  const hasSparkline = groups.some((group) => group.rows.some((row) => row.sparkline !== null));

  // An empty replica is not an empty workspace. Until the first sync settles, "No projects
  // yet" is a claim the client cannot make — and it came with an invitation to create one.
  const settled = useStoreSettled();

  // Whether the list is empty because there is nothing, or empty because the header's
  // dropdowns excluded everything. Without the distinction the screen tells somebody their
  // projects are gone and offers to make more — see the same flag in IssueList.
  const filtered = activeProjectFilterCount(filters) > 0;
  const clearFilters = useCallback(() => setFilters(DEFAULT_PROJECT_FILTERS), [setFilters]);

  const onDropOnRow = useCallback(
    async (targetId: UUID) => {
      if (draggingId === null || draggingId === targetId) return;
      const store = engine.store;
      const moving = store.projects.get(draggingId);
      const target = store.projects.get(targetId);
      if (moving === undefined || target === undefined) return;
      try {
        await updateProject(engine, draggingId, {
          priority: target.priority,
          afterProjectId: targetId,
        });
      } catch (error) {
        report(error);
      } finally {
        setDraggingId(null);
        setOverId(null);
      }
    },
    [draggingId, engine],
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

  useActions(
    [
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
          const ids = groups.flatMap((group) => group.rows).map((row) => row.id);
          const slug = heading.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
          downloadCsv(`${slug || 'projects'}.csv`, projectsToCsv(engine.store, ids.slice(0, cap)));
          setExportNote(exportCapNote(ids.length, cap, 'projects'));
        },
      },
    ],
    [engine, groups, heading, viewer],
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
          time, the URL remembering which. The other two filters are rarer and keep their
          dropdowns at the far end of the row. */}
      <div className={styles.toolbar}>
        <div className={styles.pills} role="group" aria-label="Status">
          {STATUS_PILLS.map((pill) => (
            <button
              key={pill.value}
              type="button"
              className={
                filters.status === pill.value ? `${styles.pill} ${styles.pillActive}` : styles.pill
              }
              aria-pressed={filters.status === pill.value}
              onClick={() => setFilters({ status: pill.value })}
            >
              {pill.label}
            </button>
          ))}
        </div>
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

      {display.layout === 'timeline' ? (
        <ProjectTimeline
          teamId={team?.id}
          depFilter={filters.dependency}
          customerFilter={hideCustomers ? 'all' : filters.customer}
          statusFilter={filters.status}
          display={display}
          onClearFilters={clearFilters}
        />
      ) : rowCount === 0 && !settled ? (
        <EntityLoading className={styles.loading} label="Loading projects…" lines={6} />
      ) : rowCount === 0 ? (
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
      ) : (
        <div className={hasSparkline ? `${styles.table} ${styles.tableSparkline}` : styles.table}>
          <div className={styles.columns} aria-hidden="true">
            <span>Name</span>
            <span>Health</span>
            <span>Priority</span>
            <span>Lead</span>
            <span>Target date</span>
            <span className={styles.columnEnd}>Issues</span>
            <span>Status</span>
            {hasSparkline ? <span /> : null}
          </div>
          {PRIORITY_LEVELS.map((priority) => {
            const group = groups.find((candidate) => candidate.priority === priority);
            if (group === undefined || group.rows.length === 0) return null;
            const headingId = `priority-${priority}`;
            return (
              <section key={priority} className={styles.group}>
                <h2
                  id={headingId}
                  className={
                    overId === headingId
                      ? `${styles.groupTitle} ${styles.groupTitleOver}`
                      : styles.groupTitle
                  }
                  onDragOver={(event) => {
                    if (draggingId === null) return;
                    event.preventDefault();
                    setOverId(headingId);
                  }}
                  onDragLeave={() => {
                    if (overId === headingId) setOverId(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    void onDropOnPriority(priority);
                  }}
                >
                  <PriorityIcon priority={priority} decorative />
                  {priorityLabel(priority)}
                  <span className={styles.groupCount}>{group.rows.length}</span>
                </h2>
                <ul className={styles.groupList} aria-labelledby={headingId}>
                  {group.rows.map((row) => (
                    <li key={row.id}>
                      <ProjectRowLink
                        store={engine.store}
                        row={row}
                        sparkline={hasSparkline}
                        dragging={draggingId === row.id}
                        over={overId === row.id}
                        draggable
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
                          void onDropOnRow(row.id);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface RowLinkProps {
  readonly store: Store;
  readonly row: ProjectRow;
  readonly sparkline: boolean;
  readonly dragging: boolean;
  readonly over: boolean;
  readonly draggable: boolean;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onDragOver: (event: DragEvent<HTMLAnchorElement>) => void;
  readonly onDragLeave: () => void;
  readonly onDrop: (event: DragEvent<HTMLAnchorElement>) => void;
}

function ProjectRowLink({
  store,
  row,
  sparkline,
  dragging,
  over,
  draggable,
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
          {row.icon === undefined || row.icon === '' ? <ProjectGlyph /> : row.icon}
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
      <span className={styles.health}>
        <ProjectHealthCell store={store} projectId={row.id} compact />
      </span>
      <span className={styles.priority}>
        <PriorityIcon priority={row.priority} />
      </span>
      <span className={styles.lead}>
        {row.leadName === null ? (
          <span className={styles.noLead} title="No lead">
            <NoPersonGlyph />
          </span>
        ) : (
          <span title={row.leadName} className={styles.leadAvatar}>
            <Avatar name={row.leadName} src={row.leadAvatar} size="sm" colorKey={row.leadId} />
          </span>
        )}
      </span>
      <span className={styles.target}>
        {row.targetDate === undefined ? null : (
          <>
            <CalendarGlyph />
            {formatTimeframe(row.targetDate, row.targetGranularity)}
          </>
        )}
      </span>
      <span className={styles.count}>{row.issueCount}</span>
      <span className={styles.status}>
        <ProgressRing
          percent={row.progress.percent}
          label={row.statusName}
          detail={done}
          // The status's own colour is workspace data, and no theme overrules it.
          style={row.statusColor === '' ? undefined : { color: row.statusColor }}
        />
        <span aria-hidden="true">{row.progress.percent}%</span>
        {/* The ring names the status for assistive tech; this puts the word in the row's
            text as well, so a search for it lands on the row. */}
        <span className={styles.srOnly}>{row.statusName}</span>
      </span>
      {sparkline ? (
        <span className={styles.spark}>
          {row.sparkline === null ? null : <Sparkline values={row.sparkline} />}
        </span>
      ) : null}
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

function listProjectGroups(
  store: Store,
  teamId: UUID | undefined,
  filters: ProjectFilterOptions,
): PriorityGroup[] {
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
  projects.sort(compareProjectsByPriority);

  const byPriority = new Map<number, ProjectRow[]>();
  for (const project of projects) {
    const status: ProjectStatus | undefined = store.projectStatuses.get(project.statusId);
    const lead = project.leadId === undefined ? undefined : store.users.get(project.leadId);
    const graph = buildProjectGraph(store, project.id);
    const row: ProjectRow = {
      id: project.id,
      name: project.name,
      icon: project.icon,
      color: project.color,
      priority: project.priority,
      sortOrder: project.sortOrder,
      statusName: status?.name ?? 'No status',
      statusColor: status?.color ?? project.color,
      leadName: lead?.displayName ?? null,
      leadId: project.leadId,
      leadAvatar: lead?.avatarUrl ?? null,
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
    const bucket = byPriority.get(project.priority) ?? [];
    bucket.push(row);
    byPriority.set(project.priority, bucket);
  }

  return PRIORITY_LEVELS.filter((priority) => (byPriority.get(priority)?.length ?? 0) > 0).map(
    (priority) => ({
      priority,
      rows: byPriority.get(priority) ?? [],
    }),
  );
}
