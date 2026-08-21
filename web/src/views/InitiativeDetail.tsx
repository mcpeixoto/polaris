/**
 * One initiative overview — properties, description, and curated projects.
 *
 * Create only asked for a name. The rest of Linear's fields already existed on the wire
 * (status, priority, owner, lead team, target date, archive) and this screen never offered
 * them, so an initiative could only be planned-with-no-owner for the rest of its life.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, EmptyState, Input, PRIORITY_LEVELS, priorityLabel, Select } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import {
  addInitiativeProject,
  archiveInitiative,
  formatInitiativeStatus,
  removeInitiativeProject,
  updateInitiative,
} from '~/features/initiatives/mutations';
import { report } from '~/features/issue/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { InitiativeStatus, Store, UUID } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './InitiativeDetail.module.css';

interface ProjectLinkRow {
  readonly linkId: UUID;
  readonly projectId: UUID;
  readonly name: string;
}

const STATUSES: readonly InitiativeStatus[] = [
  'proposed',
  'planned',
  'active',
  'completed',
  'canceled',
];

export function InitiativeDetail() {
  const navigate = useNavigate();
  const engine = useEngine();
  const { initiativeId = '' } = useParams<{ initiativeId: string }>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [chosenProject, setChosenProject] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const initiative = useLiveQuery(
    (store) => store.initiatives.get(initiativeId) ?? null,
    ['initiative'],
    [initiativeId],
  );

  const people = useLiveQuery(
    (store) =>
      [...store.users.values()]
        .filter((user) => user.archivedAt === undefined && user.status === 'active')
        .map((user) => ({ id: user.id, name: user.displayName }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['user'],
  );

  const teams = useLiveQuery(
    (store) =>
      [...store.teams.values()]
        .filter((team) => team.archivedAt === undefined && team.retiredAt === undefined)
        .map((team) => ({ id: team.id, name: team.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['team'],
  );

  const projects = useLiveQuery(
    (store) => (initiative === null ? [] : listProjects(store, initiative.id)),
    ['initiative', 'initiativeProject', 'project'],
    [initiativeId],
  );

  const linkedProjectIds = useMemo(() => new Set(projects.map((row) => row.projectId)), [projects]);

  const availableProjects = useLiveQuery(
    (store) =>
      [...store.projects.values()]
        .filter(
          (project) =>
            project.archivedAt === undefined &&
            project.deletedAt === undefined &&
            !linkedProjectIds.has(project.id),
        )
        .map((project) => ({ id: project.id, name: project.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['project'],
    [initiativeId, [...linkedProjectIds].join(',')],
  );

  if (initiative === null) {
    return (
      <EmptyState
        title="No such initiative"
        description="It may have been archived or deleted."
        action={<Button onClick={() => navigate(-1)}>Go back</Button>}
      />
    );
  }

  const save = (fields: Parameters<typeof updateInitiative>[2]) => {
    updateInitiative(engine, initiative.id, fields).catch(report);
  };

  const startEdit = () => {
    setDraft(initiative.description);
    setEditing(true);
  };

  const saveDescription = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await updateInitiative(engine, initiative.id, { description: draft });
      setEditing(false);
    } catch (failure) {
      report(failure);
    } finally {
      setSaving(false);
    }
  };

  const onAddProject = async () => {
    if (chosenProject === '') return;
    await addInitiativeProject(engine, initiative.id, chosenProject);
    setChosenProject('');
  };

  const onRemoveProject = async (projectId: UUID) => {
    await removeInitiativeProject(engine, initiative.id, projectId);
  };

  const confirmArchive = () => {
    setArchiveBusy(true);
    setArchiveError(null);
    archiveInitiative(engine, initiative.id)
      .then(() => {
        setArchiveBusy(false);
        setArchiving(false);
        void navigate('/initiatives');
      })
      .catch((failure: unknown) => {
        setArchiveBusy(false);
        setArchiveError(
          failure instanceof ApiError ? failure.message : 'That initiative could not be archived.',
        );
      });
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{initiative.name}</h1>
          <span className={styles.status}>{formatInitiativeStatus(initiative.status)}</span>
          <Button variant="ghost" onClick={() => setArchiving(true)}>
            Archive
          </Button>
        </div>
      </header>

      <section className={styles.section} aria-labelledby="properties-heading">
        <h2 className={styles.sectionTitle} id="properties-heading">
          Properties
        </h2>
        <p className={styles.muted}>
          Writes land as you leave a field. There is no Save — status and owner are independent
          decisions.
        </p>
        <div className={styles.properties}>
          <Input
            label="Name"
            defaultValue={initiative.name}
            key={`name:${initiative.name}`}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name === '' || name === initiative.name) return;
              save({ name });
            }}
          />
          <Select
            label="Status"
            value={initiative.status}
            onChange={(event) => save({ status: event.target.value as InitiativeStatus })}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {formatInitiativeStatus(status)}
              </option>
            ))}
          </Select>
          <Select
            label="Priority"
            value={String(initiative.priority)}
            onChange={(event) => save({ priority: Number(event.target.value) })}
          >
            {PRIORITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {priorityLabel(level)}
              </option>
            ))}
          </Select>
          <Select
            label="Owner"
            value={initiative.ownerId ?? ''}
            onChange={(event) =>
              save({ ownerId: event.target.value === '' ? null : event.target.value })
            }
          >
            <option value="">No owner</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
          <Select
            label="Lead team"
            hint="A private lead team hides this initiative from everyone else."
            value={initiative.leadTeamId ?? ''}
            onChange={(event) =>
              save({ leadTeamId: event.target.value === '' ? null : event.target.value })
            }
          >
            <option value="">No lead team</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
          <Input
            label="Target date"
            type="date"
            value={initiative.targetDate ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              save({ targetDate: value === '' ? null : value });
            }}
          />
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Description</h2>
        {editing ? (
          <form onSubmit={saveDescription}>
            <textarea
              className={styles.descriptionInput}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className={styles.addRow}>
              <Button type="submit" variant="primary" loading={saving}>
                Save
              </Button>
              <Button type="button" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            {initiative.description === '' ? (
              <p className={styles.muted}>No description yet.</p>
            ) : (
              <p className={styles.description}>{initiative.description}</p>
            )}
            <Button onClick={startEdit}>Edit description</Button>
          </>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Projects</h2>
        {projects.length === 0 ? (
          <p className={styles.muted}>
            No projects linked yet. Add contributing work streams below.
          </p>
        ) : (
          <ul className={styles.projectList}>
            {projects.map((row) => (
              <li key={row.linkId} className={styles.projectRow}>
                <Link to={`/project/${row.projectId}`} className={styles.projectLink}>
                  {row.name}
                </Link>
                <Button variant="ghost" onClick={() => void onRemoveProject(row.projectId)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.addRow}>
          <Select
            label="Project to add"
            hideLabel
            value={chosenProject}
            onChange={(event) => setChosenProject(event.target.value)}
            disabled={availableProjects.length === 0}
          >
            <option value="">Choose a project…</option>
            {availableProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
          <Button disabled={chosenProject === ''} onClick={() => void onAddProject()}>
            Add
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={archiving}
        title={`Archive ${initiative.name}?`}
        consequence="It leaves the Initiatives list. Linked projects stay where they are. There is no archives page for initiatives yet, so bringing it back is an API call."
        confirmLabel="Archive"
        destructive
        busy={archiveBusy}
        error={archiveError ?? undefined}
        onConfirm={confirmArchive}
        onClose={() => {
          if (archiveBusy) return;
          setArchiving(false);
          setArchiveError(null);
        }}
      />
    </div>
  );
}

function listProjects(store: Store, initiativeId: UUID): readonly ProjectLinkRow[] {
  const rows: ProjectLinkRow[] = [];
  for (const linkId of store.initiativeProjectIdsFor(initiativeId)) {
    const link = store.initiativeProjects.get(linkId);
    if (link === undefined) continue;
    const project = store.projects.get(link.projectId);
    if (project === undefined || project.archivedAt !== undefined) continue;
    rows.push({ linkId, projectId: project.id, name: project.name });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
