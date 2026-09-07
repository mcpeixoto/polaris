/**
 * New document: which team it belongs to, optionally which project, and what it is called.
 *
 * The old create was a text field in the documents header whose button went disabled when
 * the field was empty — a control that refuses without saying why — and it could only work
 * on `/team/:key/documents` or `/project/:id/documents`, because those routes were the only
 * place a team id came from. `CreateDocumentInput.teamId` is required, so anywhere else in
 * the product there was simply no way to make one. This asks for the team, which is what
 * lets `document.create` live in ⌘K beside every other create in the shell.
 *
 * It is `sm` and not the composer shape: a document has three properties and its body is
 * written on the screen this opens, so a full-height dialog would be a large empty box
 * asking three small questions.
 *
 * The team pill is seeded from the path rather than from a prop, because the shell mounts
 * this dialog outside `<Routes>` and therefore has no params of its own. Somebody who asks
 * for a document while looking at a team's documents means that team, and being asked again
 * is the kind of small insult that makes people avoid a dialog.
 */

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Input, Menu, Modal, PropertyPill } from '~/components';
import { useDialogSubmit } from '~/hooks/useDialogSubmit';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import type { Store, UUID } from '~/store';

import { createDocument } from './mutations';
import styles from './CreateDocumentModal.module.css';

export interface CreateDocumentModalProps {
  /**
   * Whether the dialog is up. Mounted for the shell's lifetime and told, so it can animate
   * out and so a shut dialog claims neither the `modal` key context nor ⌘⏎.
   */
  open?: boolean | undefined;
  onClose(): void;
}

/**
 * The team and project a documents route is already looking at.
 *
 * Exported for its own test: it is the one piece of this dialog that reads the URL, and a
 * regexp over a pathname is exactly the kind of thing that quietly stops matching.
 */
export function seedFromPath(store: Store, pathname: string): { teamId?: UUID; projectId?: UUID } {
  const team = /^\/team\/([^/]+)\/documents$/.exec(pathname);
  if (team !== null) {
    const key = decodeURIComponent(team[1] ?? '');
    const found = [...store.teams.values()].find((candidate) => candidate.key === key);
    return found === undefined ? {} : { teamId: found.id };
  }

  const project = /^\/project\/([^/]+)\/documents$/.exec(pathname);
  if (project !== null) {
    const id = project[1] ?? '';
    const found = store.projects.get(id);
    if (found === undefined) return {};
    for (const joinId of store.projectTeamIdsFor(found.id)) {
      const join = store.get('projectTeam', joinId);
      if (join !== undefined) return { teamId: join.teamId, projectId: found.id };
    }
    return { projectId: found.id };
  }

  return {};
}

export function CreateDocumentModal({ open = true, onClose }: CreateDocumentModalProps) {
  const engine = useEngine();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const formId = useId();
  const titleRef = useRef<HTMLInputElement>(null);

  const teamPill = useMenuTrigger();
  const projectPill = useMenuTrigger();

  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<UUID | null>(null);
  const [projectId, setProjectId] = useState<UUID | null>(null);
  const { saving, error, submit, submitRef } = useDialogSubmit('The document could not be created');

  const teams = useLiveQuery(
    (store) =>
      [...store.teams.values()]
        .filter((team) => team.archivedAt === undefined)
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['team'],
    [],
  );

  const projects = useLiveQuery(
    (store) => (teamId === null ? [] : projectsOn(store, teamId)),
    ['project', 'projectTeam'],
    [teamId ?? ''],
  );

  const seed = useMemo(() => seedFromPath(engine.store, pathname), [engine.store, pathname]);

  // Seeded each time it opens rather than once at mount: the shell keeps this component for
  // the life of the session, so a dialog that read the path only on mount would offer the
  // first screen of the session forever.
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setTitleError(null);
    setTeamId(seed.teamId ?? teams[0]?.id ?? null);
    setProjectId(seed.projectId ?? null);
  }, [open, seed.teamId, seed.projectId, teams]);

  const team = teams.find((candidate) => candidate.id === teamId) ?? null;
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;

  const save = async () => {
    const trimmed = title.trim();
    if (trimmed === '') {
      setTitleError('A document needs a title');
      titleRef.current?.focus();
      return;
    }
    if (teamId === null) {
      setTitleError('Pick a team for this document');
      return;
    }
    await submit(async () => {
      const id = await createDocument(engine, {
        teamId,
        projectId: projectId ?? undefined,
        title: trimmed,
      });
      onClose();
      // Into the editor with the body ready to be written in, which is the whole point of
      // making one: the old flow landed on a document and left the caret nowhere.
      if (id !== '') void navigate(`/document/${id}`, { state: { focusBody: true } });
    });
  };

  // Reassigned every render and read at dispatch: the registry keeps the action object it
  // was handed, so a `run` closing over this render would file the dialog as it opened.
  submitRef.current = () => void save();

  useKeyContext('modal', open);
  useActions(
    open
      ? [
          {
            id: 'document.create.submit',
            title: 'Create document',
            keys: ['mod+Enter'],
            when: 'modal',
            group: 'Documents',
            hidden: true,
            run: () => submitRef.current(),
          },
        ]
      : [],
    [open],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New document"
      size="sm"
      initialFocus={titleRef}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button form={formId} type="submit" variant="primary" loading={saving}>
            Create document
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className={styles.form}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void save();
        }}
      >
        <Input
          ref={titleRef}
          label="Title"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setTitleError(null);
          }}
          error={titleError ?? undefined}
          placeholder="Runbook"
        />

        <div className={styles.pills}>
          <PropertyPill
            {...teamPill.props}
            name="Team"
            describe={`${formId}-team`}
            empty={team === null ? 'No team' : undefined}
          >
            {team?.name ?? 'Team'}
          </PropertyPill>
          <Menu
            open={teamPill.open}
            onClose={teamPill.hide}
            trigger={teamPill.ref}
            label="Team"
            filterable={teams.length > 8}
            filterPlaceholder="Filter teams"
            emptyLabel="No teams"
            items={teams.map((candidate) => ({
              id: candidate.id,
              label: candidate.name,
              selected: candidate.id === teamId,
              onSelect: () => {
                setTeamId(candidate.id);
                // A project belongs to a team; changing the team leaves the old one
                // pointing at a project this document could not be filed under.
                if (candidate.id !== teamId) setProjectId(null);
              },
            }))}
          />

          <PropertyPill
            {...projectPill.props}
            name="Project"
            describe={`${formId}-project`}
            empty={project === null ? 'No project' : undefined}
          >
            {project?.name ?? 'Project'}
          </PropertyPill>
          <Menu
            open={projectPill.open}
            onClose={projectPill.hide}
            trigger={projectPill.ref}
            label="Project"
            filterable={projects.length > 8}
            filterPlaceholder="Filter projects"
            emptyLabel="No projects on this team"
            items={[
              {
                id: 'none',
                label: 'No project',
                selected: projectId === null,
                onSelect: () => setProjectId(null),
              },
              ...projects.map((candidate) => ({
                id: candidate.id,
                label: candidate.name,
                selected: candidate.id === projectId,
                onSelect: () => setProjectId(candidate.id),
              })),
            ]}
          />
        </div>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/** The team's projects, through the join the store keeps between the two. */
function projectsOn(store: Store, teamId: UUID) {
  return [...store.projects.values()]
    .filter(
      (project) =>
        project.archivedAt === undefined &&
        [...store.projectTeamIdsFor(project.id)].some(
          (id) => store.get('projectTeam', id)?.teamId === teamId,
        ),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
