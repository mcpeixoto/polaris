/**
 * Project overview — the project as a document: what it is for, how it is going, and the
 * checkpoints on the way.
 *
 * The centre column reads top to bottom the way Linear's does: a one-line summary, the
 * description in the same editor an issue's is written in, the latest update with the
 * composer for the next one, the milestones, and the progress graph. Everything that is a
 * property of the project rather than its content lives in the rail beside it, and the name
 * lives in the shell's breadcrumb, which is also where it is renamed.
 *
 * The update *feed* is the activity tab's, not this one's. Both used to draw every update,
 * with different affordances on each copy — edit here, edit and delete there — which made
 * "where do I delete this from" a question about which tab you happened to be on. This tab
 * keeps the composer and the standing answer to "how is it going"; the history is one click
 * away and says so.
 */

import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';

import { useEngine } from '~/app/context';
import {
  Button,
  IconButton,
  Input,
  Menu,
  SaveIndicator,
  Textarea,
  useSaveState,
  type MenuNode,
} from '~/components';
import { DescriptionEditor } from '~/editor/DescriptionEditor';
import { ProjectGraph } from '~/features/projects/ProjectGraph';
import { updateProject } from '~/features/projects/mutations';
import { MilestoneSection } from '~/features/project-milestones/MilestoneSection';
import { createProjectUpdate } from '~/features/project-updates/mutations';
import { HealthDot, ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { HealthGlyph, PencilGlyph } from '~/features/project-updates/glyphs';
import { ProjectUpdateEditor } from '~/features/project-updates/ProjectUpdateEditor';
import {
  listProjectUpdates,
  PROJECT_UPDATE_HEALTH_LABEL,
  PROJECT_UPDATE_HEALTH_TOKEN,
} from '~/features/project-updates/helpers';
import { personName } from '~/features/prefs/prefs';
import { exact, when } from '~/features/time';
import { useViewerId } from '~/hooks/useViewer';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { IssueCustomers } from '~/features/customers/IssueCustomers';
import type { ProjectUpdateHealth } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './ProjectOverview.module.css';

const HEALTHS: readonly ProjectUpdateHealth[] = ['on_track', 'at_risk', 'off_track'];

export function ProjectOverview() {
  const engine = useEngine();
  const viewerId = useViewerId();
  const { projectId = '' } = useParams<{ projectId: string }>();
  const [health, setHealth] = useState<ProjectUpdateHealth>('on_track');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [editingLatest, setEditingLatest] = useState(false);
  const healthMenu = useMenuTrigger();

  // Autosave with nothing to show for it was the state of three detail screens: the summary
  // and the description both write on blur, and a refused write looked exactly like a
  // successful one. This says which of the two just happened.
  const save = useSaveState((failure) =>
    failure instanceof ApiError ? failure.message : 'That change could not be saved.',
  );

  const project = useLiveQuery(
    (store) => store.projects.get(projectId) ?? null,
    ['project'],
    [projectId],
  );

  const latest = useLiveQuery(
    (store) => {
      const [first] = listProjectUpdates(store, projectId);
      if (first === undefined) return null;
      return { update: first, author: store.users.get(first.authorId)?.displayName ?? null };
    },
    ['projectUpdate', 'user'],
    [projectId],
  );

  const names = useLiveQuery(
    (store) => {
      const out: Record<string, string> = {};
      for (const user of store.users.values()) out[user.id] = personName(user);
      return out;
    },
    ['user'],
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

  const healthItems: MenuNode[] = HEALTHS.map((value) => ({
    id: value,
    label: PROJECT_UPDATE_HEALTH_LABEL[value],
    icon: <HealthGlyph health={value} />,
    selected: value === health,
    onSelect: () => setHealth(value),
  }));

  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        {/* Summary and description are the page, not a form, so they are unboxed and save on
            blur: prose, and a mutation per keystroke would put a hundred entries in the
            activity feed for one sentence. */}
        <div className={styles.saveRow}>
          <SaveIndicator state={save.state} />
        </div>
        <SummaryField
          key={`summary:${project.summary ?? ''}`}
          stored={project.summary ?? ''}
          onSave={(summary) => void save.run(() => updateProject(engine, project.id, { summary }))}
        />
        {save.error === undefined ? null : (
          <p className={styles.error} role="alert">
            {save.error}
          </p>
        )}
        {/* The rich editor rather than a keyed `Textarea`. The key was the bug: a change
            arriving over sync remounted the field, so somebody else's edit threw away the
            paragraph you were part-way through typing. The editor keeps a draft that only
            exists while the field has focus, which is the same fix the title made. */}
        <div className={styles.description}>
          <DescriptionEditor
            target={{ kind: 'project', id: project.id }}
            description={project.description}
            names={names}
            viewerId={viewerId}
            enterSubmits={false}
            onSave={(description) =>
              void save.run(() => updateProject(engine, project.id, { description }))
            }
          />
        </div>

        <section className={styles.section} aria-labelledby={`updates-${project.id}`}>
          <h3 className={styles.sectionTitle} id={`updates-${project.id}`}>
            Latest update
          </h3>
          {latest === null ? (
            <p className={styles.muted}>No updates yet. The first one sets the health.</p>
          ) : (
            <ul className={styles.updates}>
              <li
                className={styles.card}
                style={{
                  borderInlineStartColor: `var(${PROJECT_UPDATE_HEALTH_TOKEN[latest.update.health]})`,
                }}
              >
                <div className={styles.cardHead}>
                  <ProjectHealthBadge health={latest.update.health} />
                  {latest.author !== null && (
                    <span className={styles.cardMeta} title={exact(latest.update.createdAt)}>
                      {latest.author} · {when(latest.update.createdAt)}
                      {latest.update.editedAt === undefined ? '' : ' · edited'}
                    </span>
                  )}
                  {/* Author-only, because the server refuses anybody else's edit. */}
                  {viewerId === latest.update.authorId && !editingLatest && (
                    <IconButton
                      size="sm"
                      className={styles.cardEdit}
                      icon={<PencilGlyph />}
                      aria-label="Edit update"
                      tooltip="Edit update"
                      onClick={() => setEditingLatest(true)}
                    />
                  )}
                </div>
                {editingLatest ? (
                  <ProjectUpdateEditor
                    update={latest.update}
                    onDone={() => setEditingLatest(false)}
                  />
                ) : (
                  latest.update.body !== '' && (
                    <p className={styles.cardBody}>{latest.update.body}</p>
                  )
                )}
              </li>
            </ul>
          )}

          {/* Correcting a post and writing the next one are the same decision made twice,
              so the composer stands down while the editor is open — which also keeps one
              "Health" control on the screen rather than two identically named ones. */}
          {!editingLatest && (
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
                <Button
                  {...healthMenu.props}
                  variant="secondary"
                  aria-label="Health"
                  icon={<HealthDot health={health} />}
                >
                  {PROJECT_UPDATE_HEALTH_LABEL[health]}
                </Button>
                <Menu
                  open={healthMenu.open}
                  onClose={healthMenu.hide}
                  trigger={healthMenu.ref}
                  label="Health"
                  items={healthItems}
                />
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
