/**
 * Slack: channel notifications, slash create/comment, link unfurls.
 *
 * The connection is on the replica. The incoming-webhook URL is not. Setup is a default
 * public team plus an optional Slack incoming webhook; slash commands and unfurls need
 * POLARIS_SLACK_SIGNING_SECRET and POLARIS_SLACK_BOT_TOKEN on the process.
 *
 * Two failures live on this screen and they are not the same failure. A fetch that did not
 * land is the page's — its remedy is to fetch again — and it stays at page level with the
 * button that retries it. A refused save belongs to the form that was submitted, so it
 * renders in that section next to the fields the reader would have to change, and its
 * success is announced there too: a form that looks identical before and after is a form
 * people submit twice.
 */

import { useEffect, useState, type FormEvent } from 'react';

import { useActions, useKeyContext } from '~/app/keymap';
import {
  Button,
  Checkbox,
  DangerZone,
  DangerZoneRow,
  Input,
  SaveIndicator,
  Select,
  SettingsPage,
  SettingsSection,
  useSaveState,
} from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import {
  disconnectSlack,
  enableSlackConnection,
  loadSlackInbound,
  updateSlackConnection,
  type SlackInboundQuery,
} from '~/features/slack/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import type { Store } from '~/store';
import { ApiError } from '~/sync/api';

import styles from './SlackSettings.module.css';

