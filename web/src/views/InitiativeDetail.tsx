/**
 * One initiative: what it is for, how far along it is, and the work that rolls up into it.
 *
 * The page is a reading column with a property rail beside it, which is the shape the issue
 * and project screens already take and the shape Linear draws this page in. The column opens
 * on the initiative's mark and its name, then the properties as a row of pills, then the
 * update, then what the initiative is about, then the work — because that is the order
 * somebody arriving here reads in. It used to open on a progress bar and a graph, which is
 * the answer to a question nobody had asked yet.
 *
 * The name is here rather than in the trail above it, and so is the rename: this is the
 * page's heading, and a heading belongs to the page rather than to the chrome. `e` and
 * Escape are registered here for the same reason — a shortcut registered by the surface that
 * owns the control it opens is a shortcut that cannot outlive it.
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

import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import {
  Avatar,
  Button,
  ConfirmDialog,
  DatePicker,
  EmptyState,
  IconButton,
  Input,
  PropertyTrigger,
  SaveIndicator,
  Section,
  TitleField,
  useSaveState,
  type TitleHandle,
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
import { InitiativeUpdateForm } from '~/features/initiative-updates/InitiativeUpdateComposer';
import { latestInitiativeUpdate } from '~/features/initiative-updates/helpers';
import { InitiativeGraph } from '~/features/initiatives/InitiativeGraph';
import { ProgressBar } from '~/features/initiatives/ProgressBar';
import { InitiativeProperties, InitiativeRailSection } from '~/features/initiatives/properties';
import { useInitiativeOutlet } from '~/features/initiatives/outlet';
import {
  initiativeProgress,
  listInitiativeProjectRows,
  type InitiativeProjectRow,
} from '~/features/initiatives/progress';
import { EntityIcon } from '~/features/icon/EntityIcon';
import { IconPicker } from '~/features/icon/IconPicker';
import { DEFAULT_ENTITY_COLOR } from '~/features/icon/glyphs';
import { InitiativeGlyph } from '~/features/initiatives/glyphs';
import { PlusGlyph } from '~/features/issue/glyphs';
import { CalendarGlyph, NoPersonGlyph, ProjectGlyph } from '~/features/projects/glyphs';
import { updateProject } from '~/features/projects/mutations';
import { ProjectPicker } from '~/features/projects/ProjectPicker';
import { ProjectUpdateComposer } from '~/features/project-updates/ProjectUpdateComposer';
import { UserPicker } from '~/features/members/UserPicker';
import { personName } from '~/features/prefs/prefs';
import { exact, when, whenDay } from '~/features/time';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { PROJECT_UPDATE_HEALTH_LABEL, updateAge } from '~/features/project-updates/helpers';
import { report } from '~/features/issue/mutations';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewer, useViewerId } from '~/hooks/useViewer';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store, UUID } from '~/store';
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

/** Which property of a contributing project a row is currently editing. */
type ProjectProperty = 'health' | 'lead' | 'target';

