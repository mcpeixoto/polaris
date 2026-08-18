/**
 * The workspace (or team) project list.
 *
 * A scan, not a dashboard: name, status, lead, how much work is in it. Empty teaches the
 * next action — create a project — rather than decorating a blank pane.
 */

import { Link, useParams } from 'react-router';

import { useKeymap } from '~/app/keymap';
import { Avatar, Button, EmptyState } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { ProjectStatus, Store, UUID } from '~/store';
import styles from './Projects.module.css';

interface ProjectRow {
  readonly id: UUID;
  readonly name: string;
  readonly summary: string | undefined;
  readonly color: string;
  readonly statusName: string;
  readonly statusColor: string;
  readonly leadName: string | null;
  readonly leadId: UUID | undefined;
  readonly issueCount: number;
}

export function Projects() {
  const { teamKey } = useParams<{ teamKey?: string }>();
  const { registry, context } = useKeymap();
  const create = () => registry.invoke('project.create', { source: 'menu', context });

  const team = useLiveQuery(
    (store) =>
      teamKey === undefined
        ? null
        : ([...store.teams.values()].find((candidate) => candidate.key === teamKey) ?? null),
    ['team'],
    [teamKey ?? ''],
  );

  const rows = useLiveQuery(
    (store) => listProjects(store, team?.id),
    ['project', 'projectStatus', 'projectTeam', 'projectMember', 'issue', 'user'],
    [team?.id ?? ''],
  );

  const heading = team === null ? 'Projects' : `${team.name} projects`;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{heading}</h1>
        <Button variant="primary" onClick={create}>
          New project
        </Button>
      </header>

      {rows.length === 0 ? (
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
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id}>
              <Link to={`/project/${row.id}`} className={styles.row}>
                <span
                  className={styles.mark}
                  style={{ background: row.color }}
                  aria-hidden="true"
                />
                <span className={styles.body}>
                  <span className={styles.name}>{row.name}</span>
                  {row.summary !== undefined && row.summary !== '' && (
                    <span className={styles.summary}>{row.summary}</span>
                  )}
                </span>
                <span className={styles.status}>
                  <span
                    className={styles.statusDot}
                    style={{ background: row.statusColor }}
                    aria-hidden="true"
                  />
                  {row.statusName}
                </span>
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function listProjects(store: Store, teamId: UUID | undefined): ProjectRow[] {
  const rows: ProjectRow[] = [];
  for (const project of store.projects.values()) {
    if (project.archivedAt !== undefined || project.deletedAt !== undefined) continue;
    if (teamId !== undefined) {
      const onTeam = [...store.projectTeamIdsFor(project.id)].some(
        (id) => store.projectTeams.get(id)?.teamId === teamId,
      );
      if (!onTeam) continue;
    }
    const status: ProjectStatus | undefined = store.projectStatuses.get(project.statusId);
    const lead = project.leadId === undefined ? undefined : store.users.get(project.leadId);
    rows.push({
      id: project.id,
      name: project.name,
      summary: project.summary,
      color: project.color,
      statusName: status?.name ?? 'No status',
      statusColor: status?.color ?? project.color,
      leadName: lead?.displayName ?? null,
      leadId: project.leadId,
      issueCount: store.index.byProject(project.id).size,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}
