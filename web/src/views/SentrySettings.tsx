/**
 * Sentry: webhook create and link.
 *
 * The connection is on the replica. The webhook secret is not, so that half is a GraphQL
 * query. Setup is a default public team plus a Sentry alert webhook (or internal
 * integration) pointing at the URL below.
 */

import { useEffect, useState, type FormEvent } from 'react';

import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Input, Select, Spinner } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { SecretField } from '~/components/SecretField';
import {
  disconnectSentry,
  enableSentryConnection,
  loadSentrySettings,
  updateSentryConnection,
} from '~/features/sentry/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import type { Store } from '~/store';
import { ApiError } from '~/sync/api';

import styles from './SentrySettings.module.css';

export function SentrySettings() {
  const viewer = useViewer();
  const isAdmin = viewer !== null && (viewer.role === 'owner' || viewer.role === 'admin');
  const connection = useLiveQuery(
    (store) => [...store.sentryConnections.values()][0] ?? null,
    ['sentryConnection'],
  );
  const teams = useLiveQuery(
    (store: Store) =>
      [...store.teams.values()]
        .filter(
          (team) => !team.private && team.archivedAt === undefined && team.retiredAt === undefined,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['team'],
  );

  const [webhook, setWebhook] = useState<{ url: string; secret: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (connection !== null) {
      setTeamId(connection.defaultTeamId);
      setOrgSlug(connection.organizationSlug ?? '');
    } else {
      setTeamId(teams[0]?.id ?? '');
      setOrgSlug('');
    }
  }, [connection, teams]);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    loadSentrySettings()
      .then((data) => {
        if (!live) return;
        setWebhook(data.sentryWebhook);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        setLoadError(
          failure instanceof ApiError && failure.isOffline
            ? 'Sentry settings could not be fetched — this device looks offline.'
            : 'Sentry settings could not be fetched.',
        );
      });
    return () => {
      live = false;
    };
  }, [attempt, connection?.id]);

  useKeyContext('list');
  useActions(
    [
      {
        id: 'sentry.connect',
        title: 'Connect Sentry',
        keys: ['n'],
        when: 'list',
        group: 'Sentry',
        enabled: () => isAdmin && connection === null && !busy && teamId !== '',
        run: () => {
          void onEnable();
        },
      },
    ],
    [isAdmin, connection, busy, teamId],
  );

  const onEnable = async () => {
    if (teamId === '') return;
    setBusy(true);
    setLoadError(null);
    try {
      await enableSentryConnection({
        defaultTeamId: teamId,
        organizationSlug: orgSlug.trim() === '' ? undefined : orgSlug.trim(),
      });
      setAttempt((n) => n + 1);
    } catch (failure: unknown) {
      setLoadError(failure instanceof ApiError ? failure.message : 'Could not connect Sentry.');
    } finally {
      setBusy(false);
    }
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (connection === null) return;
    setBusy(true);
    setLoadError(null);
    try {
      await updateSentryConnection({
        defaultTeamId: teamId,
        organizationSlug: orgSlug.trim(),
      });
    } catch (failure: unknown) {
      setLoadError(
        failure instanceof ApiError ? failure.message : 'Could not save Sentry settings.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Sentry</h1>
        {busy ? <Spinner /> : null}
      </header>
      <div className={styles.body}>
        <section className={styles.section} aria-labelledby="sentry-about">
          <h2 className={styles.sectionTitle} id="sentry-about">
            Issues from Sentry
          </h2>
          <p className={styles.sectionHint}>
            A Sentry alert or issue webhook creates a Polaris issue on the default team and attaches
            the Sentry URL. The same URL linked twice updates the existing card rather than minting
            a second issue. Cloud accounts only; public teams only.
          </p>
        </section>

        {loadError === null ? null : (
          <div className={styles.failure} role="alert">
            <p className={styles.failureText}>{loadError}</p>
            <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
          </div>
        )}

        <section className={styles.section} aria-labelledby="sentry-workspace">
          <h2 className={styles.sectionTitle} id="sentry-workspace">
            Workspace
          </h2>
          {connection === null ? (
            <>
              <p className={styles.sectionHint}>
                One Sentry connection per workspace. Admins pick a public team for new issues, then
                paste the webhook URL into Sentry.
              </p>
              {isAdmin ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onEnable();
                  }}
                >
                  <Select
                    label="Default team"
                    value={teamId}
                    onChange={(event) => setTeamId(event.target.value)}
                    disabled={busy || teams.length === 0}
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    label="Organization slug"
                    value={orgSlug}
                    onChange={(event) => setOrgSlug(event.target.value)}
                    hint="Optional. The slug from sentry.io/organizations/…"
                    disabled={busy}
                  />
                  <div className={styles.row}>
                    <Button variant="primary" disabled={busy || teamId === ''} type="submit">
                      Connect
                    </Button>
                  </div>
                </form>
              ) : (
                <p className={styles.sectionHint}>Ask an admin to connect Sentry.</p>
              )}
            </>
          ) : (
            <form onSubmit={(event) => void onSave(event)}>
              <Select
                label="Default team"
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
                disabled={!isAdmin || busy}
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </Select>
              <Input
                label="Organization slug"
                value={orgSlug}
                onChange={(event) => setOrgSlug(event.target.value)}
                hint="Optional. The slug from sentry.io/organizations/…"
                disabled={!isAdmin || busy}
              />
              {isAdmin ? (
                <div className={styles.row}>
                  <Button variant="primary" disabled={busy} type="submit">
                    Save
                  </Button>
                  <Button disabled={busy} type="button" onClick={() => setDisconnecting(true)}>
                    Disconnect
                  </Button>
                </div>
              ) : null}
            </form>
          )}
        </section>

        {connection !== null && isAdmin && webhook !== null ? (
          <section className={styles.section} aria-labelledby="sentry-webhook">
            <h2 className={styles.sectionTitle} id="sentry-webhook">
              Webhook
            </h2>
            <p className={styles.sectionHint}>
              Add this URL as a Sentry internal integration webhook, or as an alert-rule webhook
              action with the header <code>X-Sentry-Token</code> set to the secret below.
            </p>
            <p className={styles.mono}>{webhook.url}</p>
            <SecretField
              label="Webhook secret"
              value={webhook.secret}
              consequence="Paste this into Sentry as the client secret or as X-Sentry-Token. It is not shown again on a later visit unless you are still an admin of this workspace."
            />
          </section>
        ) : null}
      </div>

      <ConfirmDialog
        open={disconnecting}
        title="Disconnect Sentry?"
        consequence="New Sentry alerts will stop creating issues. Existing links stay on the issues they already sit on."
        confirmLabel="Disconnect"
        destructive
        onClose={() => setDisconnecting(false)}
        onConfirm={() => {
          setDisconnecting(false);
          setBusy(true);
          void disconnectSentry()
            .catch((failure: unknown) => {
              setLoadError(
                failure instanceof ApiError ? failure.message : 'Could not disconnect Sentry.',
              );
            })
            .finally(() => setBusy(false));
        }}
      />
    </div>
  );
}
