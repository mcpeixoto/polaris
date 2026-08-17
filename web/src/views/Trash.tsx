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
 * What it cannot say, and does not pretend to: *when* an issue was deleted, and by whom. The
 * `Issue` type carries no `deletedAt` and the database has no `deleted_by` column at all, so
 * the only honest ordering is the server's own — which is by deletion time, newest first — and
 * the only person the screen can name is the one who created the issue. Saying so out loud is
 * better than a column of blanks or, worse, a column that quietly shows the wrong person.
 */

import { useEffect, useState } from 'react';

import { useEngine } from '~/app/context';
import { Badge, Button, EmptyState, Spinner } from '~/components';
import { when } from '~/features/time';
import { fetchDeletedIssues, RESTORE_WINDOW_DAYS, restoreIssue } from '~/features/trash/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Issue, UUID } from '~/store';
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
  | { readonly phase: 'ready'; readonly issues: readonly Issue[] }
  | { readonly phase: 'failed'; readonly message: string };

interface TrashRow {
  readonly id: UUID;
  readonly identifier: string;
  readonly title: string;
  readonly team: string;
  /** The creator, not the person who deleted it — which nothing in the API records. */
  readonly creator: string;
  readonly updatedAt: string;
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
   * A deleted issue carries ids; the team it belonged to and the person who created it are
   * still perfectly ordinary replicated rows. So this is a live query over those two entity
   * types with the fetched issues as its input — which also means a teammate being renamed in
   * another session corrects this table without it being reloaded.
   */
  const rows = useLiveQuery(
    (store) =>
      (load.phase === 'ready' ? load.issues : []).map((issue): TrashRow => {
        const creator =
          issue.creatorId === undefined ? undefined : store.get('user', issue.creatorId);
        return {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          // The server only lists issues from teams the caller belongs to, so the team is in
          // the replica; the fallback is for the seconds before a fresh bootstrap finishes.
          team: store.get('team', issue.teamId)?.name ?? 'A team of yours',
          creator: creator?.displayName ?? 'Somebody who has since left',
          updatedAt: issue.updatedAt,
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
          Polaris can bring it back. Nobody records who deleted an issue, so the person named below
          is the one who created it.
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
                <th scope="col">Created by</th>
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
                    <span className={styles.who}>{row.creator}</span>
                    {/* The last edit, because the deletion's own time is not on the wire. It is
                        still the most useful thing available for telling two similar rows
                        apart. */}
                    <span className={styles.secondary}>Last edited {when(row.updatedAt)}</span>
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
