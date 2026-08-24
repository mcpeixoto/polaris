/**
 * Documents list for a team or a project.
 *
 * Read from the replica. Creating one opens the editor; the list is a scan, not a dashboard.
 */

import { Link, useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, EmptyState, Input } from '~/components';
import { createDocument } from '~/features/documents/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { compareOrderKeys } from '~/store';
import type { Document, Store, UUID } from '~/store';
import styles from './Documents.module.css';
import { useState, type FormEvent } from 'react';

interface DocumentRow {
  readonly id: UUID;
  readonly title: string;
  readonly updatedAt: string;
}

export function Documents() {
  const navigate = useNavigate();
  const engine = useEngine();
  const { teamKey, projectId } = useParams<{ teamKey?: string; projectId?: string }>();
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const team = useLiveQuery(
    (store) =>
      teamKey === undefined
        ? null
        : ([...store.teams.values()].find((candidate) => candidate.key === teamKey) ?? null),
    ['team'],
    [teamKey ?? ''],
  );

  const project = useLiveQuery(
    (store) => (projectId === undefined ? null : (store.projects.get(projectId) ?? null)),
    ['project'],
    [projectId ?? ''],
  );

  const rows = useLiveQuery(
    (store) => listDocuments(store, team?.id, project?.id),
    ['document'],
    [team?.id ?? '', project?.id ?? ''],
  );

  const heading =
    project !== null
      ? `${project.name} documents`
      : team === null
        ? 'Documents'
        : `${team.name} documents`;

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === '' || creating) return;
    if (team === null && project === null) return;
    setCreating(true);
    try {
      const teamId = team?.id ?? projectTeamId(engine.store, project!.id);
      if (teamId === undefined) return;
      const id = await createDocument(engine, {
        teamId,
        projectId: project?.id,
        title: trimmed,
      });
      setTitle('');
      void navigate(`/document/${id}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{heading}</h1>
        <form className={styles.create} onSubmit={onCreate}>
          <Input
            label="New document title"
            hideLabel
            surface="plain"
            placeholder="New document…"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Button type="submit" variant="primary" loading={creating} disabled={title.trim() === ''}>
            Create
          </Button>
        </form>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description="Team runbooks, project specs and meeting notes live here as markdown until collaborative editing lands."
          action={
            <Button
              variant="primary"
              onClick={() => {
                const input = document.querySelector<HTMLInputElement>(
                  'input[placeholder="New document…"]',
                );
                input?.focus();
              }}
            >
              Create a document
            </Button>
          }
        />
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id}>
              <Link to={`/document/${row.id}`} className={styles.row}>
                <span className={styles.name}>{row.title}</span>
                <span className={styles.meta}>{formatWhen(row.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function listDocuments(store: Store, teamId?: UUID, projectId?: UUID): readonly DocumentRow[] {
  const ids =
    projectId !== undefined
      ? store.documentIdsForProject(projectId)
      : teamId !== undefined
        ? store.documentIdsForTeam(teamId)
        : new Set<UUID>();

  return [...ids]
    .map((id) => store.get('document', id))
    .filter((row): row is Document => row !== undefined)
    .filter((row) => projectId !== undefined || row.projectId === undefined)
    .sort((a, b) => compareOrderKeys(a.sortOrder, b.sortOrder) || a.title.localeCompare(b.title))
    .map((row) => ({ id: row.id, title: row.title, updatedAt: row.updatedAt }));
}

function projectTeamId(store: Store, projectId: UUID): UUID | undefined {
  for (const id of store.projectTeamIdsFor(projectId)) {
    const row = store.get('projectTeam', id);
    if (row !== undefined) return row.teamId;
  }
  return undefined;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
