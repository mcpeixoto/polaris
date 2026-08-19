/**
 * Project overview — latest health, compose an update, and the project description.
 */

import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, Select } from '~/components';
import { createProjectUpdate } from '~/features/project-updates/mutations';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { latestProjectUpdate } from '~/features/project-updates/helpers';
import { useViewerId } from '~/hooks/useViewer';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { ProjectUpdateHealth } from '~/store';
import styles from './ProjectOverview.module.css';

const HEALTH_OPTIONS: readonly { readonly value: ProjectUpdateHealth; readonly label: string }[] =
  [
    { value: 'on_track', label: 'On track' },
    { value: 'at_risk', label: 'At risk' },
    { value: 'off_track', label: 'Off track' },
  ];

export function ProjectOverview() {
  const engine = useEngine();
  const viewerId = useViewerId();
  const { projectId = '' } = useParams<{ projectId: string }>();
  const [health, setHealth] = useState<ProjectUpdateHealth>('on_track');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);

  const project = useLiveQuery(
    (store) => store.projects.get(projectId) ?? null,
    ['project'],
    [projectId],
  );

  const latest = useLiveQuery(
    (store) => latestProjectUpdate(store, projectId),
    ['projectUpdate', 'user'],
    [projectId],
  );

  const latestAuthor = useLiveQuery(
    (store) =>
      latest === undefined ? null : (store.users.get(latest.authorId)?.displayName ?? null),
    ['user', 'projectUpdate'],
    [projectId, latest?.authorId ?? ''],
  );

  if (project === null) return null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (posting || viewerId === null) return;
    setPosting(true);
    try {
      await createProjectUpdate(engine, {
        projectId: project.id,
        health,
        body,
        authorId: viewerId,
      });
      setBody('');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className={styles.screen}>
      {latest !== undefined && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Latest update</h2>
          <div className={styles.latestMeta}>
            <ProjectHealthBadge health={latest.health} />
            {latestAuthor !== null && (
              <span className={styles.metaText}>
                {latestAuthor} · {formatWhen(latest.createdAt)}
              </span>
            )}
          </div>
          {latest.body !== '' && <p className={styles.body}>{latest.body}</p>}
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Post an update</h2>
        <form className={styles.form} onSubmit={onSubmit}>
          <Select
            label="Health"
            value={health}
            onChange={(event) => setHealth(event.target.value as ProjectUpdateHealth)}
          >
            {HEALTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <label className={styles.field}>
            <span className={styles.label}>Update</span>
            <textarea
              className={styles.textarea}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="What changed since the last update?"
              rows={4}
            />
          </label>
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={posting || viewerId === null}>
              Post update
            </Button>
          </div>
        </form>
      </section>

      {project.description !== undefined && project.description !== '' && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Description</h2>
          <p className={styles.body}>{project.description}</p>
        </section>
      )}
    </div>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
