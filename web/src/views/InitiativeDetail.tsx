/**
 * One initiative: what it is for, how far along it is, and the work that rolls up into it.
 *
 * The page is a reading column with a property rail beside it, which is the shape the issue
 * and project screens already take and the shape Linear draws this page in. The column opens
 * on the properties as a row of pills, then the update, then what the initiative is about,
 * then the work — because that is the order somebody arriving here reads in. It used to open
 * on a progress bar and a graph, which is the answer to a question nobody had asked yet.
 *
 * Progress moved into the rail for that reason. It is a summary of the Projects section
 * further down, and a summary belongs beside the page rather than ahead of it.
 *
 * Nothing here has a Save button. Every property writes on choice and the description writes
 * on blur, which is what `SaveIndicator` is for — the screen used to explain that arrangement
 * in a line of body copy ("Every property here saves on its own…"), and a sentence explaining
 * a save model is the shape of a missing indicator.
 *
 * The two "add" rows are `Section` "+" affordances over the shared pickers. An unbounded
 * `<select>` of every project in the workspace is unusable past a few dozen and offers no
 * way to search; the pickers rank and filter, and are the same ones the composer uses.
 * Removing a project and un-nesting an initiative both ask first: they are one click, they
 * throw away a link somebody made deliberately, and there is no undo for either.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useKeyContext } from '~/app/keymap';
import {
  Avatar,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  SaveIndicator,
  Section,
  Select,
  Textarea,
  useSaveState,
} from '~/components';
import { DescriptionEditor } from '~/editor/DescriptionEditor';
import {
  addInitiativeProject,
  addInitiativeRelation,
  createInitiative,
  removeInitiativeProject,
  removeInitiativeRelation,
  updateInitiative,
} from '~/features/initiatives/mutations';
import { InitiativePicker } from '~/features/initiatives/InitiativePicker';
import { createInitiativeUpdate } from '~/features/initiative-updates/mutations';
import { latestInitiativeUpdate } from '~/features/initiative-updates/helpers';
import { InitiativeGraph } from '~/features/initiatives/InitiativeGraph';
import { ProgressBar } from '~/features/initiatives/ProgressBar';
import { InitiativeProperties, InitiativeRailSection } from '~/features/initiatives/properties';
import { useInitiativeRailOpen } from '~/features/initiatives/rail';
import {
  initiativeProgress,
  listInitiativeProjectRows,
  type InitiativeProjectRow,
} from '~/features/initiatives/progress';
import { EntityIcon } from '~/features/icon/EntityIcon';
import { DEFAULT_ENTITY_COLOR } from '~/features/icon/glyphs';
import { InitiativeGlyph } from '~/features/initiatives/glyphs';
import { PlusGlyph } from '~/features/issue/glyphs';
import { ProjectGlyph } from '~/features/projects/glyphs';
import { ProjectPicker } from '~/features/projects/ProjectPicker';
import { personName } from '~/features/prefs/prefs';
import { exact, when, whenDay } from '~/features/time';
import { HealthDot, ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewerId } from '~/hooks/useViewer';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { ProjectUpdateHealth, Store, UUID } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './InitiativeDetail.module.css';

interface ChildRow {
  readonly id: UUID;
  readonly name: string;
  readonly icon: string | undefined;
  readonly color: string | undefined;
}

/** What a remove/un-nest confirmation is about, so one dialog serves both sections. */
interface Pending {
  readonly kind: 'project' | 'child';
  readonly id: UUID;
  readonly name: string;
}

const HEALTH_OPTIONS: readonly { readonly value: ProjectUpdateHealth; readonly label: string }[] = [
  { value: 'on_track', label: 'On track' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'off_track', label: 'Off track' },
];

