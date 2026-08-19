/**
 * Recently deleted teams — the 30-day restore window for a removed team and its issues.
 *
 * Same shape as Trash: a network read the replica cannot answer, with a loading state, a
 * failure, and a retry. Restore waits for the delta rather than optimistically writing the
 * team back.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { useEngine } from '~/app/context';
import { Badge, Button, EmptyState, Spinner } from '~/components';
import { when } from '~/features/time';
import {
  fetchDeletedTeams,
  RESTORE_WINDOW_DAYS,
  restoreTeam,
  type DeletedTeamRow,
} from '~/features/team-lifecycle/mutations';
import { ApiError } from '~/sync/api';
import styles from './Trash.module.css';
import type { UUID } from '~/store';

type Load =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly teams: readonly DeletedTeamRow[] }
  | { readonly phase: 'failed'; readonly message: string };

export function DeletedTeams() {
  const engine = useEngine();

  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [restoring, setRestoring] = useState<UUID | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ phase: 'loading' });

    fetchDeletedTeams(controller.signal)
      .then((teams) => {
        if (!controller.signal.aborted) setLoad({ phase: 'ready', teams });
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({
          phase: 'failed',
          message:
            failure instanceof ApiError
              ? failure.message
              : 'Recently deleted teams could not be loaded just now.',
        });
      });

    return () => controller.abort();
  }, [attempt]);

  const restore = async (row: DeletedTeamRow) => {
    if (restoring !== null) return;
    setRestoring(row.id);
    setError(null);
    try {
      await restoreTeam(engine, row.id);
      setLoad((current) =>
        current.phase === 'ready'
          ? { phase: 'ready', teams: current.teams.filter((team) => team.id !== row.id) }
          : current,
      );
      setRestored(`${row.key} is back as ${row.name}.`);
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : `${row.key} could not be restored just now.`,
      );
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Recently deleted teams</h1>
        {load.phase === 'ready' ? (
          <Badge>{load.teams.length === 1 ? '1 team' : `${load.teams.length} teams`}</Badge>
        ) : null}
      </header>

      <div className={styles.body}>
        <p className={styles.intro}>
          A deleted team and its issues are kept for {RESTORE_WINDOW_DAYS} days and can be restored
          from here. After that they are removed for good. Move or export issues first if you need
          them elsewhere — <Link to="/settings/trash">issue trash</Link> is separate from team
          deletion.
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
            <Spinner label="Looking for deleted teams" />
          </div>
        ) : null}

        {load.phase === 'failed' ? (
          <div role="alert">
            <EmptyState
              title="Recently deleted teams could not be loaded"
              description={load.message}
              action={<Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button>}
            />
          </div>
        ) : null}

        {load.phase === 'ready' && load.teams.length === 0 ? (
          <EmptyState
            title="Nothing here"
            description="No teams have been deleted in the last thirty days."
          />
        ) : null}

        {load.phase === 'ready' && load.teams.length > 0 ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Name</th>
                <th scope="col">Deleted</th>
                <th scope="col">
                  <span className={styles.srOnly}>Restore</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {load.teams.map((row) => (
                <tr key={row.id}>
                  <td>{row.key}</td>
                  <td>{row.name}</td>
                  <td>{when(row.deletedAt)}</td>
                  <td>
                    <Button
                      size="sm"
                      disabled={restoring !== null}
                      onClick={() => void restore(row)}
                    >
                      {restoring === row.id ? 'Restoring…' : 'Restore'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
