/**
 * Project overview — the project as a document: its name, what it is for, how it is
 * going, and the checkpoints on the way.
 *
 * The centre column reads top to bottom the way Linear's does: the title with its emoji,
 * a one-line summary and the description as plain text you can type into, then every
 * update as a card in the colour of the health it claimed, the composer for the next one,
 * the milestones, and the progress graph. Everything that is a property of the project
 * rather than its content lives in the rail beside it.
 */

import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, IconButton, Input, Select, Textarea } from '~/components';
import { ProjectGraph } from '~/features/projects/ProjectGraph';
import { ProjectGlyph } from '~/features/projects/glyphs';
import { updateProject } from '~/features/projects/mutations';
import { MilestoneSection } from '~/features/project-milestones/MilestoneSection';
import { createProjectUpdate } from '~/features/project-updates/mutations';
import { HealthDot, ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { PencilGlyph } from '~/features/project-updates/glyphs';
import { ProjectUpdateEditor } from '~/features/project-updates/ProjectUpdateEditor';
import {
  listProjectUpdates,
  PROJECT_UPDATE_HEALTH_TOKEN,
} from '~/features/project-updates/helpers';
import { report } from '~/features/issue/mutations';
import { useViewerId } from '~/hooks/useViewer';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { IssueCustomers } from '~/features/customers/IssueCustomers';
import type { ProjectUpdateHealth, UUID } from '~/store';
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
  const [editing, setEditing] = useState<UUID | null>(null);

  const project = useLiveQuery(
    (store) => store.projects.get(projectId) ?? null,
    ['project'],
    [projectId],
  );

  const updates = useLiveQuery(
    (store) =>
      listProjectUpdates(store, projectId).map((update) => ({
        update,
        author: store.users.get(update.authorId)?.displayName ?? null,
      })),
    ['projectUpdate', 'user'],
    [projectId],
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
      <div className={styles.column}>
        <div className={styles.titleRow}>
          <span className={styles.mark} aria-hidden="true">
            {project.icon === undefined || project.icon === '' ? <ProjectGlyph /> : project.icon}
          </span>
          {/* Not a heading: the shell's breadcrumb already carries the page's h1, and two
              headings with the same words is one more than a screen reader wants. */}
          <p className={styles.title}>{project.name}</p>
        </div>

        {/* Summary and description are the page, not a form, so they are unboxed and save
            on blur: prose, and a mutation per keystroke would put a hundred entries in the
            activity feed for one sentence. Keyed on the stored value so a change arriving
            over sync replaces the field rather than fighting a stale draft. */}
        <SummaryField
          key={`summary:${project.summary ?? ''}`}
          stored={project.summary ?? ''}
          onSave={(summary) => updateProject(engine, project.id, { summary }).catch(report)}
        />
        <DescriptionField
          key={`description:${project.description}`}
          stored={project.description}
          onSave={(description) => updateProject(engine, project.id, { description }).catch(report)}
        />

        <section className={styles.section} aria-labelledby={`updates-${project.id}`}>
          <h3 className={styles.sectionTitle} id={`updates-${project.id}`}>
            Updates
          </h3>
          {updates.length === 0 ? (
            <p className={styles.muted}>No updates yet. The first one sets the health.</p>
          ) : (
            <ul className={styles.updates}>
              {updates.map(({ update, author }) => (
                <li
                  key={update.id}
                  className={styles.card}
                  style={{
                    borderInlineStartColor: `var(${PROJECT_UPDATE_HEALTH_TOKEN[update.health]})`,
                  }}
                >
                  <div className={styles.cardHead}>
                    <ProjectHealthBadge health={update.health} />
                    {author !== null && (
                      <span className={styles.cardMeta}>
                        {author} · {formatWhen(update.createdAt)}
                        {update.editedAt === undefined ? '' : ' · edited'}
                      </span>
                    )}
                    {/* Author-only, because the server refuses anybody else's edit. */}
                    {viewerId === update.authorId && editing !== update.id && (
                      <IconButton
                        size="sm"
                        className={styles.cardEdit}
                        icon={<PencilGlyph />}
                        aria-label="Edit update"
                        tooltip="Edit update"
                        onClick={() => setEditing(update.id)}
                      />
                    )}
                  </div>
                  {editing === update.id ? (
                    <ProjectUpdateEditor update={update} onDone={() => setEditing(null)} />
                  ) : (
                    update.body !== '' && <p className={styles.cardBody}>{update.body}</p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Correcting a post and writing the next one are the same decision made twice,
              so the composer stands down while an editor is open — which also keeps one
              "Health" control on the screen rather than two identically named ones. */}
          {editing === null && (
            <form className={styles.composer} onSubmit={onSubmit}>
              <Textarea
                label="Update"
                hideLabel
                surface="plain"
                value={body}
                minRows={2}
                placeholder="What changed since the last update?"
                onChange={(event) => {
                  setBody(event.target.value);
                  if (postError !== null) setPostError(null);
                }}
              />
              {postError === null ? null : (
                <p className={styles.error} role="alert">
                  {postError}
                </p>
              )}
              <div className={styles.composerFoot}>
                <Select
                  aria-label="Health"
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
                <Button type="submit" variant="primary" disabled={posting || viewerId === null}>
                  Post update
                </Button>
              </div>
            </form>
          )}
        </section>

        <MilestoneSection projectId={project.id} />

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Progress</h3>
          <ProjectGraph projectId={project.id} />
        </section>

        {/* Dependencies are drawn once, in the properties rail. They used to be here as well,
            which put two copies of the same two lists on one screen — and the two disagreed
            about whether you could add to them. */}
        <IssueCustomers projectId={project.id} />
      </div>
    </div>
  );
}

interface ProseFieldProps {
  readonly stored: string;
  readonly onSave: (value: string) => void;
}

/** The one-line summary, unboxed, saved on blur when it changed. */
function SummaryField({ stored, onSave }: ProseFieldProps) {
  const [draft, setDraft] = useState(stored);
  return (
    <Input
      surface="plain"
      aria-label="Summary"
      className={styles.summary}
      value={draft}
      placeholder="Add a short summary…"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const summary = draft.trim();
        if (summary !== stored) onSave(summary);
      }}
    />
  );
}

/** The description, unboxed and growing, saved on blur when it changed. */
function DescriptionField({ stored, onSave }: ProseFieldProps) {
  const [draft, setDraft] = useState(stored);
  return (
    <Textarea
      surface="plain"
      aria-label="Description"
      className={styles.description}
      value={draft}
      minRows={2}
      placeholder="Add description…"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== stored) onSave(draft);
      }}
    />
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
