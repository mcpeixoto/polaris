/**
 * The trash: issues deleted in the last thirty days, and the way back.
 *
 * This screen answers one question — "where did my issue go" — and the answer has two halves.
 * The row is here, and it is here until a date. Both are stated in words at the top rather
 * than implied by the presence of a list, because somebody arriving on this screen is usually
 * arriving in a mild panic and a list of rows does not tell them how long they have.
 *
 * It is one of the few screens in the client that loads — API keys and the invite list are
 * the others, and the three have the same shape for the same reason. Everything else renders
 * from the local replica, so it is either instantaneous or it is empty. What these three want
 * is precisely what the replica does not hold: a deleted issue is what it threw away, a key's
 * secret is shown once and never stored, and an invite belongs to no workspace member yet. So
 * they ask the server, and therefore have a real loading state, a real failure and a retry.
 * See features/trash/mutations for why that is not an oversight in the sync design but a
 * consequence of it.
 *
 * It used to say, out loud, that it could not tell you *when* an issue was deleted or by whom,
 * and it named the issue's creator instead with a sentence explaining that the deleter was not
 * recorded. That was the honest rendering of a missing column. The column exists now —
 * `000020_issue_deleted_by`, whose own comment says it was written for this screen — and
 * `deletedAt` reaches the API on `deletedIssues`, the one read that returns deleted rows. Both
 * are what the table shows: who put it here, and when. The creator is not named at all any
 * more, because on a screen answering "where did my issue go" the person who filed it a month
 * ago is the wrong person to point at.
 *
 * The empty case is still real and is still not filled in with a guess. `deleted_by` is
 * nullable for two different reasons — a row deleted before the column existed has no answer,
 * and the retention sweep deletes on a schedule rather than on somebody's instruction, so for
 * its rows there is no person to name — and the screen says which of those it is looking at
 * rather than showing a blank cell.
 */

import { useEffect, useState } from 'react';

import { useEngine } from '~/app/context';
import { Badge, Button, EmptyState, Spinner } from '~/components';
import { when } from '~/features/time';
import {
  type DeletedIssue,
  fetchDeletedIssues,
  RESTORE_WINDOW_DAYS,
  restoreIssue,
} from '~/features/trash/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './Trash.module.css';

/**
 * What the listing is doing.
 *
 * Modelled as one value rather than three booleans so that "loading and failed" and "empty
 * because it is empty" versus "empty because nothing has arrived yet" are unrepresentable —
 * which is the whole difference between an empty state that reassures and one that lies.
 */
type Load =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly issues: readonly DeletedIssue[] }
  | { readonly phase: 'failed'; readonly message: string };

interface TrashRow {
  readonly id: UUID;
  readonly identifier: string;
  readonly title: string;
  readonly team: string;
  /** Who moved it here, or why nobody can be named for it. */
  readonly deletedBy: string;
  /** When it was moved here. Always set on a row this listing returned. */
  readonly deletedAt?: string;
}

