/**
 * Settings → Authorised apps: third-party OAuth grants this person made in this workspace.
 *
 * Not replica data — same reason as sessions. Revoking kills every live token for that app.
 */

import { useEffect, useMemo, useState } from 'react';

import { Badge, Button, EmptyState, Spinner } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import {
  revokeAuthorisedOauthApp,
  revokeConsequence,
  type AuthorisedOauthAppSummary,
} from '~/features/authorisedOauth/mutations';
import { AUTHORISED_OAUTH_APPS_QUERY } from '~/features/authorisedOauth/operations';
import { exact, when } from '~/features/time';
import type { UUID } from '~/store';
import { ApiError, gql } from '~/sync/api';
import styles from './Sessions.module.css';

export function AuthorisedApps() {
  const [apps, setApps] = useState<readonly AuthorisedOauthAppSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [revoking, setRevoking] = useState<UUID | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoadError(null);

    gql<{ authorisedOauthApps: readonly AuthorisedOauthAppSummary[] }>(
      AUTHORISED_OAUTH_APPS_QUERY,
      undefined,
      { signal: controller.signal },
    )
      .then((data) => {
        if (live) setApps(data.authorisedOauthApps);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        setApps(null);
        setLoadError(
          failure instanceof ApiError && failure.isOffline
            ? 'Authorised apps could not be fetched — this device looks offline.'
            : 'Authorised apps could not be fetched.',
        );
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [attempt]);

  const reload = () => setAttempt((n) => n + 1);

  const rows = useMemo(() => {
    if (apps === null) return [];
    return [...apps].sort((a, b) => a.name.localeCompare(b.name));
  }, [apps]);

  const target = revoking === null ? null : (apps?.find((row) => row.id === revoking) ?? null);

  const confirmRevoke = async () => {
    if (revoking === null || busy) return;
    setBusy(true);
    setRevokeError(null);
    try {
      await revokeAuthorisedOauthApp(revoking);
      setRevoking(null);
      reload();
    } catch (failure) {
      setRevokeError(
        failure instanceof ApiError ? failure.message : 'That authorisation could not be revoked.',
      );
    } finally {
      setBusy(false);
    }
  };

  const loading = apps === null && loadError === null;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Authorised apps</h1>
        {apps === null ? null : (
          <Badge>{apps.length === 1 ? '1 app' : `${apps.length} apps`}</Badge>
        )}
      </header>

      <div className={styles.body}>
        <section className={styles.intro} aria-labelledby="authorised-about">
          <h2 className={styles.sectionTitle} id="authorised-about">
            Apps you have allowed
          </h2>
          <p className={styles.sectionHint}>
            Each row is a third-party application you authorised in this workspace. Revoking retires
            every live token you granted it. Tokens themselves never appear here.
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
            <Spinner label="Loading authorised apps" />
          </div>
        ) : null}

        {apps === null || apps.length > 0 ? null : (
          <EmptyState
            title="No authorised apps"
            description="An app appears here after you press Allow on an OAuth consent screen for this workspace."
          />
        )}

        {rows.length === 0 ? null : (
          <table className={styles.table}>
            <caption className={styles.caption}>
              Third-party applications with live grants from you in this workspace.
            </caption>
            <thead>
              <tr>
                <th scope="col">App</th>
                <th scope="col">Scopes</th>
                <th scope="col">Last used</th>
                <th scope="col">Authorised</th>
                <th scope="col" className={styles.hidden}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((app) => (
                <tr key={app.id}>
                  <th scope="row" className={styles.deviceCell}>
                    <span className={styles.identity}>
                      <span className={styles.name}>{app.name}</span>
                      {app.developer === null || app.developer === '' ? null : (
                        <span className={styles.unknown}>{app.developer}</span>
                      )}
                    </span>
                  </th>
                  <td>{app.scopes.length === 0 ? '—' : app.scopes.join(' ')}</td>
                  <td>
                    {app.lastUsedAt === null ? (
                      <span className={styles.unknown}>Never</span>
                    ) : (
                      <span title={exact(app.lastUsedAt)}>{when(app.lastUsedAt)}</span>
                    )}
                  </td>
                  <td>
                    <span title={exact(app.createdAt)}>{when(app.createdAt)}</span>
                  </td>
                  <td className={styles.actions}>
                    <Button
                      size="sm"
                      variant="danger"
                      aria-label={`Revoke ${app.name}`}
                      onClick={() => {
                        setRevokeError(null);
                        setRevoking(app.id);
                      }}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={target !== null}
        title={target === null ? '' : `Revoke ${target.name}?`}
        consequence={target === null ? '' : revokeConsequence(target)}
        confirmLabel="Revoke"
        destructive
        busy={busy}
        error={revokeError ?? undefined}
        onConfirm={() => void confirmRevoke()}
        onClose={() => setRevoking(null)}
      />
    </div>
  );
}