export function InitiativeDetail() {
  const engine = useEngine();
  const viewerId = useViewerId();
  const { initiativeId = '' } = useParams<{ initiativeId: string }>();
  const railOpen = useInitiativeRailOpen();
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [health, setHealth] = useState<ProjectUpdateHealth>('on_track');
  const [nestedName, setNestedName] = useState('');
  const [nestError, setNestError] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const childPicker = useMenuTrigger();
  const projectPicker = useMenuTrigger();

  const saveState = useSaveState(describeRefusal);
  const { run: runSave } = saveState;

  useKeyContext('detail');

  const initiative = useLiveQuery(
    (store) => store.initiatives.get(initiativeId) ?? null,
    ['initiative'],
    [initiativeId],
  );

  const latest = useLiveQuery(
    (store) => latestInitiativeUpdate(store, initiativeId),
    ['initiativeUpdate', 'user'],
    [initiativeId],
  );

  const latestAuthor = useLiveQuery(
    (store) => {
      if (latest === undefined) return null;
      const author = store.users.get(latest.authorId);
      // `personName` rather than `.displayName`: the "full names" preference is one answer
      // for the whole product, and this screen and the list beside it disagreed on it.
      return author === undefined ? null : personName(author);
    },
    ['user', 'initiativeUpdate'],
    [initiativeId, latest?.authorId ?? ''],
  );

  const names = useLiveQuery(
    (store) => {
      const out: Record<string, string> = {};
      for (const user of store.users.values()) out[user.id] = personName(user);
      return out;
    },
    ['user'],
  );

  const projects = useLiveQuery(
    (store) => listInitiativeProjectRows(store, initiativeId),
    [
      'initiative',
      'initiativeProject',
      'initiativeRelation',
      'issue',
      'project',
      'projectStatus',
      'projectUpdate',
      'user',
    ],
    [initiativeId],
  );

  const progress = useLiveQuery(
    (store) => initiativeProgress(store, initiativeId),
    ['initiative', 'initiativeProject', 'initiativeRelation', 'issue', 'project'],
    [initiativeId],
  );

  const children = useLiveQuery(
    (store) => (initiative === null ? [] : listChildren(store, initiative.id)),
    ['initiative', 'initiativeRelation'],
    [initiativeId],
  );

  // The initiative itself and everything already under it: an initiative cannot be its own
  // parent, and offering a child that is already nested is offering a refusal.
  const excludedChildren = useMemo(
    () => new Set<UUID>([initiativeId, ...children.map((row) => row.id)]),
    [initiativeId, children],
  );

  if (initiative === null) return null;

  const onAddProject = async (projectId: UUID) => {
    setProjectError(null);
    try {
      await addInitiativeProject(engine, initiative.id, projectId);
    } catch (failure) {
      setProjectError(refusal(failure, 'That project could not be added.'));
    }
  };

  const onRemoveProject = async (projectId: UUID) => {
    setProjectError(null);
    try {
      await removeInitiativeProject(engine, initiative.id, projectId);
    } catch (failure) {
      setProjectError(refusal(failure, 'That project could not be removed.'));
    }
  };

  const onNestExisting = async (childId: UUID) => {
    setNestError(null);
    try {
      await addInitiativeRelation(engine, initiative.id, childId);
    } catch (failure) {
      setNestError(refusal(failure, 'That initiative could not be nested.'));
    }
  };

  const onCreateNested = async () => {
    const name = nestedName.trim();
    if (name === '') return;
    setNestError(null);
    setNestedName('');
    try {
      await createInitiative(engine, {
        name,
        ownerId: viewerId ?? undefined,
        parentInitiativeId: initiative.id,
      });
    } catch (failure) {
      setNestedName((current) => (current === '' ? name : current));
      setNestError(refusal(failure, 'That sub-initiative could not be created.'));
    }
  };

  const onUnnest = async (childId: UUID) => {
    setNestError(null);
    try {
      await removeInitiativeRelation(engine, initiative.id, childId);
    } catch (failure) {
      setNestError(refusal(failure, 'That initiative could not be un-nested.'));
    }
  };

  const onSubmitUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (posting || viewerId === null) return;
    setPosting(true);
    setUpdateError(null);
    try {
      await createInitiativeUpdate(engine, {
        initiativeId: initiative.id,
        health,
        body,
        authorId: viewerId,
      });
      setBody('');
    } catch (failure) {
      setUpdateError(refusal(failure, 'That update could not be posted.'));
    } finally {
      setPosting(false);
    }
  };

  const confirmPending = () => {
    if (pending === null) return;
    if (pending.kind === 'project') void onRemoveProject(pending.id);
    else void onUnnest(pending.id);
    setPending(null);
  };

  const started = projects.filter((row) => row.statusCategory === 'started').length;
  const finished = projects.filter((row) => row.statusCategory === 'completed').length;

  return (
    <div className={styles.screen}>
      <div className={styles.main}>
        <div className={styles.column}>
          {/* The first thing on the page, because it is the first thing somebody checks.
              Health is not repeated here: it is beside the name in the header, where it is
              readable from the Activity tab too. */}
          <InitiativeProperties initiativeId={initiative.id} variant="row" />

          {/*
            One card for the update, whether or not there is one yet. Linear's empty state is
            an invitation rather than a heading over a blank space, and the composer stays
            open beneath it: the reason an initiative has no updates is almost never that
            somebody could not find the form.
          */}
          {/*
            No `aria-labelledby` on the section, deliberately. Naming a region "Latest
            update" makes the region itself something `getByLabel('Update')` finds, and the
            composer inside it is what that query is looking for — a section that shadows its
            own field is worse than a section with no name. The heading is still a heading.
          */}
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>
              {latest === undefined ? 'Write first initiative update' : 'Latest update'}
            </h2>
            {latest === undefined ? null : (
              <div className={styles.latest}>
                <div className={styles.latestMeta}>
                  <ProjectHealthBadge health={latest.health} />
                  {latestAuthor !== null && (
                    <span className={styles.metaText} title={exact(latest.createdAt)}>
                      {latestAuthor} · {when(latest.createdAt)}
                    </span>
                  )}
                </div>
                {latest.body !== '' && <p className={styles.description}>{latest.body}</p>}
              </div>
            )}
            <form className={styles.form} onSubmit={onSubmitUpdate}>
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
                minRows={3}
                placeholder="What changed since the last update?"
                onChange={(event) => setBody(event.target.value)}
              />
              {updateError === null ? null : (
                <p className={styles.error} role="alert">
                  {updateError}
                </p>
              )}
              <div className={styles.addRow}>
                <Button type="submit" variant="primary" disabled={posting || viewerId === null}>
                  Post update
                </Button>
              </div>
            </form>
          </section>

          {/* Autosaving on blur, like every other description in the product. It used to sit
              behind an explicit Edit / Save / Cancel — the only entity here that worked that
              way, and the reason a description typed and then navigated away from was lost. */}
          <section className={styles.section} aria-labelledby="initiative-description">
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle} id="initiative-description">
                Description
              </h2>
              <SaveIndicator state={saveState.state} />
            </div>
            {saveState.error === undefined ? null : (
              <p className={styles.error} role="alert">
                {saveState.error}
              </p>
            )}
            <DescriptionEditor
              target={{ kind: 'initiative', id: initiative.id }}
              description={initiative.description}
              names={names}
              viewerId={viewerId}
              enterSubmits={false}
              onSave={(description) =>
                void runSave(() => updateInitiative(engine, initiative.id, { description }))
              }
            />
          </section>

          <Section
            title="Projects"
            count={projects.length === 0 ? undefined : projects.length}
            className={styles.section}
            action={
              <IconButton
                {...projectPicker.props}
                size="sm"
                icon={<PlusGlyph />}
                aria-label="Add a project"
                tooltip="Add a project"
              />
            }
          >
            {projects.length === 0 ? (
              <EmptyState
                title="No projects yet"
                description="Add the work streams that contribute to this initiative."
              />
            ) : (
              <ul className={styles.projectList}>
                {projects.map((row) => (
                  <ProjectRow
                    key={row.projectId}
                    row={row}
                    onRemove={() =>
                      setPending({ kind: 'project', id: row.projectId, name: row.name })
                    }
                  />
                ))}
              </ul>
            )}
            {projectError === null ? null : (
              <p className={styles.error} role="alert">
                {projectError}
              </p>
            )}
          </Section>

          <Section
            title="Sub-initiatives"
            count={children.length === 0 ? undefined : children.length}
            className={styles.section}
            action={
              <IconButton
                {...childPicker.props}
                size="sm"
                icon={<PlusGlyph />}
                aria-label="Nest an existing initiative"
                tooltip="Nest an existing initiative"
              />
            }
          >
            {children.length === 0 ? (
              <EmptyState
                title="No sub-initiatives"
                description="Nest an existing initiative, or start one under this objective."
              />
            ) : (
              <ul className={styles.projectList}>
                {children.map((row) => (
                  <li key={row.id} className={styles.childRow}>
                    <EntityIcon
                      icon={row.icon}
                      color={row.color ?? DEFAULT_ENTITY_COLOR}
                      fallback={<InitiativeGlyph />}
                    />
                    <Link to={`/initiative/${row.id}`} className={styles.projectLink}>
                      {row.name}
                    </Link>
                    <Button
                      variant="ghost"
                      onClick={() => setPending({ kind: 'child', id: row.id, name: row.name })}
                    >
                      Un-nest
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {nestError === null ? null : (
              <p className={styles.error} role="alert">
                {nestError}
              </p>
            )}
            <div className={styles.addRow}>
              <Input
                label="New sub-initiative"
                className={styles.addField}
                value={nestedName}
                onChange={(event) => setNestedName(event.target.value)}
              />
              <Button disabled={nestedName.trim() === ''} onClick={() => void onCreateNested()}>
                Create nested
              </Button>
            </div>
          </Section>
        </div>
      </div>

      {railOpen ? (
        <aside className={styles.rail} aria-label="Initiative properties">
          <InitiativeProperties initiativeId={initiative.id} variant="rail" />
          <InitiativeRailSection id="progress" title="Progress">
            <dl className={styles.counts}>
              <div className={styles.count}>
                <dt className={styles.countLabel}>Projects</dt>
                <dd className={styles.countValue}>{projects.length}</dd>
              </div>
              <div className={styles.count}>
                <dt className={styles.countLabel}>Started</dt>
                <dd className={styles.countValue}>{started}</dd>
              </div>
              <div className={styles.count}>
                <dt className={styles.countLabel}>Completed</dt>
                <dd className={styles.countValue}>{finished}</dd>
              </div>
            </dl>
            <ProgressBar progress={progress} label={initiative.name} />
            {/* Only once there is something to count. With no issues the bar already says
                "No issues", and a sentence under it saying so again is the third thing on
                this panel making the same claim. */}
            {progress.total === 0 ? null : (
              <p className={styles.muted}>
                {progress.completed} of {progress.total} issues completed
              </p>
            )}
            <InitiativeGraph initiativeId={initiative.id} />
          </InitiativeRailSection>
        </aside>
      ) : null}

      <InitiativePicker
        open={childPicker.open}
        onClose={childPicker.hide}
        trigger={childPicker.ref}
        label="Nest an initiative"
        value={null}
        noneLabel={null}
        exclude={excludedChildren}
        onSelect={(childId) => {
          if (childId !== null) void onNestExisting(childId);
        }}
      />
      <ProjectPicker
        open={projectPicker.open}
        onClose={projectPicker.hide}
        trigger={projectPicker.ref}
        value={null}
        onSelect={(projectId) => {
          if (projectId !== null) void onAddProject(projectId);
        }}
      />

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'child'
            ? `Un-nest ${pending.name}?`
            : `Remove ${pending?.name ?? 'this project'}?`
        }
        consequence={
          pending?.kind === 'child'
            ? 'It goes back to being a top-level initiative. Nothing inside it changes, and its projects stop rolling up here.'
            : 'The project leaves this initiative and stops counting towards its progress. The project itself, and its issues, are untouched.'
        }
        confirmLabel={pending?.kind === 'child' ? 'Un-nest' : 'Remove'}
        onConfirm={confirmPending}
        onClose={() => setPending(null)}
      />
    </div>
  );
}

/**
 * The server's own words when it has them.
 *
 * These sections talk to a domain that refuses things for reasons only it knows — a sixth
 * level of nesting, a nest that would close a cycle — and "something went wrong" would
 * leave the person guessing at a rule the API just named for them.
 */
function refusal(failure: unknown, fallback: string): string {
  return failure instanceof ApiError ? failure.message : fallback;
}

function describeRefusal(failure: unknown): string {
  return refusal(failure, 'That change could not be saved.');
}

/**
 * One contributing project: what it is, who has it, and how far along it is.
 *
 * The row leads with the project's own icon rather than with its status glyph. Both are
 * true, and only one of them tells two rows apart at a glance — the status is a word the
 * project list already carries a column for, and the icon is what somebody recognises the
 * project by everywhere else in the product.
 */
function ProjectRow({ row, onRemove }: { row: InitiativeProjectRow; onRemove: () => void }) {
  return (
    <li className={styles.projectRow}>
      <EntityIcon icon={row.icon} color={row.color} fallback={<ProjectGlyph />} />
      <Link to={`/project/${row.projectId}`} className={styles.projectLink}>
        {row.name}
      </Link>
      <span className={styles.projectHealth}>
        {row.health === null ? (
          <span className={styles.projectMuted}>No update</span>
        ) : (
          <ProjectHealthBadge health={row.health} compact />
        )}
      </span>
      <span className={styles.projectLead}>
        {row.leadName === null ? (
          <span className={styles.projectMuted}>No lead</span>
        ) : (
          <>
            <Avatar name={row.leadName} size="xs" colorKey={row.leadId} decorative />
            {row.leadName}
          </>
        )}
      </span>
      <span className={styles.projectTarget}>
        {row.targetDate === undefined ? (
          <span className={styles.projectMuted}>No target</span>
        ) : (
          whenDay(row.targetDate)
        )}
      </span>
      <span className={styles.projectProgress}>
        <ProgressBar progress={row.progress} label={row.name} compact />
      </span>
      {row.direct ? (
        <Button variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      ) : (
        // Inherited from a sub-initiative. Removing it here would have to reach into the
        // initiative that owns the link, which is not what a button on this row looks like
        // it does — so this row says where the project comes from instead.
        <span className={styles.projectMuted}>Via a sub-initiative</span>
      )}
    </li>
  );
}

function listChildren(store: Store, initiativeId: UUID): readonly ChildRow[] {
  const rows: ChildRow[] = [];
  for (const childId of store.initiativeChildIdsFor(initiativeId)) {
    const child = store.initiatives.get(childId);
    if (child === undefined || child.archivedAt !== undefined || child.deletedAt !== undefined) {
      continue;
    }
    rows.push({ id: child.id, name: child.name, icon: child.icon, color: child.color });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