export function InitiativeDetail() {
  const engine = useEngine();
  const viewer = useViewer();
  const viewerId = useViewerId();
  const { initiativeId = '' } = useParams<{ initiativeId: string }>();
  const { railOpen, openMenuAt } = useInitiativeOutlet();
  const [nestedName, setNestedName] = useState('');
  const [nestError, setNestError] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const childPicker = useMenuTrigger();
  const projectPicker = useMenuTrigger();
  const titleIcon = useMenuTrigger('dialog');
  const titleRef = useRef<TitleHandle | null>(null);

  /**
   * One picker for the whole Projects section, and the cell it is currently pointed at.
   *
   * A picker per row would be one panel per project to serve the single open one, and the
   * row that owns an open panel goes away the moment a project is unlinked. So the panels
   * are singletons and the anchor moves — `showFrom` is the hook's answer to exactly this,
   * and the same call the initiatives list makes about its own rows.
   */
  const projectProperty = useMenuTrigger<HTMLElement>();
  const [editing, setEditing] = useState<{ property: ProjectProperty; id: UUID } | null>(null);
  const openProjectProperty = useCallback(
    (property: ProjectProperty, id: UUID, element: HTMLElement) => {
      setEditing({ property, id });
      projectProperty.showFrom(element);
    },
    [projectProperty],
  );
  const closeProjectProperty = useCallback(() => {
    projectProperty.hide();
    setEditing(null);
  }, [projectProperty]);

  const saveState = useSaveState(describeRefusal);
  const { run: runSave } = saveState;

  useKeyContext('detail');
  useActions(
    [
      {
        id: 'initiative.rename',
        title: 'Rename initiative',
        keys: ['e'],
        when: 'detail',
        group: 'Initiatives',
        run: () => titleRef.current?.focus(),
      },
      {
        // Escape while the name is being typed abandons the edit. Registered here rather
        // than inside the field for the reason every other one is: the registry lives above
        // it, and an unfocused field must not be holding Escape hostage from the rail.
        id: 'initiative.rename.cancel',
        title: 'Stop renaming the initiative',
        keys: ['Escape'],
        when: 'detail',
        group: 'Initiatives',
        enabled: () => titleRef.current?.editing() === true,
        run: () => titleRef.current?.revert(),
      },
    ],
    [initiativeId],
  );

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

  // The row the open panel belongs to, looked up rather than held: the picker outlives a
  // re-query of the section, and a row captured in state would keep answering with the
  // lead somebody has just changed.
  const editingProject =
    editing === null ? null : (projects.find((row) => row.projectId === editing.id) ?? null);

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
          {/*
            The mark, then the name. A `<header>` rather than a `<div>`, because this block
            is the page's own heading and because a right-click here is a right-click on the
            initiative — which the shell answers with the `…` menu it already owns.
          */}
          <header
            className={styles.titleBlock}
            onContextMenu={(event) => {
              // A descendant that already answered this right-click owns it: the name is an
              // editable field, and a text field's own menu is the one somebody wants there.
              if (event.defaultPrevented) return;
              event.preventDefault();
              openMenuAt(event.clientX, event.clientY);
            }}
          >
            <button
              {...titleIcon.props}
              type="button"
              className={styles.mark}
              aria-label="Set initiative icon"
            >
              <EntityIcon
                icon={initiative.icon}
                color={initiative.color ?? DEFAULT_ENTITY_COLOR}
                fallback={<InitiativeGlyph />}
                size="lg"
              />
            </button>
            {/* The heading, out of the page and still in the accessibility tree, with the
                editable name beside it — the arrangement `IssueDetail` settled on. A
                `<textarea>` inside an `<h1>` gives the heading no accessible name at all,
                and the heading list is how somebody with a screen reader finds out which
                initiative they opened. This is the screen's only heading. */}
            <h1 className={styles.screenTitle}>{initiative.name}</h1>
            <TitleField
              key={`initiative-title-${initiative.id}`}
              subjectId={initiative.id}
              value={initiative.name}
              label="Name"
              handle={titleRef}
              className={styles.titleField}
              onSave={(name) => updateInitiative(engine, initiative.id, { name }).catch(report)}
            />
          </header>

          {/* The properties, and the health beside them: what somebody checks before
              reading a word of the page. */}
          <div className={styles.pills}>
            <InitiativeProperties initiativeId={initiative.id} variant="row" />
            {/* Marked rather than named, the way the project header's cell is (#233). An
                accessible name with "health" in it also answers the update composer's own
                `getByLabel('Health')` under Playwright's substring matching, and the badge
                inside already says the word and the age to a screen reader — so there is
                nothing here for ARIA to add, only something for a test to aim at. */}
            <div className={styles.health} data-testid="initiative-health">
              {latest === undefined ? (
                <span className={styles.muted}>No updates</span>
              ) : (
                <ProjectHealthBadge health={latest.health} since={updateAge(latest.createdAt)} />
              )}
            </div>
          </div>

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
            {/* The form itself lives beside the mutation it calls, because the initiatives
                list posts the same update from its own health cell and two copies of one
                composer is how one of them stops trimming a blank body. */}
            <InitiativeUpdateForm
              initiativeId={initiative.id}
              {...(latest === undefined ? null : { initialHealth: latest.health })}
              onPosted={() => {}}
            />
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
                    openProperty={
                      projectProperty.open && editing?.id === row.projectId
                        ? editing.property
                        : null
                    }
                    onProperty={(property, element) =>
                      openProjectProperty(property, row.projectId, element)
                    }
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

      <IconPicker
        open={titleIcon.open}
        onClose={titleIcon.hide}
        trigger={titleIcon.ref}
        value={{ icon: initiative.icon ?? '', color: initiative.color ?? DEFAULT_ENTITY_COLOR }}
        onChange={(next) => {
          // One half per act — the picker never sends both, so neither does the mutation.
          const fields =
            next.icon === (initiative.icon ?? '') ? { color: next.color } : { icon: next.icon };
          void updateInitiative(engine, initiative.id, fields).catch(report);
        }}
        actionId="initiativeDetail.closeTitleIconPicker"
        label="Initiative icon"
      />

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

      {/*
        The three contributing-project cells that were facts and are now controls. They write
        to the *project*, not to this initiative — a lead is the project's lead wherever it is
        drawn, and the only thing this screen contributes is a second place to reach it.

        Health is the exception that proves it: it is not a field on anything, it is the
        newest project update's word, so the cell opens the composer the project overview
        owns rather than a picker over a value nobody stores.
      */}
      <UserPicker
        open={projectProperty.open && editing?.property === 'lead'}
        onClose={closeProjectProperty}
        trigger={projectProperty.ref}
        label="Lead"
        noneLabel="No lead"
        filterPlaceholder="Set lead…"
        value={editingProject?.leadId ?? null}
        onSelect={(leadId) => {
          const projectId = editingProject?.projectId;
          closeProjectProperty();
          if (projectId !== undefined) updateProject(engine, projectId, { leadId }).catch(report);
        }}
      />
      <DatePicker
        open={projectProperty.open && editing?.property === 'target'}
        onClose={closeProjectProperty}
        trigger={projectProperty.ref}
        actionId="initiativeDetail.closeProjectTargetPicker"
        actionGroup="Initiatives"
        label="Target date"
        clearLabel="No target date"
        timezone={viewer?.timezone ?? 'UTC'}
        value={editingProject?.targetDate ?? null}
        onSelect={(day) => {
          const projectId = editingProject?.projectId;
          closeProjectProperty();
          if (projectId !== undefined) {
            updateProject(engine, projectId, { targetDate: day }).catch(report);
          }
        }}
      />
      <ProjectUpdateComposer
        open={projectProperty.open && editing?.property === 'health'}
        onClose={closeProjectProperty}
        trigger={projectProperty.ref}
        projectId={editingProject?.projectId ?? ''}
        {...(editingProject?.health == null ? null : { initialHealth: editingProject.health })}
        actionId="initiativeDetail.closeProjectUpdateComposer"
        actionGroup="Initiatives"
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
 *
 * Health, lead and target are editable where they are read. The row is not a link — only
 * the name is — so the cells need no `stopPropagation` of their own; `PropertyTrigger` does
 * it anyway, which is what lets the same three cells work unchanged on a list whose whole
 * row is an anchor.
 */
function ProjectRow({
  row,
  openProperty,
  onProperty,
  onRemove,
}: {
  readonly row: InitiativeProjectRow;
  /** Which of this row's panels is the one currently showing, if any. */
  readonly openProperty: ProjectProperty | null;
  readonly onProperty: (property: ProjectProperty, element: HTMLElement) => void;
  readonly onRemove: () => void;
}) {
  return (
    <li className={styles.projectRow}>
      <EntityIcon icon={row.icon} color={row.color} fallback={<ProjectGlyph />} />
      <Link to={`/project/${row.projectId}`} className={styles.projectLink}>
        {row.name}
      </Link>
      <span className={styles.projectHealth}>
        {/* A plus rather than a health mark, because the act is not "choose a health" — it
            is "post an update", and the mark beside it is the last one somebody posted. */}
        {/* "No health", not "No update", although the cell beside it says the latter. The
            trigger's name is the *value* of the property it opens, which is the health; and
            a control answering to "update" is a control the composer's own "Update" field
            has to share a name with on the screen this row sits on. */}
        <PropertyTrigger
          name={row.health === null ? 'No health' : PROJECT_UPDATE_HEALTH_LABEL[row.health]}
          action="Post an update"
          open={openProperty === 'health'}
          onOpen={(element) => onProperty('health', element)}
        >
          <PlusGlyph />
        </PropertyTrigger>
        {row.health === null ? (
          <span className={styles.projectMuted}>No update</span>
        ) : (
          <ProjectHealthBadge health={row.health} compact />
        )}
      </span>
      <span className={styles.projectLead}>
        <PropertyTrigger
          name={row.leadName ?? 'Unassigned'}
          action="Set lead"
          open={openProperty === 'lead'}
          onOpen={(element) => onProperty('lead', element)}
        >
          {row.leadName === null ? (
            <NoPersonGlyph />
          ) : (
            <Avatar name={row.leadName} size="xs" colorKey={row.leadId} decorative />
          )}
        </PropertyTrigger>
        {row.leadName === null ? (
          <span className={styles.projectMuted}>No lead</span>
        ) : (
          row.leadName
        )}
      </span>
      <span className={styles.projectTarget}>
        <PropertyTrigger
          name={row.targetDate === undefined ? 'No target date' : whenDay(row.targetDate)}
          action="Set target date"
          open={openProperty === 'target'}
          onOpen={(element) => onProperty('target', element)}
        >
          <CalendarGlyph />
        </PropertyTrigger>
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
