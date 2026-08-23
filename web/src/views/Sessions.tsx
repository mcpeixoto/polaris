/**
 * Personal sessions: the browsers and devices this account is signed in on.
 *
 * ## Why this screen is built unlike every other one
 *
 * Everything else in the product renders from the local replica. Sessions do not: they
 * belong to an account, not a workspace, and replicating them would put a credential
 * inventory in every device's IndexedDB for no gain. The data path is the plainest in the
 * client: one GraphQL query into component state, and the same query again after a write.
 *
 * There is deliberately no optimistic patch. A revoke drawn before the server has answered
 * would tell somebody a stolen laptop had stopped working a moment before it actually had,
 * which is the one lie a security screen must not tell.
 */

import { useEffect, useMemo, useState } from 'react';

import { Badge, Button, EmptyState, Spinner } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import {
  locationOf,
  revocationConsequence,
  revokeAccountSession,
  revokeOthersConsequence,
  revokeOtherSessions,
  type AccountSessionSummary,
} from '~/features/sessions/mutations';
import { ACCOUNT_SESSIONS_QUERY } from '~/features/sessions/operations';
import { exact, when } from '~/features/time';
import type { UUID } from '~/store';
import { ApiError, auth, gql } from '~/sync/api';
import styles from './Sessions.module.css';

export function Sessions() {
  const [sessions, setSessions] = useState<readonly AccountSessionSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [revoking, setRevoking] = useState<UUID | 'others' | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoadError(null);

    gql<{ accountSessions: readonly AccountSessionSummary[] }>(ACCOUNT_SESSIONS_QUERY, undefined, {
      signal: controller.signal,
    })
      .then((data) => {
        if (live) setSessions(data.accountSessions);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        setSessions(null);
        setLoadError(
          failure instanceof ApiError && failure.isOffline
            ? 'Your sessions could not be fetched — this device looks offline. They are not kept on it, so there is nothing to show until the connection is back.'
            : 'Your sessions could not be fetched.',
        );
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [attempt]);

  const reload = () => setAttempt((n) => n + 1);

  const rows = useMemo(() => {
    if (sessions === null) return [];
    return [...sessions].sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      return b.lastSeenAt.localeCompare(a.lastSeenAt);
    });
  }, [sessions]);

  const others = rows.filter((row) => !row.current);
  const target =
    revoking === null || revoking === 'others'
      ? null
      : (sessions?.find((row) => row.id === revoking) ?? null);

  const askRevoke = (session: AccountSessionSummary) => {
    setRevokeError(null);
    setRevoking(session.id);
  };

  const confirmRevoke = async () => {
    if (revoking === null || revoking === 'others' || busy) return;
    const session = sessions?.find((row) => row.id === revoking);
    setBusy(true);
    setRevokeError(null);
    try {
      await revokeAccountSession(revoking);
      setRevoking(null);
      if (session?.current) {
        await auth.logout();
        return;
      }
      reload();
    } catch (failure) {
      setRevokeError(
        failure instanceof ApiError ? failure.message : 'That session could not be revoked.',
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmRevokeOthers = async () => {
    if (revoking !== 'others' || busy) return;
    setBusy(true);
    setRevokeError(null);
    try {
      await revokeOtherSessions();
      setRevoking(null);
      reload();
    } catch (failure) {
      setRevokeError(
        failure instanceof ApiError ? failure.message : 'The other sessions could not be revoked.',
      );
    } finally {
      setBusy(false);
    }
  };

  const loading = sessions === null && loadError === null;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Sessions</h1>
        {sessions === null ? null : (
          <Badge>{sessions.length === 1 ? '1 session' : `${sessions.length} sessions`}</Badge>
        )}
        <div className={styles.spacer} />
        {others.length === 0 ? null : (
          <Button
            variant="danger"
            onClick={() => {
              setRevokeError(null);
              setRevoking('others');
            }}
          >
            Revoke other sessions
          </Button>
        )}
      </header>

      <div className={styles.body}>
        <section className={styles.intro} aria-labelledby="sessions-about">
          <h2 className={styles.sectionTitle} id="sessions-about">
            Where you are signed in
          </h2>
          <p className={styles.sectionHint}>
            Each row is a browser or device holding a live login. Revoking one stops that device
            renewing its login, so it is signed out within a few minutes and cannot get back in
            without your password. Revoking the others keeps this browser and kills everything else
            — the move after a stolen laptop or a hotel wifi you no longer trust.
          </p>
        </section>

        {loadError === null ? null : (
          <div className={styles.failure} role="alert">
            <p className={styles.failureText}>{loadError}</p>
            <Button onClick={reload}>Try again</Button>
          </div>
        )}

        {loading ? (
          <div className={styles.loading}>
            <Spinner label="Loading your sessions" />
          </div>
        ) : null}

        {sessions === null || sessions.length > 0 ? null : (
          <EmptyState
            title="No live sessions"
            description="A session appears here when you sign in. If you are reading this, that usually means the list could not see the cookie on this request — try signing in again."
          />
        )}

        {rows.length === 0 ? null : (
          <table className={styles.table}>
            <caption className={styles.caption}>
              Live logins on your account. This browser is marked Current and listed first.
            </caption>
            <thead>
              <tr>
                <th scope="col">Device</th>
                <th scope="col">Location</th>
                <th scope="col">IP</th>
                <th scope="col">Last seen</th>
                <th scope="col">Signed in</th>
                <th scope="col" className={styles.hidden}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  onRevoke={() => askRevoke(session)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={target !== null}
        title={
          target === null
            ? ''
            : target.current
              ? 'Sign out this browser?'
              : `Revoke ${target.label}?`
        }
        consequence={target === null ? '' : revocationConsequence(target)}
        confirmLabel={target?.current === true ? 'Sign out' : 'Revoke this session'}
        destructive
        busy={busy}
        error={revokeError ?? undefined}
        onConfirm={() => void confirmRevoke()}
        onClose={() => setRevoking(null)}
      />

      <ConfirmDialog
        open={revoking === 'others'}
        title="Revoke other sessions?"
        consequence={revokeOthersConsequence(others.length)}
        confirmLabel="Revoke other sessions"
        destructive
        busy={busy}
        error={revokeError ?? undefined}
        onConfirm={() => void confirmRevokeOthers()}
        onClose={() => setRevoking(null)}
      />
    </div>
  );
}

function SessionRow({
  session,
  onRevoke,
}: {
  session: AccountSessionSummary;
  onRevoke: () => void;
}) {
  return (
    <tr>
      <th scope="row" className={styles.deviceCell}>
        <span className={styles.identity}>
          <span className={styles.name}>
            {session.label}
            {session.current ? <Badge tone="success">Current</Badge> : null}
          </span>
        </span>
      </th>
      <td className={session.country === null ? styles.unknown : undefined}>
        {locationOf(session)}
      </td>
      <td className={session.ip === null ? styles.unknown : styles.ip}>{session.ip ?? '—'}</td>
      <td>
        <span title={exact(session.lastSeenAt)}>{when(session.lastSeenAt)}</span>
      </td>
      <td>
        <span title={exact(session.createdAt)}>{when(session.createdAt)}</span>
      </td>
      <td className={styles.actions}>
        <Button
          size="sm"
          variant="danger"
          aria-label={session.current ? 'Sign out this browser' : `Revoke ${session.label}`}
          onClick={onRevoke}
        >
          {session.current ? 'Sign out' : 'Revoke'}
        </Button>
      </td>
    </tr>
  );
}
