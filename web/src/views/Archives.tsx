/**
 * A team's archives: issues, cycles and projects that have been archived, plus the same
 * recently-deleted list the trash holds, scoped to this team.
 *
 * Loaded on demand. Archived work is a delete as far as the replica is concerned, so there
 * is nothing to query locally and a spinner is the honest first frame. Restore with `#` or
 * the button; editing still requires the row to be live.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions } from '~/app/keymap';
import { Badge, Button, EmptyState, Spinner } from '~/components';
import {
  fetchArchivedCycles,
  fetchArchivedIssues,
  fetchArchivedProjects,
  unarchiveCycle,
  unarchiveIssue,
  unarchiveProject,
} from '~/features/archive/mutations';
import { when } from '~/features/time';
import { fetchDeletedIssues, restoreIssue } from '~/features/trash/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Cycle, Issue, Project, UUID } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './Archives.module.css';

type Tab = 'issues' | 'cycles' | 'projects' | 'deleted';

type Load<T> =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly rows: readonly T[] }
  | { readonly phase: 'failed'; readonly message: string };

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'issues', label: 'Issues' },
  { id: 'cycles', label: 'Cycles' },
  { id: 'projects', label: 'Projects' },
  { id: 'deleted', label: 'Recently deleted' },
];

export function Archives() {
  const navigate = useNavigate();
  const { teamKey = '' } = useParams<{ teamKey: string }>();
  const engine = useEngine();
  const team = useLiveQuery(
    (store) => [...store.teams.values()].find((candidate) => candidate.key === teamKey) ?? null,
    ['team'],
    [teamKey],
  );

  const [tab, setTab] = useState<Tab>('issues');
  const [attempt, setAttempt] = useState(0);
  const [issues, setIssues] = useState<Load<Issue>>({ phase: 'loading' });
  const [cycles, setCycles] = useState<Load<Cycle>>({ phase: 'loading' });
  const [projects, setProjects] = useState<Load<Project>>({ phase: 'loading' });
  const [deleted, setDeleted] = useState<Load<Issue>>({ phase: 'loading' });
  const [selected, setSelected] = useState<UUID | null>(null);
  const [restoring, setRestoring] = useState<UUID | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (team === null) return;
    const controller = new AbortController();
    setSelected(null);
    setError(null);

    if (tab === 'issues') {
      setIssues({ phase: 'loading' });
      fetchArchivedIssues(team.id, controller.signal)
        .then((rows) => {
          if (!controller.signal.aborted) setIssues({ phase: 'ready', rows });
        })
        .catch((failure: unknown) => {
          if (controller.signal.aborted) return;
          setIssues({
            phase: 'failed',
            message: failure instanceof ApiError ? failure.message : 'Archives could not be loaded just now.',
          });
        });
    } else if (tab === 'cycles') {
      setCycles({ phase: 'loading' });
      fetchArchivedCycles(team.id, controller.signal)
        .then((rows) => {
          if (!controller.signal.aborted) setCycles({ phase: 'ready', rows });
        })
        .catch((failure: unknown) => {
          if (controller.signal.aborted) return;
          setCycles({
            phase: 'failed',
            message: failure instanceof ApiError ? failure.message : 'Archives could not be loaded just now.',
          });
        });
    } else if (tab === 'projects') {
      setProjects({ phase: 'loading' });
      fetchArchivedProjects(team.id, controller.signal)
        .then((rows) => {
          if (!controller.signal.aborted) setProjects({ phase: 'ready', rows });
        })
        .catch((failure: unknown) => {
          if (controller.signal.aborted) return;
          setProjects({
            phase: 'failed',
            message: failure instanceof ApiError ? failure.message : 'Archives could not be loaded just now.',
          });
        });
    } else {
      setDeleted({ phase: 'loading' });
      fetchDeletedIssues(controller.signal)
        .then((rows) => {
          if (!controller.signal.aborted) {
            setDeleted({ phase: 'ready', rows: rows.filter((row) => row.teamId === team.id) });
          }
        })
        .catch((failure: unknown) => {
          if (controller.signal.aborted) return;
          setDeleted({
            phase: 'failed',
            message: failure instanceof ApiError ? failure.message : 'Recently deleted could not be loaded just now.',
          });
        });
    }

    return () => controller.abort();
  }, [team, tab, attempt]);

  const restoreOne = async (id: UUID) => {
    if (team === null || restoring !== null) return;
    setRestoring(id);
    setError(null);
    try {
      if (tab === 'issues') {
        await unarchiveIssue(engine, id);
        setIssues((current) => drop(current, id));
        setRestored('Issue restored.');
      } else if (tab === 'cycles') {
        await unarchiveCycle(engine, id);
        setCycles((current) => drop(current, id));
        setRestored('Cycle restored.');
      } else if (tab === 'projects') {
        await unarchiveProject(engine, id);
        setProjects((current) => drop(current, id));
        setRestored('Project restored.');
      } else {
        await restoreIssue(engine, id);
        setDeleted((current) => drop(current, id));
        setRestored('Issue restored from recently deleted.');
      }
      setSelected(null);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'That could not be restored just now.');
    } finally {
      setRestoring(null);
    }
  };

  useActions(
    [
      {
        id: 'archives.restore',
        title: 'Restore',
        keys: ['#'],
        group: 'Archives',
        run: () => {
          if (selected !== null) void restoreOne(selected);
        },
      },
    ],
    [selected, tab, restoring, team],
  );

  if (team === null) {
    return (
      <div className={styles.screen}>
        <EmptyState
          title="No such team"
          description={`Nothing in this workspace has the key ${teamKey}.`}
          action={<Button onClick={() => navigate(-1)}>Go back</Button>}
        />
      </div>
    );
  }

  const load =
    tab === 'issues' ? issues : tab === 'cycles' ? cycles : tab === 'projects' ? projects : deleted;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Archives</h1>
        <Badge>{team.key}</Badge>
      </header>

      <nav className={styles.tabs} aria-label="Archives">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={styles.tab}
            aria-current={tab === entry.id ? 'page' : undefined}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className={styles.body}>
        <p className={styles.intro}>
          Archived work is still searchable and its links still open, but it has to be restored
          before it can be edited. Restore with #. Recently deleted issues stay here for thirty
          days, then they are gone.
        </p>

        <p className={styles.restored} role="status" aria-live="polite">
          {restored ?? ''}
        </p>

        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {load.phase === 'loading' ? (
          <div className={styles.loading}>
            <Spinner label="Looking in the archives" />
          </div>
        ) : null}

        {load.phase === 'failed' ? (
          <div role="alert">
            <EmptyState
              title="The archives could not be loaded"
              description={load.message}
              action={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
            />
          </div>
        ) : null}

        {load.phase === 'ready' && load.rows.length === 0 ? (
          <EmptyState
            title={emptyTitle(tab)}
            description={emptyDescription(tab)}
          />
        ) : null}

        {load.phase === 'ready' && load.rows.length > 0 ? (
          <table className={styles.table}>
            <caption className={styles.caption}>{caption(tab)}</caption>
            <thead>
              <tr>
                <th scope="col">{tab === 'issues' || tab === 'deleted' ? 'Issue' : 'Name'}</th>
                <th scope="col">Archived</th>
                <th scope="col">
                  <span className={styles.hidden}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tab === 'issues' || tab === 'deleted'
                ? (load.rows as readonly Issue[]).map((row) => (
                    <ArchiveRow
                      key={row.id}
                      id={row.id}
                      label={row.identifier}
                      title={row.title}
                      when={row.archivedAt ?? row.updatedAt}
                      selected={selected === row.id}
                      restoring={restoring === row.id}
                      onSelect={setSelected}
                      onRestore={() => void restoreOne(row.id)}
                    />
                  ))
                : tab === 'cycles'
                  ? (load.rows as readonly Cycle[]).map((row) => (
                      <ArchiveRow
                        key={row.id}
                        id={row.id}
                        label={`Cycle ${row.number}`}
                        title={row.name}
                        when={row.archivedAt ?? row.updatedAt}
                        selected={selected === row.id}
                        restoring={restoring === row.id}
                        onSelect={setSelected}
                        onRestore={() => void restoreOne(row.id)}
                      />
                    ))
                  : (load.rows as readonly Project[]).map((row) => (
                      <ArchiveRow
                        key={row.id}
                        id={row.id}
                        label={row.name}
                        title={row.summary ?? ''}
                        when={row.archivedAt ?? row.updatedAt}
                        selected={selected === row.id}
                        restoring={restoring === row.id}
                        onSelect={setSelected}
                        onRestore={() => void restoreOne(row.id)}
                      />
                    ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}

function ArchiveRow({
  id,
  label,
  title,
  when: at,
  selected,
  restoring,
  onSelect,
  onRestore,
}: {
  id: UUID;
  label: string;
  title: string;
  when: string;
  selected: boolean;
  restoring: boolean;
  onSelect: (id: UUID) => void;
  onRestore: () => void;
}) {
  return (
    <tr
      className={styles.row}
      aria-selected={selected}
      onClick={() => onSelect(id)}
    >
      <th scope="row" className={styles.issue}>
        <span className={styles.identifier}>{label}</span>
        {title !== '' ? <span className={styles.issueTitle}>{title}</span> : null}
      </th>
      <td>
        <span className={styles.secondary}>{when(at)}</span>
      </td>
      <td className={styles.actions}>
        <Button
          size="sm"
          aria-label={`Restore ${label}`}
          loading={restoring}
          onClick={(event) => {
            event.stopPropagation();
            onRestore();
          }}
        >
          Restore
        </Button>
      </td>
    </tr>
  );
}

function drop<T extends { id: UUID }>(load: Load<T>, id: UUID): Load<T> {
  return load.phase === 'ready' ? { phase: 'ready', rows: load.rows.filter((row) => row.id !== id) } : load;
}

function emptyTitle(tab: Tab): string {
  switch (tab) {
    case 'issues':
      return 'No archived issues';
    case 'cycles':
      return 'No archived cycles';
    case 'projects':
      return 'No archived projects';
    case 'deleted':
      return 'Nothing has been deleted';
  }
}

function emptyDescription(tab: Tab): string {
  switch (tab) {
    case 'issues':
      return 'Completed work stays in the team until auto-archive, or until somebody archives it.';
    case 'cycles':
      return 'Completed cycles archive on the same period as issues.';
    case 'projects':
      return 'A project archives with its issues, never the other way around.';
    case 'deleted':
      return 'Nothing in this team has been deleted in the last thirty days.';
  }
}

function caption(tab: Tab): string {
  switch (tab) {
    case 'issues':
      return 'Archived issues, most recently archived first.';
    case 'cycles':
      return 'Archived cycles, most recently archived first.';
    case 'projects':
      return 'Archived projects, most recently archived first.';
    case 'deleted':
      return 'Recently deleted issues, most recently deleted first.';
  }
}
