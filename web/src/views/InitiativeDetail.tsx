/**
 * One initiative overview — description and curated projects.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, EmptyState, Select } from '~/components';
import {
  addInitiativeProject,
  removeInitiativeProject,
  updateInitiativeDescription,
} from '~/features/initiatives/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store, UUID } from '~/store';
import styles from './InitiativeDetail.module.css';

interface ProjectLinkRow {
  readonly linkId: UUID;
  readonly projectId: UUID;
  readonly name: string;
}

export function InitiativeDetail() {
  const navigate = useNavigate();
  const engine = useEngine();
  const { initiativeId = '' } = useParams<{ initiativeId: string }>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [chosenProject, setChosenProject] = useState('');

  const initiative = useLiveQuery(
    (store) => store.initiatives.get(initiativeId) ?? null,
    ['initiative'],
    [initiativeId],
  );

  const ownerName = useLiveQuery(
    (store) =>
      initiative?.ownerId === undefined
        ? null
        : (store.users.get(initiative.ownerId)?.name ?? null),
    ['user', 'initiative'],
    [initiativeId, initiative?.ownerId ?? ''],
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

  const startEdit = () => {
    setDraft(initiative.description);
    setEditing(true);
  };

  const saveDescription = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await updateInitiativeDescription(engine, initiative.id, draft);
      setEditing(false);
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

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{initiative.name}</h1>
          <span className={styles.status}>{initiative.status}</span>
        </div>
        <div className={styles.meta}>
          {ownerName !== null && <span>Owner · {ownerName}</span>}
          {initiative.targetDate !== undefined && <span>Target · {initiative.targetDate}</span>}
        </div>
      </header>

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
