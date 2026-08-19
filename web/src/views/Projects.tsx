/**
 * The workspace (or team) project list.
 *
 * A scan, not a dashboard: name, status, lead, how much work is in it. Empty teaches the
 * next action — create a project — rather than decorating a blank pane.
 *
 * Projects sort by priority band, then manual order within the band. Drag a row onto another
 * to reorder; drag onto a priority heading to change band.
 */

import { useCallback, useState, type DragEvent } from 'react';
import { Link, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useKeymap } from '~/app/keymap';
import { Avatar, Button, EmptyState, PriorityIcon, priorityLabel } from '~/components';
import { report } from '~/features/issue/mutations';
import {
  matchesDependencyFilter,
  ProjectDependencyFilterSelect,
  type ProjectDependencyFilter,
} from '~/features/projects/dependencies';
import { updateProject } from '~/features/projects/mutations';
import { compareProjectsByPriority } from '~/features/projects/projectHelpers';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { latestProjectUpdate } from '~/features/project-updates/helpers';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { PRIORITY_LEVELS } from '~/components/PriorityIcon';
import type { Project, ProjectStatus, ProjectUpdateHealth, Store, UUID } from '~/store';
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
  readonly health: ProjectUpdateHealth | undefined;
  readonly leadName: string | null;
  readonly leadId: UUID | undefined;
  readonly issueCount: number;
}

interface PriorityGroup {
  readonly priority: number;
  readonly rows: readonly ProjectRow[];
}

export function Projects() {
  const engine = useEngine();
  const { teamKey } = useParams<{ teamKey?: string }>();
  const { registry, context } = useKeymap();
  const create = () => registry.invoke('project.create', { source: 'menu', context });
  const [depFilter, setDepFilter] = useState<ProjectDependencyFilter>('all');
  const [draggingId, setDraggingId] = useState<UUID | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const team = useLiveQuery(
    (store) =>
      teamKey === undefined
        ? null
        : ([...store.teams.values()].find((candidate) => candidate.key === teamKey) ?? null),
    ['team'],
    [teamKey ?? ''],
  );

  const groups = useLiveQuery(
    (store) => listProjectGroups(store, team?.id, depFilter),
    [
      'project',
      'projectStatus',
      'projectTeam',
      'projectMember',
      'projectUpdate',
      'projectDependency',
      'issue',
      'user',
    ],
    [team?.id ?? '', depFilter],
  );

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

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{heading}</h1>
        <div className={styles.headerActions}>
          <ProjectDependencyFilterSelect value={depFilter} onChange={setDepFilter} />
          <Button variant="primary" onClick={create}>
            New project
          </Button>
        </div>
      </header>

      {rowCount === 0 ? (
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
                    overId === headingId ? `${styles.groupTitle} ${styles.groupTitleOver}` : styles.groupTitle
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
      {row.health === undefined ? (
        <span className={styles.healthMuted}>No update</span>
      ) : (
        <span className={styles.health}>
          <ProjectHealthBadge health={row.health} compact />
        </span>
      )}
      {row.leadName === null ? (
        <span className={styles.leadMuted}>No lead</span>
      ) : (
        <span className={styles.lead}>
          <Avatar name={row.leadName} size="xs" colorKey={row.leadId} decorative />
          {row.leadName}
        </span>
      )}
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
): PriorityGroup[] {
  const projects: Project[] = [];
  for (const project of store.projects.values()) {
    if (project.archivedAt !== undefined || project.deletedAt !== undefined) continue;
    if (!matchesDependencyFilter(store, project.id, depFilter)) continue;
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
      health: latestProjectUpdate(store, project.id)?.health,
      leadName: lead?.displayName ?? null,
      leadId: project.leadId,
      issueCount: store.index.byProject(project.id).size,
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