export function SlackSettings() {
  const viewer = useViewer();
  const isAdmin = viewer !== null && (viewer.role === 'owner' || viewer.role === 'admin');
  const connection = useLiveQuery(
    (store) => [...store.slackConnections.values()][0] ?? null,
    ['slackConnection'],
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

  const [inbound, setInbound] = useState<SlackInboundQuery['slackInbound']>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // `busy` is the disconnect's own flight, and only that. A save reports through `save`.
  const [busy, setBusy] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [channelName, setChannelName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  // A saved webhook is shown as a status row, so the field only exists while it is being
  // replaced — otherwise an empty box sits under the words "a webhook is saved".
  const [webhookEditing, setWebhookEditing] = useState(false);
  const [notifyIssues, setNotifyIssues] = useState(true);
  const [notifyComments, setNotifyComments] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  // Kept apart from loadError: that banner's "Try again" re-runs the settings fetch, which
  // cannot retry a refused disconnect, and it renders underneath the still-open dialog.
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const save = useSaveState(describe);

  const saving = save.state === 'saving';
  const pending = busy || saving;

  useEffect(() => {
    if (connection !== null) {
      setTeamId(connection.defaultTeamId);
      setChannelName(connection.channelName ?? '');
      setNotifyIssues(connection.notifyIssues);
      setNotifyComments(connection.notifyComments);
    } else {
      setTeamId(teams[0]?.id ?? '');
      setChannelName('');
      setWebhookUrl('');
      setNotifyIssues(true);
      setNotifyComments(true);
    }
  }, [connection, teams]);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    loadSlackInbound()
      .then((data) => {
        if (!live) return;
        setInbound(data.slackInbound);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        setLoadError(
          failure instanceof ApiError && failure.isOffline
            ? 'Slack settings could not be fetched — this device looks offline.'
            : 'Slack settings could not be fetched.',
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
        id: 'slack.connect',
        title: 'Connect Slack',
        keys: ['n'],
        when: 'list',
        group: 'Slack',
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
      enableSlackConnection({
        defaultTeamId: teamId,
        channelName: channelName.trim() === '' ? undefined : channelName.trim(),
        webhookUrl: webhookUrl.trim() === '' ? undefined : webhookUrl.trim(),
        notifyIssues,
        notifyComments,
      }),
    );
    if (!landed) return;
    setWebhookUrl('');
    setWebhookEditing(false);
    setAttempt((n) => n + 1);
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (connection === null) return;
    const landed = await save.run(() =>
      updateSlackConnection({
        defaultTeamId: teamId,
        channelName: channelName.trim(),
        webhookUrl: webhookUrl.trim() === '' ? undefined : webhookUrl.trim(),
        notifyIssues,
        notifyComments,
      }),
    );
    if (!landed) return;
    setWebhookUrl('');
    setWebhookEditing(false);
    setAttempt((n) => n + 1);
  };

  const webhookSaved = inbound?.webhookConfigured === true;

  return (
    <SettingsPage
      title="Slack"
      description="Post issue and comment events to a channel, and file issues from Slack."
      error={loadError ?? undefined}
      actions={
        loadError === null ? undefined : (
          <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
        )
      }
    >
      <SettingsSection title="Channel notifications and slash commands">
        <p className={styles.hint}>
          Paste a Slack incoming-webhook URL to post issue and comment events to a channel. Slash
          commands create or comment on issues; <code>/asks</code> and a leading 🎫 file a triage
          Ask when that is on in Settings → Asks. Link unfurls and magic-word linkbacks need a Slack
          app. Bot token and signing secret live in process env, not in this workspace.
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
              One Slack connection per workspace. Admins pick a public team for slash-created
              issues, then optionally paste a channel webhook.
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
                  label="Channel name"
                  value={channelName}
                  onChange={(event) => setChannelName(event.target.value)}
                  hint="Optional. Display only — #eng"
                  disabled={pending}
                />
                <Input
                  label="Incoming webhook URL"
                  value={webhookUrl}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                  hint="Optional. From Slack: Incoming Webhooks → Add to Slack. Used to notify the channel."
                  disabled={pending}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Checkbox
                  label="Notify on issue create and update"
                  checked={notifyIssues}
                  onChange={(event) => setNotifyIssues(event.target.checked)}
                  disabled={pending}
                />
                <Checkbox
                  label="Notify on comments"
                  checked={notifyComments}
                  onChange={(event) => setNotifyComments(event.target.checked)}
                  disabled={pending}
                />
                <div className={styles.row}>
                  <Button variant="primary" disabled={pending || teamId === ''} type="submit">
                    Connect
                  </Button>
                </div>
              </form>
            ) : (
              <p className={styles.hint}>Ask an admin to connect Slack.</p>
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
              label="Channel name"
              value={channelName}
              onChange={(event) => setChannelName(event.target.value)}
              hint="Optional. Display only."
              disabled={!isAdmin || pending}
            />
            {webhookSaved && !webhookEditing ? (
              // A saved webhook is a fact, not an empty field: the URL is never sent back to
              // this client, so a box that could only ever show a blank was telling the reader
              // nothing about what Slack actually has. Replace is the only action offered:
              // updateSlackConnection ignores an empty webhookUrl, so a "Remove" button here
              // would report a removal the server never performed. Disconnecting drops it.
              <div className={styles.statusRow}>
                <p className={styles.statusText}>
                  Incoming webhook saved. Channel notifications post to it.
                </p>
                {isAdmin ? (
                  <Button type="button" disabled={pending} onClick={() => setWebhookEditing(true)}>
                    Replace webhook
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                <Input
                  label="Incoming webhook URL"
                  value={webhookUrl}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                  hint={
                    webhookSaved
                      ? 'Paste the new URL. Leaving this blank keeps the saved one.'
                      : 'Optional. Paste a Slack incoming-webhook URL to notify a channel.'
                  }
                  disabled={!isAdmin || pending}
                  autoComplete="off"
                  spellCheck={false}
                />
                {webhookSaved ? (
                  <div className={styles.row}>
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setWebhookUrl('');
                        setWebhookEditing(false);
                      }}
                    >
                      Keep the saved webhook
                    </Button>
                  </div>
                ) : null}
              </>
            )}
            <Checkbox
              label="Notify on issue create and update"
              checked={notifyIssues}
              onChange={(event) => setNotifyIssues(event.target.checked)}
              disabled={!isAdmin || pending}
            />
            <Checkbox
              label="Notify on comments"
              checked={notifyComments}
              onChange={(event) => setNotifyComments(event.target.checked)}
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

      {connection !== null && isAdmin && inbound !== null ? (
        <SettingsSection title="Slack app" flush>
          <p className={styles.hint}>
            Point a Slack slash command at the command URL and the Events API at the events URL.
            Signing secret is <code>POLARIS_SLACK_SIGNING_SECRET</code>
            {inbound.signingSecretConfigured ? ' (set)' : ' (not set)'}. Bot token is{' '}
            <code>POLARIS_SLACK_BOT_TOKEN</code>
            {inbound.botTokenConfigured ? ' (set)' : ' (not set)'}; needed for link unfurls.
            Subscribe to <code>link_shared</code> and <code>message.channels</code>. Command:{' '}
            <code>/polaris create Title</code>, <code>/polaris ENG-123</code>,{' '}
            <code>/polaris comment ENG-123 text</code>. Magic words such as{' '}
            <code>fixes ENG-123</code> post a linkback on the issue.
          </p>
          <p className={styles.mono}>{inbound.commandUrl}</p>
          <p className={styles.mono}>{inbound.eventsUrl}</p>
        </SettingsSection>
      ) : null}

      {connection !== null && isAdmin ? (
        <DangerZone>
          <DangerZoneRow
            title="Disconnect Slack"
            consequence="Channel notifications, slash commands and unfurls stop. The saved webhook URL is dropped with the connection. Issues Slack already filed stay."
            action={
              <Button
                variant="danger"
                disabled={pending}
                onClick={() => {
                  setDisconnectError(null);
                  setDisconnecting(true);
                }}
              >
                Disconnect Slack
              </Button>
            }
          />
        </DangerZone>
      ) : null}

      <ConfirmDialog
        open={disconnecting}
        title="Disconnect Slack?"
        consequence="Channel notifications, slash commands, and unfurls stop. Existing issues stay."
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
          disconnectSlack()
            .then(() => setDisconnecting(false))
            .catch((failure: unknown) => {
              // The dialog stays open until the server has answered. Dismissing it first
              // put the refusal on a page the user had already turned away from.
              setDisconnectError(
                failure instanceof ApiError ? failure.message : 'Could not disconnect Slack.',
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
  return 'Slack settings could not be saved.';
}
