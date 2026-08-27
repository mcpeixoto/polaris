// COMMERCIALLY LICENSED — see ../../LICENSE. Not AGPL, and not present in the community
// bundle: `@ee` resolves to web/src/ee-absent there, so Rollup never reaches this file.
//
// The module's shape is fixed by its stub, web/src/ee-absent/audit/index.tsx, which is what
// tsconfig.json type-checks every core caller against. Anything exported here that the stub
// does not declare is invisible to the core build and will fail `pnpm typecheck` the moment
// a core file tries to use it — which is the intended discipline, not an obstacle.

import { useEffect, useState } from 'react';

import { Button, EmptyState, Spinner } from '~/components';
import { exact, when } from '~/features/time';
import { ApiError, gql } from '~/sync/api';

import { AUDIT_LOG_QUERY } from './operations';
import styles from './panel.module.css';

export interface AuditLogPanelProps {
  readonly pageSize?: number;
}

/** One row as the server returns it. Hand-written, as every response type here is. */
interface AuditEntry {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly actorType: string;
  readonly actorLabel: string;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly targetLabel: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly createdAt: string;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * The workspace's audit log: a page at a time, newest first, oldest reachable by asking for
 * more.
 *
 * The data path is the plain one — one GraphQL query into component state — for the reason
 * ApiKeys gives for the same choice: there is no `auditEntry` in the local replica to
 * subscribe to, and there deliberately never will be. A workspace-wide record of everybody's
 * administrative actions does not belong in every member's IndexedDB.
 *
 * Pages ACCUMULATE rather than replace. The reader is scanning for something, and a "next
 * page" that discards what they have just read makes comparing two events on either side of
 * a boundary impossible without starting again.
 */
export function AuditLogPanel({ pageSize = DEFAULT_PAGE_SIZE }: AuditLogPanelProps) {
  /** Null until the first answer, and null again if it fails: absent, not empty. */
  const [entries, setEntries] = useState<readonly AuditEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /**
   * Whether the server might have more. Inferred from a full page rather than asked for,
   * because a `hasMore` on the response would cost a second count query on every read of a
   * table that only ever grows. The cost of inferring is one empty final page.
   */
  const [exhausted, setExhausted] = useState(false);
  /** Bumped to re-run the first-page fetch. The retry button goes through it. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoadError(null);

    gql<{ auditLog: readonly AuditEntry[] }>(
      AUDIT_LOG_QUERY,
      { first: pageSize },
      { signal: controller.signal },
    )
      .then((data) => {
        if (!live) return;
        setEntries(data.auditLog);
        setExhausted(data.auditLog.length < pageSize);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        // Cleared rather than left stale. Somebody reads this screen to establish what
        // happened; a partial answer beside "could not be refreshed" is how a wrong
        // conclusion gets drawn from a real-looking table.
        setEntries(null);
        setLoadError(messageFor(failure));
      });

    return () => {
      live = false;
      // Aborted, not merely ignored, so leaving the screen mid-request does not hold a
      // socket open. The rejection lands above with `live` already false.
      controller.abort();
    };
  }, [attempt, pageSize]);

  const loadMore = () => {
    const last = entries?.[entries.length - 1];
    if (last === undefined || loadingMore) return;

    setLoadingMore(true);
    // The cursor is the last row's id — the server resolves it to a (createdAt, id) boundary
    // and pages by keyset. Not an offset: entries are appended while this screen is open, and
    // an offset would quietly repeat and skip rows on the one screen where that is not
    // survivable.
    gql<{ auditLog: readonly AuditEntry[] }>(AUDIT_LOG_QUERY, {
      first: pageSize,
      after: last.id,
    })
      .then((data) => {
        setEntries((current) => [...(current ?? []), ...data.auditLog]);
        setExhausted(data.auditLog.length < pageSize);
      })
      .catch((failure: unknown) => setLoadError(messageFor(failure)))
      .finally(() => setLoadingMore(false));
  };

  const loading = entries === null && loadError === null;

  return (
    <>
      {loadError === null ? null : (
        <div className={styles.failure} role="alert">
          <p className={styles.failureText}>{loadError}</p>
          <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
        </div>
      )}

      {loading ? (
        <div className={styles.loading}>
          <Spinner label="Loading the audit log" />
        </div>
      ) : null}

      {entries === null || entries.length > 0 ? null : (
        <EmptyState
          title="No entries yet"
          description="Sign-ins, role changes, invitations and API keys are recorded here as they happen. Nothing has been recorded for this workspace so far."
        />
      )}

      {entries === null || entries.length === 0 ? null : (
        <>
          <table className={styles.table}>
            <caption className={styles.caption}>
              Security-relevant events in this workspace, newest first. Entries cannot be edited or
              removed, and they name the person as they were named at the time — so an entry still
              identifies somebody who has since left.
            </caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">From</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <th scope="row" className={styles.when}>
                    <span title={exact(entry.createdAt)}>{when(entry.createdAt)}</span>
                  </th>
                  <td>{entry.actorLabel === '' ? unknownActor(entry) : entry.actorLabel}</td>
                  <td className={styles.action}>{entry.action}</td>
                  <td>
                    {entry.targetLabel ?? (
                      // An em dash rather than a blank cell. A sign-in genuinely has no
                      // target, and an empty cell is indistinguishable from a column that
                      // failed to load.
                      <span className={styles.absent}>—</span>
                    )}
                  </td>
                  <td className={styles.ip}>
                    {entry.ip ?? <span className={styles.absent}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {exhausted ? null : (
            <div className={styles.more}>
              <Button onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load older entries'}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

/**
 * What to call an actor whose name was not recorded.
 *
 * Only reachable for a system or integration actor, which have no display name to stamp.
 * Naming the type is more use than an empty cell, and far more use than "Unknown" — the
 * reader wants to know it was not a person.
 */
function unknownActor(entry: AuditEntry): string {
  return entry.actorType === 'user' ? 'A former member' : entry.actorType;
}

function messageFor(failure: unknown): string {
  if (failure instanceof ApiError) {
    // The server's own sentence, verbatim. A PLAN_LIMIT refusal carries the plan that would
    // permit it and a lapse carries "update your billing" — paraphrasing either here would
    // send a paying customer to the wrong screen.
    return failure.isOffline
      ? 'The audit log could not be fetched — this device looks offline. It is not stored on the device, so there is nothing to show until the connection is back.'
      : failure.message;
  }
  return 'The audit log could not be fetched.';
}
