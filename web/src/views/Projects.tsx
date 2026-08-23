/**
 * The workspace (or team) project list.
 *
 * A scan, not a dashboard: name, status, lead, how much work is in it. Empty teaches the
 * next action — create a project — rather than decorating a blank pane.
 *
 * Projects sort by priority band, then manual order within the band. Drag a row onto another
 * to reorder; drag onto a priority heading to change band.
 */

import { useCallback, useMemo, useState, type DragEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeymap } from '~/app/keymap';
import {
  Avatar,
  Button,
  EmptyState,
  LabelChip,
  PriorityIcon,
  priorityLabel,
  Select,
} from '~/components';
import { downloadCsv, exportCap, projectsToCsv, type ExportRole } from '~/features/export/csv';
import { report } from '~/features/issue/mutations';
import {
  matchesProjectCustomerFilter,
  projectCustomerFilterOptions,
  type ProjectCustomerFilter,
} from '~/features/projects/customerFilter';
import {
  matchesDependencyFilter,
  ProjectDependencyFilterSelect,
  type ProjectDependencyFilter,
} from '~/features/projects/dependencies';
import {
  DEFAULT_PROJECT_DISPLAY,
  resolveProjectDisplay,
  toProjectDisplayParams,
  type ProjectDisplayOptions,
} from '~/features/projects/display';
import { ProjectDisplayMenu } from '~/features/projects/ProjectDisplayMenu';
import { ProjectTimeline } from '~/features/projects/ProjectTimeline';
import { updateProject } from '~/features/projects/mutations';
import { compareProjectsByPriority } from '~/features/projects/projectHelpers';
import { ProjectHealthCell } from '~/features/project-updates/ProjectHealthCell';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import { PRIORITY_LEVELS } from '~/components/PriorityIcon';
import type { Project, ProjectLabel, ProjectStatus, Store, UUID } from '~/store';
import styles from './Projects.module.css';

interface ProjectRow {
  readonly id: UUID;
  readonly name: string;
  readonly summary: string | undefined;
  readonly color: string;
  readonly priority: number;
  readonly sortOrder: string;
  readonly statusName: string;
  readonly statusColor: string;
  readonly leadName: string | null;
  readonly leadId: UUID | undefined;
  readonly issueCount: number;
  readonly labels: readonly { readonly id: UUID; readonly name: string; readonly color: string }[];
}

interface PriorityGroup {
  readonly priority: number;
  readonly rows: readonly ProjectRow[];
}

