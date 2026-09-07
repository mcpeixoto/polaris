/**
 * Peek, for the project under the cursor.
 *
 * The project list is a scan, and a scan's cost is that answering "what is this one?" meant
 * opening the project and coming back to a list that had lost its filters and its place.
 * Space answers it without leaving: the same panel the issue list has, the same key, the
 * same hold-to-glance, the same Escape.
 *
 * It is the project page squeezed to one column — the name where that page's title is, the
 * summary and description under it, then the rail of properties folded beneath rather than
 * beside. Same words for an unset value as the page uses, so what a person learns to read on
 * one surface reads on the other.
 */

import { useRef } from 'react';

import { Avatar, EmptyState, PriorityIcon, priorityLabel } from '~/components';
import { ProjectHealthCell } from '~/features/project-updates/ProjectHealthCell';
import { projectProgress } from '~/features/initiatives/progress';
import { formatTimeframe } from '~/features/projects/properties';
import { exact, when } from '~/features/time';
import { useEngine } from '~/app/context';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { usePresence } from '~/hooks/usePresence';
import type { Store, UUID } from '~/store';

import { Fact, glanceDescription, PeekHeader } from './parts';
import styles from './Peek.module.css';

export interface ProjectPeekProps {
  open: boolean;
  projectId: UUID | null;
  /** Shut the panel. The list owns the state, so it owns the close; this is the request. */
  onClose?: (() => void) | undefined;
}

export function ProjectPeek({ open, projectId, onClose }: ProjectPeekProps) {
  const panelRef = useRef<HTMLElement>(null);
  const { present, exitProps } = usePresence(open, panelRef);
  const engine = useEngine();

  const project = useLiveQuery(
    (store) => (!present || projectId === null ? null : readPeek(store, projectId)),
    ['project', 'projectStatus', 'user', 'issue', 'projectUpdate'],
    [present, projectId ?? ''],
  );

  if (!present) return null;

  if (projectId === null || project === null) {
    return (
      <aside ref={panelRef} className={styles.panel} aria-label="Peek" {...exitProps}>
        <EmptyState
          title={projectId === null ? 'Nothing under the cursor' : 'This project is not here yet'}
          description={
            projectId === null
              ? 'Move to a row, then press Space. Enter opens the project for real.'
              : 'It may still be arriving, or it belongs to a team you are not in.'
          }
        />
      </aside>
    );
  }

  return (
    <aside
      ref={panelRef}
      className={styles.panel}
      aria-label={`Peek ${project.name}`}
      {...exitProps}
    >
      <PeekHeader eyebrow={project.statusName} onClose={onClose} />

      <h2 className={styles.title}>{project.name}</h2>

      <p className={styles.description}>
        {project.description === '' ? (
          <span className={styles.unset}>No description.</span>
        ) : (
          project.description
        )}
      </p>

      <h3 className={styles.railTitle}>Properties</h3>
      <dl className={styles.facts}>
        <Fact label="Health">
          <ProjectHealthCell store={engine.store} projectId={project.id} compact />
        </Fact>
        <Fact label="Priority">
          <PriorityIcon priority={project.priority} />
          {priorityLabel(project.priority)}
        </Fact>
        <Fact label="Lead">
          {project.leadName === null ? (
            <span className={styles.unset}>No lead</span>
          ) : (
            <>
              <Avatar name={project.leadName} src={project.leadAvatar} size="xs" decorative />
              {project.leadName}
            </>
          )}
        </Fact>
        <Fact label="Target">
          {project.target ?? <span className={styles.unset}>No target date</span>}
        </Fact>
        <Fact label="Progress">
          {project.total === 0 ? (
            <span className={styles.unset}>No issues yet</span>
          ) : (
            `${project.percent}% · ${project.completed}/${project.total} issues`
          )}
        </Fact>
      </dl>

      <p className={styles.dates}>
        Created{' '}
        <time dateTime={project.createdAt} title={exact(project.createdAt)}>
          {when(project.createdAt)}
        </time>
        {' · '}
        Updated{' '}
        <time dateTime={project.updatedAt} title={exact(project.updatedAt)}>
          {when(project.updatedAt)}
        </time>
      </p>

      <p className={styles.hint}>Enter to open · Esc to close</p>
    </aside>
  );
}

interface PeekProject {
  readonly id: UUID;
  readonly name: string;
  readonly description: string;
  readonly statusName: string;
  readonly priority: number;
  readonly leadName: string | null;
  readonly leadAvatar: string | null;
  readonly target: string | null;
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function readPeek(store: Store, id: UUID): PeekProject | null {
  const found = store.projects.get(id);
  if (found === undefined) return null;
  const lead = found.leadId === undefined ? undefined : store.users.get(found.leadId);
  const progress = projectProgress(store, found.id);
  // The summary is the sentence somebody wrote to be read in a list, so it leads; the
  // description is the long form and is only reached for when there is no summary.
  const blurb =
    found.summary !== undefined && found.summary !== '' ? found.summary : found.description;

  return {
    id: found.id,
    name: found.name,
    description: glanceDescription(blurb),
    statusName: store.get('projectStatus', found.statusId)?.name ?? 'No status',
    priority: found.priority,
    leadName: lead?.displayName ?? null,
    leadAvatar: lead?.avatarUrl ?? null,
    target:
      found.targetDate === undefined
        ? null
        : formatTimeframe(found.targetDate, found.targetDateGranularity ?? 'day'),
    completed: progress.completed,
    total: progress.total,
    percent: progress.percent,
    createdAt: found.createdAt,
    updatedAt: found.updatedAt,
  };
}
