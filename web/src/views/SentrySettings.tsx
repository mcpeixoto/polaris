/**
 * Sentry: webhook create and link.
 *
 * The connection is on the replica. The webhook secret is not, so that half is a GraphQL
 * query. Setup is a default public team plus a Sentry alert webhook (or internal
 * integration) pointing at the URL below.
 *
 * The two failures on this screen are not the same failure. A fetch that did not land is
 * the page's, and keeps the button that retries it. A refused save belongs to the form that
 * was submitted, so it renders in that section beside the fields the reader would have to
 * change — and the save that succeeds says so there, because a settings form that looks
 * identical before and after is a form people submit again.
 */

import { useEffect, useState, type FormEvent } from 'react';

import { useActions, useKeyContext } from '~/app/keymap';
import {
  Button,
  DangerZone,
  DangerZoneRow,
  Input,
  SaveIndicator,
  SecretField,
  Select,
  SettingsPage,
  SettingsSection,
  useSaveState,
} from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
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
  // `busy` is the disconnect's own flight, and only that. A save reports through `save`.
  const [busy, setBusy] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  // Kept apart from loadError: that banner's "Try again" re-runs the settings fetch, which
  // cannot retry a refused disconnect, and it renders underneath the still-open dialog.
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const save = useSaveState(describe);

  const pending = busy || save.state === 'saving';

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
        enabled: () => isAdmin && connection === null && !pending && teamId !== '',
        run: () => {
          void onEnable();
        },
      },
    ],
    [isAdmin, connection, pending, teamId],
  );

  const onEnable = async () => {
    if (teamId === '') return;
    const landed = await save.run(() =>
      enableSentryConnection({
        defaultTeamId: teamId,
        organizationSlug: orgSlug.trim() === '' ? undefined : orgSlug.trim(),
      }),
    );
    if (!landed) return;
    setAttempt((n) => n + 1);
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (connection === null) return;
    await save.run(() =>
      updateSentryConnection({
        defaultTeamId: teamId,
        organizationSlug: orgSlug.trim(),
      }),
    );
  };

  return (
    <SettingsPage
      title="Sentry"
      description="Turn Sentry alerts into issues on a team, and keep the link back to Sentry."
      error={loadError ?? undefined}
      actions={
        loadError === null ? undefined : (
          <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
        )
      }
    >
      <SettingsSection title="Issues from Sentry">
        <p className={styles.hint}>
          A Sentry alert or issue webhook creates a Polaris issue on the default team and attaches
          the Sentry URL. The same URL linked twice updates the existing card rather than minting a
          second issue. Cloud accounts only; public teams only.
        </p>
      </SettingsSection>

      <SettingsSection
        title="Workspace"
        status={<SaveIndicator state={save.state} />}
        error={save.error}
      >
        {connection === null ? (
          <>
            <p className={styles.hint}>
              One Sentry connection per workspace. Admins pick a public team for new issues, then
              paste the webhook URL into Sentry.
            </p>
            {isAdmin ? (
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  void onEnable();
                }}
              >
                <Select
                  label="Default team"
                  value={teamId}
                  onChange={(event) => setTeamId(event.target.value)}
                  disabled={pending || teams.length === 0}
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
                  disabled={pending}
                />
                <div className={styles.row}>
                  <Button variant="primary" disabled={pending || teamId === ''} type="submit">
                    Connect
                  </Button>
                </div>
              </form>
            ) : (
              <p className={styles.hint}>Ask an admin to connect Sentry.</p>
            )}
          </>
        ) : (
          <form className={styles.form} onSubmit={(event) => void onSave(event)}>
            <Select
              label="Default team"
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
              disabled={!isAdmin || pending}
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
              disabled={!isAdmin || pending}
            />
            {isAdmin ? (
              <div className={styles.row}>
                <Button variant="primary" disabled={pending} type="submit">
                  Save
                </Button>
              </div>
            ) : null}
          </form>
        )}
      </SettingsSection>

      {connection !== null && isAdmin && webhook !== null ? (
        <SettingsSection title="Webhook" flush>
          <p className={styles.hint}>
            Add this URL as a Sentry internal integration webhook, or as an alert-rule webhook
            action with the header <code>X-Sentry-Token</code> set to the secret below.
          </p>
          <p className={styles.mono}>{webhook.url}</p>
          <SecretField
            label="Webhook secret"
            value={webhook.secret}
            // Not a one-time secret: an admin re-reads it here on every visit, and saying
            // otherwise would teach people to disbelieve the warnings on the credentials that
            // really are shown once. What it costs is a rotation, so say that instead.
            consequence="Paste this into Sentry as the client secret or as X-Sentry-Token. Rotating it takes effect at once: every Sentry webhook still sending the old secret is rejected until you paste the new one in."
          />
        </SettingsSection>
      ) : null}

      {connection !== null && isAdmin ? (
        <DangerZone>
          <DangerZoneRow
            title="Disconnect Sentry"
            consequence="New Sentry alerts stop creating issues and the webhook secret is dropped, so reconnecting means pasting a new one into Sentry. Links already on issues stay."
            action={
              <Button
                variant="danger"
                disabled={pending}
                onClick={() => {
                  setDisconnectError(null);
                  setDisconnecting(true);
                }}
              >
                Disconnect Sentry
              </Button>
            }
          />
        </DangerZone>
      ) : null}

      <ConfirmDialog
        open={disconnecting}
        title="Disconnect Sentry?"
        consequence="New Sentry alerts will stop creating issues. Existing links stay on the issues they already sit on."
        confirmLabel="Disconnect"
        destructive
        busy={busy}
        error={disconnectError ?? undefined}
        onClose={() => {
          setDisconnecting(false);
          setDisconnectError(null);
        }}
        onConfirm={() => {
          if (busy) return;
          setBusy(true);
          setDisconnectError(null);
          disconnectSentry()
            .then(() => setDisconnecting(false))
            .catch((failure: unknown) => {
              // The dialog stays open until the server has answered. Dismissing it first
              // put the refusal on a page the user had already turned away from.
              setDisconnectError(
                failure instanceof ApiError ? failure.message : 'Could not disconnect Sentry.',
              );
            })
            .finally(() => setBusy(false));
        }}
      />
    </SettingsPage>
  );
}

/** The server's own sentence where it wrote one — it names the field it refused. */
function describe(failure: unknown): string {
  if (failure instanceof ApiError) return failure.message;
  return 'Sentry settings could not be saved.';
}
