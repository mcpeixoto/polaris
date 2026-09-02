/**
 * Project overview — latest health, compose an update, and the project description.
 *
 * The health picker wears its value's dot, the same dot the badge above it draws, so the
 * composer and the posted update read as one thing rather than as a form and a result.
 */

import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, IconButton, Select, Textarea } from '~/components';
import { ProjectGraph } from '~/features/projects/ProjectGraph';
import { MilestoneSection } from '~/features/project-milestones/MilestoneSection';
import { createProjectUpdate } from '~/features/project-updates/mutations';
import { HealthDot, ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { PencilGlyph } from '~/features/project-updates/glyphs';
import { ProjectUpdateEditor } from '~/features/project-updates/ProjectUpdateEditor';
import { latestProjectUpdate } from '~/features/project-updates/helpers';
import { useViewerId } from '~/hooks/useViewer';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { IssueCustomers } from '~/features/customers/IssueCustomers';
import type { ProjectUpdateHealth } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './ProjectOverview.module.css';

const HEALTH_OPTIONS: readonly { readonly value: ProjectUpdateHealth; readonly label: string }[] = [
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
  const [postError, setPostError] = useState<string | null>(null);
  const [editingLatest, setEditingLatest] = useState(false);

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
    // A blank post is a health change with nothing said about it, and the feed reads as a
    // row of empty entries. Refused here rather than at the API, so the answer is instant.
    const written = body.trim();
    if (written === '') {
      setPostError('An update needs something to say.');
      return;
    }
    setPosting(true);
    setPostError(null);
    try {
      await createProjectUpdate(engine, {
        projectId: project.id,
        health,
        body: written,
        authorId: viewerId,
      });
      setBody('');
    } catch (failure) {
      // Without this the promise rejected into nothing: the form cleared its posting flag
      // in `finally` and looked exactly as it does after a successful post, so a refused
      // update — offline, a server that said no — read as one that had gone out.
      setPostError(failure instanceof ApiError ? failure.message : 'That update was not posted.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className={styles.screen}>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Progress</h2>
        <ProjectGraph projectId={project.id} />
      </section>

      {latest !== undefined && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Latest update</h2>
          <div className={styles.latestMeta}>
            <ProjectHealthBadge health={latest.health} />
            {latestAuthor !== null && (
              <span className={styles.metaText}>
                {latestAuthor} · {formatWhen(latest.createdAt)}
                {latest.editedAt === undefined ? '' : ' · edited'}
              </span>
            )}
            {/* Author-only, because the server refuses anybody else's edit. */}
            {viewerId === latest.authorId && !editingLatest && (
              <IconButton
                size="sm"
                icon={<PencilGlyph />}
                aria-label="Edit update"
                tooltip="Edit update"
                onClick={() => setEditingLatest(true)}
              />
            )}
          </div>
          {editingLatest ? (
            <ProjectUpdateEditor update={latest} onDone={() => setEditingLatest(false)} />
          ) : (
            latest.body !== '' && <p className={styles.body}>{latest.body}</p>
          )}
        </section>
      )}

      {/* Correcting the last post and writing the next one are the same decision made
          twice, so the composer stands down while the editor is open — which also keeps
          one "Health" control on the screen rather than two identically named ones. */}
      {editingLatest ? null : (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Post an update</h2>
          <form className={styles.form} onSubmit={onSubmit}>
            <Select
              label="Health"
              value={health}
              prefix={<HealthDot health={health} />}
              onChange={(event) => setHealth(event.target.value as ProjectUpdateHealth)}
            >
              {HEALTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Textarea
              label="Update"
              value={body}
              minRows={4}
              placeholder="What changed since the last update?"
              onChange={(event) => {
                setBody(event.target.value);
                if (postError !== null) setPostError(null);
              }}
            />
            {/* Fields, then the message, then the actions — the refusal beside the button
                that was refused rather than above the form, where it scrolls out of the way
                of the thing the reader is about to press again. */}
            {postError === null ? null : (
              <p className={styles.error} role="alert">
                {postError}
              </p>
            )}
            <div className={styles.actions}>
              <Button type="submit" variant="primary" disabled={posting || viewerId === null}>
                Post update
              </Button>
            </div>
          </form>
        </section>
      )}

      {/* Dependencies are drawn once, in the properties rail. They used to be here as well,
          which put two copies of the same two lists on one screen — and the two disagreed
          about whether you could add to them. */}
      {project.description !== undefined && project.description !== '' && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Description</h2>
          <p className={styles.body}>{project.description}</p>
        </section>
      )}

      <MilestoneSection projectId={project.id} />

      <IssueCustomers projectId={project.id} />
    </div>
  );
}

/**
 * The year is here on purpose, and it matches `ProjectActivity`'s formatter.
 *
 * The two used to disagree — this one printed "12 Jan 09:30" and the activity feed printed
 * the year — so the same update was dated differently depending on which tab you read it
 * on, and a year-old update looked recent on the overview.
 */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
