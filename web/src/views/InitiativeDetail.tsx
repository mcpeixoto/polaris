/**
 * One initiative overview — properties, latest update, description, and curated projects.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Input, LabelChip, PRIORITY_LEVELS, priorityLabel, Select } from '~/components';
import {
  addInitiativeProject,
  addInitiativeRelation,
  createInitiative,
  formatInitiativeStatus,
  removeInitiativeProject,
  removeInitiativeRelation,
  updateInitiative,
} from '~/features/initiatives/mutations';
import {
  applyInitiativeLabel,
  removeInitiativeLabel,
} from '~/features/initiative-labels/mutations';
import { InitiativeLabelPicker } from '~/features/initiative-labels/InitiativeLabelPicker';
import { createInitiativeUpdate } from '~/features/initiative-updates/mutations';
import { latestInitiativeUpdate } from '~/features/initiative-updates/helpers';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { report } from '~/features/issue/mutations';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewerId } from '~/hooks/useViewer';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { InitiativeLabel, InitiativeStatus, ProjectUpdateHealth, Store, UUID } from '~/store';
import styles from './InitiativeDetail.module.css';

interface ProjectLinkRow {
  readonly linkId: UUID;
  readonly projectId: UUID;
  readonly name: string;
}

interface ChildRow {
  readonly id: UUID;
  readonly name: string;
}

const STATUSES: readonly InitiativeStatus[] = [
  'proposed',
  'planned',
  'active',
  'completed',
  'canceled',
];

const HEALTH_OPTIONS: readonly { readonly value: ProjectUpdateHealth; readonly label: string }[] = [
  { value: 'on_track', label: 'On track' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'off_track', label: 'Off track' },
];

export function InitiativeDetail() {
  const engine = useEngine();
  const viewerId = useViewerId();
  const { initiativeId = '' } = useParams<{ initiativeId: string }>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [chosenProject, setChosenProject] = useState('');
  const [chosenChild, setChosenChild] = useState('');
  const [nestedName, setNestedName] = useState('');
  const [health, setHealth] = useState<ProjectUpdateHealth>('on_track');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const labelsMenu = useMenuTrigger();

  useKeyContext('detail');
  useActions(
    [
      {
        id: 'initiativeDetail.labels',
        title: 'Set labels',
        keys: ['l'],
        when: 'detail',
        group: 'Initiatives',
        run: () => labelsMenu.show(),
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
    (store) =>
      latest === undefined ? null : (store.users.get(latest.authorId)?.displayName ?? null),
    ['user', 'initiativeUpdate'],
    [initiativeId, latest?.authorId ?? ''],
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

  const labelIds = useLiveQuery(
    (store) => [...store.initiativeLabelIdsFor(initiativeId)],
    ['initiativeLabel', 'initiativeLabelLink'],
    [initiativeId],
  );

  const appliedLabels = useLiveQuery(
    (store) =>
      [...store.initiativeLabelIdsFor(initiativeId)]
        .map((id) => store.initiativeLabels.get(id))
        .filter(
          (label): label is InitiativeLabel =>
            label !== undefined && label.archivedAt === undefined,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['initiativeLabel', 'initiativeLabelLink'],
    [initiativeId],
  );

  const children = useLiveQuery(
    (store) => (initiative === null ? [] : listChildren(store, initiative.id)),
    ['initiative', 'initiativeRelation'],
    [initiativeId],
  );

  const childIds = useMemo(() => new Set(children.map((row) => row.id)), [children]);

  const nestable = useLiveQuery(
    (store) =>
      [...store.initiatives.values()]
        .filter(
          (row) =>
            row.id !== initiativeId &&
            row.archivedAt === undefined &&
            row.deletedAt === undefined &&
            !childIds.has(row.id),
        )
        .map((row) => ({ id: row.id, name: row.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['initiative', 'initiativeRelation'],
    [initiativeId, [...childIds].join(',')],
  );

  if (initiative === null) return null;

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

  const onNestExisting = async () => {
    if (chosenChild === '') return;
    await addInitiativeRelation(engine, initiative.id, chosenChild);
    setChosenChild('');
  };

  const onCreateNested = async () => {
    const name = nestedName.trim();
    if (name === '') return;
    await createInitiative(engine, {
      name,
      ownerId: viewerId ?? undefined,
      parentInitiativeId: initiative.id,
    });
    setNestedName('');
  };

  const onUnnest = async (childId: UUID) => {
    await removeInitiativeRelation(engine, initiative.id, childId);
  };

  const onSubmitUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (posting || viewerId === null) return;
    setPosting(true);
    try {
      await createInitiativeUpdate(engine, {
        initiativeId: initiative.id,
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
          {latest.body !== '' && <p className={styles.description}>{latest.body}</p>}
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Post an update</h2>
        <form className={styles.form} onSubmit={onSubmitUpdate}>
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
            <span className={styles.fieldLabel}>Update</span>
            <textarea
              className={styles.descriptionInput}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="What changed since the last update?"
              rows={4}
            />
          </label>
          <div className={styles.addRow}>
            <Button type="submit" variant="primary" disabled={posting || viewerId === null}>
              Post update
            </Button>
          </div>
        </form>
      </section>

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
          <div className={styles.labelField}>
            <span className={styles.fieldLabel}>Labels</span>
            <button
              type="button"
              className={styles.propertyButton}
              {...labelsMenu.props}
              aria-label="Set labels"
            >
              {appliedLabels.length === 0 ? (
                'Add labels'
              ) : (
                <span className={styles.labelRun}>
                  {appliedLabels.map((label) => (
                    <LabelChip key={label.id} name={label.name} color={label.color} compact />
                  ))}
                </span>
              )}
            </button>
          </div>
        </div>
        <InitiativeLabelPicker
          open={labelsMenu.open}
          onClose={labelsMenu.hide}
          trigger={labelsMenu.ref}
          value={labelIds}
          onApply={(labelId, displaced) =>
            applyInitiativeLabel(engine, initiative.id, labelId, displaced).catch(report)
          }
          onRemove={(labelId) =>
            removeInitiativeLabel(engine, initiative.id, labelId).catch(report)
          }
        />
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
        <h2 className={styles.sectionTitle}>Sub-initiatives</h2>
        {children.length === 0 ? (
          <p className={styles.muted}>
            No nested initiatives yet. Create one here or nest an existing initiative.
          </p>
        ) : (
          <ul className={styles.projectList}>
            {children.map((row) => (
              <li key={row.id} className={styles.projectRow}>
                <Link to={`/initiative/${row.id}`} className={styles.projectLink}>
                  {row.name}
                </Link>
                <Button variant="ghost" onClick={() => void onUnnest(row.id)}>
                  Un-nest
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.addRow}>
          <Input
            label="New sub-initiative"
            hideLabel
            value={nestedName}
            onChange={(event) => setNestedName(event.target.value)}
            placeholder="Name a nested initiative…"
          />
          <Button disabled={nestedName.trim() === ''} onClick={() => void onCreateNested()}>
            Create nested
          </Button>
        </div>
        <div className={styles.addRow}>
          <Select
            label="Initiative to nest"
            hideLabel
            value={chosenChild}
            onChange={(event) => setChosenChild(event.target.value)}
            disabled={nestable.length === 0}
          >
            <option value="">Nest an existing initiative…</option>
            {nestable.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
          <Button disabled={chosenChild === ''} onClick={() => void onNestExisting()}>
            Nest
          </Button>
        </div>
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

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

function listChildren(store: Store, initiativeId: UUID): readonly ChildRow[] {
  const rows: ChildRow[] = [];
  for (const childId of store.initiativeChildIdsFor(initiativeId)) {
    const child = store.initiatives.get(childId);
    if (child === undefined || child.archivedAt !== undefined || child.deletedAt !== undefined) {
      continue;
    }
    rows.push({ id: child.id, name: child.name });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
