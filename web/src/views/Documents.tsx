/**
 * Documents list for a team or a project.
 *
 * Read from the replica. Creating one opens the editor; the list is a scan, not a dashboard.
 */

import { Link, useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, EmptyState, Input } from '~/components';
import { createDocument } from '~/features/documents/mutations';
import { EntityLoading, useStoreSettled } from '~/features/entity-gate/EntityGate';
import { exact, when } from '~/features/time';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { ApiError } from '~/sync/api';
import { compareOrderKeys } from '~/store';
import type { Document, Store, UUID } from '~/store';
import styles from './Documents.module.css';
import { useRef, useState, type FormEvent } from 'react';

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
  const [failure, setFailure] = useState<string | null>(null);
  // The empty state's only call to action used to find this field by querying the DOM for
  // its placeholder text, so localising that one string would have quietly turned the
  // button into a no-op.
  const titleRef = useRef<HTMLInputElement>(null);
  const settled = useStoreSettled();

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
    setFailure(null);
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
    } catch (error) {
      // A refused create used to reject a promise nobody held: the button un-spun, the
      // title stayed in the box, and nothing said whether the document existed.
      setFailure(
        error instanceof ApiError && error.message !== ''
          ? error.message
          : 'That document could not be created.',
      );
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
            ref={titleRef}
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

      {failure === null ? null : (
        <p className={styles.error} role="alert">
          {failure}
        </p>
      )}

      {rows.length === 0 && !settled ? (
        <EntityLoading label="Loading documents…" lines={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description="Team runbooks, project specs and meeting notes live here as markdown until collaborative editing lands."
          action={
            <Button variant="primary" onClick={() => titleRef.current?.focus()}>
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
                <time className={styles.meta} dateTime={row.updatedAt} title={exact(row.updatedAt)}>
                  {when(row.updatedAt)}
                </time>
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