export function Trash() {
  const engine = useEngine();

  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [restoring, setRestoring] = useState<UUID | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-run on `attempt` and on nothing else. The trash has no live source to subscribe to, so
  // "reload" is a user's decision rather than something a delta can trigger — and pressing the
  // button is the only thing that should ever cost a round trip on this screen.
  useEffect(() => {
    const controller = new AbortController();
    setLoad({ phase: 'loading' });

    fetchDeletedIssues(controller.signal)
      .then((issues) => {
        if (!controller.signal.aborted) setLoad({ phase: 'ready', issues });
      })
      .catch((failure: unknown) => {
        // An abort is this component going away, not a failure anybody needs to hear about.
        if (controller.signal.aborted) return;
        setLoad({
          phase: 'failed',
          message:
            failure instanceof ApiError
              ? failure.message
              : 'The trash could not be loaded just now.',
        });
      });

    return () => controller.abort();
  }, [attempt]);

  /**
   * The names come from the replica even though the issues do not.
   *
   * A deleted issue carries ids; the team it belonged to and the person who deleted it are
   * still perfectly ordinary replicated rows. So this is a live query over those two entity
   * types with the fetched issues as its input — which also means a teammate being renamed in
   * another session corrects this table without it being reloaded.
   */
  const rows = useLiveQuery(
    (store) =>
      (load.phase === 'ready' ? load.issues : []).map((issue): TrashRow => {
        const deleter =
          issue.deletedBy === undefined ? undefined : store.get('user', issue.deletedBy);
        return {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          // The server only lists issues from teams the caller belongs to, so the team is in
          // the replica; the fallback is for the seconds before a fresh bootstrap finishes.
          team: store.get('team', issue.teamId)?.name ?? 'A team of yours',
          // Three distinct cases, and they are not the same sentence. No `deletedBy` at all
          // means nobody was recorded — the retention sweep, or a deletion older than the
          // column. A `deletedBy` the replica cannot resolve means the account is gone.
          deletedBy:
            issue.deletedBy === undefined
              ? 'Not recorded'
              : (deleter?.displayName ?? 'Somebody who has since left'),
          deletedAt: issue.deletedAt,
        };
      }),
    ['team', 'user'],
    [load],
  );

  const restore = async (row: TrashRow) => {
    // One at a time. Each restore is its own mutation with its own opId, so concurrency would
    // be safe — but a table where three rows are mid-flight is one where a failure cannot be
    // attributed to the row that caused it.
    if (restoring !== null) return;
    setRestoring(row.id);
    setError(null);
    try {
      await restoreIssue(engine, row.id);
      // Taken out of the screen's own state rather than refetched: the listing is not live, and
      // asking the server again to learn something this client just did would put a spinner
      // over a table that is already correct.
      setLoad((current) =>
        current.phase === 'ready'
          ? { phase: 'ready', issues: current.issues.filter((issue) => issue.id !== row.id) }
          : current,
      );
      setRestored(`${row.identifier} is back in ${row.team}.`);
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : `${row.identifier} could not be restored just now.`,
      );
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Trash</h1>
        {load.phase === 'ready' ? (
          <Badge>{load.issues.length === 1 ? '1 issue' : `${load.issues.length} issues`}</Badge>
        ) : null}
      </header>

      <div className={styles.body}>
        <p className={styles.intro}>
          A deleted issue is kept for {RESTORE_WINDOW_DAYS} days and can be restored from here with
          its comments and its links intact. After that it is removed for good, and no screen in
          Polaris can bring it back.
        </p>

        {/*
          A live region for the confirmation, sitting in the document from the first render.
          A restore takes its own row off the screen, which is proof of nothing to somebody who
          was not watching that row — and a region inserted already populated is frequently
          never announced at all.
        */}
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
            <Spinner label="Looking for deleted issues" />
          </div>
        ) : null}

        {load.phase === 'failed' ? (
          // Wrapped rather than given role="alert" itself: the empty state renders paragraphs
          // and a button, and the whole block is the announcement.
          <div role="alert">
            <EmptyState
              title="The trash could not be loaded"
              description={load.message}
              action={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
            />
          </div>
        ) : null}

        {load.phase === 'ready' && rows.length === 0 ? (
          <EmptyState
            title="Nothing has been deleted"
            description={`Nothing in your teams has been deleted in the last ${RESTORE_WINDOW_DAYS} days. This is the good kind of empty.`}
          />
        ) : null}

        {rows.length === 0 ? null : (
          <table className={styles.table}>
            <caption className={styles.caption}>
              Deleted issues, most recently deleted first.
            </caption>
            <thead>
              <tr>
                <th scope="col">Issue</th>
                <th scope="col">Team</th>
                <th scope="col">Deleted by</th>
                <th scope="col">
                  <span className={styles.hidden}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className={styles.issue}>
                    <span className={styles.identifier}>{row.identifier}</span>
                    <span className={styles.issueTitle}>{row.title}</span>
                  </th>
                  <td>{row.team}</td>
                  <td>
                    <span className={styles.who}>{row.deletedBy}</span>
                    {/* The deletion's own time, which is also what the server sorted on — so
                        the column and the order the rows are in are the same fact, and a
                        reader scanning down it is not being shown two different clocks. */}
                    <span className={styles.secondary}>
                      {row.deletedAt === undefined ? 'Deleted' : `Deleted ${when(row.deletedAt)}`}
                    </span>
                  </td>
                  <td className={styles.actions}>
                    <Button
                      size="sm"
                      // Twelve buttons called "Restore" is twelve buttons a screen reader
                      // cannot tell apart in a list of controls.
                      aria-label={`Restore ${row.identifier}`}
                      loading={restoring === row.id}
                      onClick={() => void restore(row)}
                    >
                      Restore
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