export function Projects() {
  const engine = useEngine();
  const { teamKey } = useParams<{ teamKey?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewer = useViewer();
  const { registry, context } = useKeymap();
  const create = () => registry.invoke('project.create', { source: 'menu', context });
  const displayTrigger = useMenuTrigger();
  const [depFilter, setDepFilter] = useState<ProjectDependencyFilter>('all');
  const [customerFilter, setCustomerFilter] = useState<ProjectCustomerFilter>('all');
  const [draggingId, setDraggingId] = useState<UUID | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const display = useMemo(() => resolveProjectDisplay(searchParams), [searchParams]);
  const displayChanges = useMemo(() => {
    let count = 0;
    if (display.layout !== DEFAULT_PROJECT_DISPLAY.layout) count++;
    if (display.zoom !== DEFAULT_PROJECT_DISPLAY.zoom) count++;
    if (display.showDependencies !== DEFAULT_PROJECT_DISPLAY.showDependencies) count++;
    if (display.showMilestones !== DEFAULT_PROJECT_DISPLAY.showMilestones) count++;
    return count;
  }, [display]);

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
    (store) => listProjectGroups(store, team?.id, depFilter, customerFilter),
    [
      'project',
      'projectStatus',
      'projectTeam',
      'projectMember',
      'projectUpdate',
      'projectDependency',
      'projectLabel',
      'projectLabelLink',
      'workspace',
      'issue',
      'user',
      'customer',
      'customerRequest',
    ],
    [team?.id ?? '', depFilter, customerFilter],
  );

  const customerOptions = useLiveQuery(
    (store) => projectCustomerFilterOptions(store),
    ['customer'],
  );
  const hideCustomers = viewer === null || viewer.role === 'guest';

  const heading = team === null ? 'Projects' : `${team.name} projects`;
  const rowCount = groups.reduce((sum, group) => sum + group.rows.length, 0);

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
          const ids = groups
            .flatMap((group) => group.rows)
            .slice(0, cap)
            .map((row) => row.id);
          const slug = heading.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
          downloadCsv(`${slug || 'projects'}.csv`, projectsToCsv(engine.store, ids));
        },
      },
    ],
    [engine, groups, heading, viewer],
  );

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{heading}</h1>
        <div className={styles.headerActions}>
          <ProjectDependencyFilterSelect value={depFilter} onChange={setDepFilter} />
          {hideCustomers ? null : (
            <Select
              label="Customers"
              value={customerFilter}
              onChange={(event) => setCustomerFilter(event.target.value as ProjectCustomerFilter)}
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
          <Button variant="primary" onClick={create}>
            New project
          </Button>
        </div>
      </header>

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
          depFilter={depFilter}
          customerFilter={hideCustomers ? 'all' : customerFilter}
          display={display}
        />
      ) : rowCount === 0 ? (
        <EmptyState
          title="No projects yet"
          description="A project is a unit of work with a clear outcome. Create one, then file issues into it with Shift+P."
          action={
            <Button variant="primary" onClick={create}>
              New project
            </Button>
          }
        />
      ) : (
        <div className={styles.list}>
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
                </h2>
                <ul className={styles.groupList} aria-labelledby={headingId}>
                  {group.rows.map((row) => (
                    <li key={row.id}>
                      <ProjectRowLink
                        store={engine.store}
                        row={row}
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
      <span className={styles.mark} style={{ background: row.color }} aria-hidden="true" />
      <span className={styles.body}>
        <span className={styles.name}>{row.name}</span>
        {row.summary !== undefined && row.summary !== '' && (
          <span className={styles.summary}>{row.summary}</span>
        )}
      </span>
      <span className={styles.priority}>
        <PriorityIcon priority={row.priority} decorative />
        {priorityLabel(row.priority)}
      </span>
      <span className={styles.status}>
        <span
          className={styles.statusDot}
          style={{ background: row.statusColor }}
          aria-hidden="true"
        />
        {row.statusName}
      </span>
      <span className={styles.health}>
        <ProjectHealthCell store={store} projectId={row.id} compact />
      </span>
      {row.leadName === null ? (
        <span className={styles.leadMuted}>No lead</span>
      ) : (
        <span className={styles.lead}>
          <Avatar name={row.leadName} size="xs" colorKey={row.leadId} decorative />
          {row.leadName}
        </span>
      )}
      <span className={styles.labels}>
        {row.labels.length === 0 ? (
          <span className={styles.labelMuted}>—</span>
        ) : (
          row.labels.map((label) => (
            <LabelChip key={label.id} name={label.name} color={label.color} compact />
          ))
        )}
      </span>
      <span className={styles.count}>
        {row.issueCount === 1 ? '1 issue' : `${row.issueCount} issues`}
      </span>
    </Link>
  );
}

function listProjectGroups(
  store: Store,
  teamId: UUID | undefined,
  depFilter: ProjectDependencyFilter,
  customerFilter: ProjectCustomerFilter,
): PriorityGroup[] {
  const projects: Project[] = [];
  for (const project of store.projects.values()) {
    if (project.archivedAt !== undefined || project.deletedAt !== undefined) continue;
    if (!matchesDependencyFilter(store, project.id, depFilter)) continue;
    if (!matchesProjectCustomerFilter(store, project.id, customerFilter)) continue;
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
    const row: ProjectRow = {
      id: project.id,
      name: project.name,
      summary: project.summary,
      color: project.color,
      priority: project.priority,
      sortOrder: project.sortOrder,
      statusName: status?.name ?? 'No status',
      statusColor: status?.color ?? project.color,
      leadName: lead?.displayName ?? null,
      leadId: project.leadId,
      issueCount: store.index.byProject(project.id).size,
      labels: [...store.projectLabelIdsFor(project.id)]
        .map((id) => store.projectLabels.get(id))
        .filter(
          (label): label is ProjectLabel =>
            label !== undefined && !label.isGroup && label.archivedAt === undefined,
        )
        .map((label) => ({ id: label.id, name: label.name, color: label.color })),
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
