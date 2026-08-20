/**
 * Slack: channel notifications, slash create/comment, link unfurls.
 *
 * The connection is on the replica. The incoming-webhook URL is not. Setup is a default
 * public team plus an optional Slack incoming webhook; slash commands and unfurls need
 * POLARIS_SLACK_SIGNING_SECRET and POLARIS_SLACK_BOT_TOKEN on the process.
 */

import { useEffect, useState, type FormEvent } from 'react';

import { useActions, useKeyContext } from '~/app/keymap';
import { Button, Checkbox, Input, Select, Spinner } from '~/components';
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
  const [busy, setBusy] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [channelName, setChannelName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [notifyIssues, setNotifyIssues] = useState(true);
  const [notifyComments, setNotifyComments] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [attempt, setAttempt] = useState(0);

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
      await enableSlackConnection({
        defaultTeamId: teamId,
        channelName: channelName.trim() === '' ? undefined : channelName.trim(),
        webhookUrl: webhookUrl.trim() === '' ? undefined : webhookUrl.trim(),
        notifyIssues,
        notifyComments,
      });
      setWebhookUrl('');
      setAttempt((n) => n + 1);
    } catch (failure: unknown) {
      setLoadError(failure instanceof ApiError ? failure.message : 'Could not connect Slack.');
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
      await updateSlackConnection({
        defaultTeamId: teamId,
        channelName: channelName.trim(),
        webhookUrl: webhookUrl.trim() === '' ? undefined : webhookUrl.trim(),
        notifyIssues,
        notifyComments,
      });
      setWebhookUrl('');
      setAttempt((n) => n + 1);
    } catch (failure: unknown) {
      setLoadError(
        failure instanceof ApiError ? failure.message : 'Could not save Slack settings.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Slack</h1>
        {busy ? <Spinner /> : null}
      </header>
      <div className={styles.body}>
        <section className={styles.section} aria-labelledby="slack-about">
          <h2 className={styles.sectionTitle} id="slack-about">
            Channel notifications and slash commands
          </h2>
          <p className={styles.sectionHint}>
            Paste a Slack incoming-webhook URL to post issue and comment events to a channel.
            Slash commands create or comment on issues; link unfurls and magic-word linkbacks need
            a Slack app. Bot token and signing secret live in process env, not in this workspace.
          </p>
        </section>

        {loadError === null ? null : (
          <div className={styles.failure} role="alert">
            <p className={styles.failureText}>{loadError}</p>
            <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
          </div>
        )}

        <section className={styles.section} aria-labelledby="slack-workspace">
          <h2 className={styles.sectionTitle} id="slack-workspace">
            Workspace
          </h2>
          {connection === null ? (
            <>
              <p className={styles.sectionHint}>
                One Slack connection per workspace. Admins pick a public team for slash-created
                issues, then optionally paste a channel webhook.
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
                    label="Channel name"
                    value={channelName}
                    onChange={(event) => setChannelName(event.target.value)}
                    hint="Optional. Display only — #eng"
                    disabled={busy}
                  />
                  <Input
                    label="Incoming webhook URL"
                    value={webhookUrl}
                    onChange={(event) => setWebhookUrl(event.target.value)}
                    hint="Optional. From Slack: Incoming Webhooks → Add to Slack. Used to notify the channel."
                    disabled={busy}
                    type="password"
                    autoComplete="off"
                  />
                  <Checkbox
                    label="Notify on issue create and update"
                    checked={notifyIssues}
                    onChange={(event) => setNotifyIssues(event.target.checked)}
                    disabled={busy}
                  />
                  <Checkbox
                    label="Notify on comments"
                    checked={notifyComments}
                    onChange={(event) => setNotifyComments(event.target.checked)}
                    disabled={busy}
                  />
                  <div className={styles.row}>
                    <Button variant="primary" disabled={busy || teamId === ''} type="submit">
                      Connect
                    </Button>
                  </div>
                </form>
              ) : (
                <p className={styles.sectionHint}>Ask an admin to connect Slack.</p>
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
                label="Channel name"
                value={channelName}
                onChange={(event) => setChannelName(event.target.value)}
                hint="Optional. Display only."
                disabled={!isAdmin || busy}
              />
              <Input
                label="Incoming webhook URL"
                value={webhookUrl}
                onChange={(event) => setWebhookUrl(event.target.value)}
                hint={
                  inbound?.webhookConfigured
                    ? 'A webhook is saved. Paste a new URL to replace it. Leave blank to keep the current one.'
                    : 'Optional. Paste a Slack incoming-webhook URL to notify a channel.'
                }
                disabled={!isAdmin || busy}
                type="password"
                autoComplete="off"
              />
              <Checkbox
                label="Notify on issue create and update"
                checked={notifyIssues}
                onChange={(event) => setNotifyIssues(event.target.checked)}
                disabled={!isAdmin || busy}
              />
              <Checkbox
                label="Notify on comments"
                checked={notifyComments}
                onChange={(event) => setNotifyComments(event.target.checked)}
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

        {connection !== null && isAdmin && inbound !== null ? (
          <section className={styles.section} aria-labelledby="slack-inbound">
            <h2 className={styles.sectionTitle} id="slack-inbound">
              Slack app
            </h2>
            <p className={styles.sectionHint}>
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
          </section>
        ) : null}
      </div>

      <ConfirmDialog
        open={disconnecting}
        title="Disconnect Slack?"
        consequence="Channel notifications, slash commands, and unfurls stop. Existing issues stay."
        confirmLabel="Disconnect"
        destructive
        onClose={() => setDisconnecting(false)}
        onConfirm={() => {
          setDisconnecting(false);
          setBusy(true);
          void disconnectSlack()
            .catch((failure: unknown) => {
              setLoadError(
                failure instanceof ApiError ? failure.message : 'Could not disconnect Slack.',
              );
            })
            .finally(() => setBusy(false));
        }}
      />
    </div>
  );
}
