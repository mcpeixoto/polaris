/**
 * GitLab: workspace instance, branch names, webhook, personal username.
 *
 * The connection and the user link are on the replica. The webhook token is not, so
 * that half is a GraphQL query. Setup is a personal or project access token plus a
 * Group or Project webhook — GitLab has no App install.
 */

import { useEffect, useState, type FormEvent } from 'react';

import { useActions, useKeyContext } from '~/app/keymap';
import { Badge, Button, Checkbox, Input, Spinner } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { SecretField } from '~/components/SecretField';
import { DEFAULT_GIT_BRANCH_FORMAT } from '~/features/github/branch';
import {
  disconnectGitLab,
  enableGitLabConnection,
  linkGitLabUsername,
  loadGitLabSettings,
  unlinkGitLabUsername,
  updateGitLabConnection,
} from '~/features/gitlab/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import { ApiError } from '~/sync/api';

import styles from './GitLabSettings.module.css';

export function GitLabSettings() {
  const viewer = useViewer();
  const isAdmin = viewer !== null && (viewer.role === 'owner' || viewer.role === 'admin');
  const connection = useLiveQuery(
    (store) => [...store.gitlabConnections.values()][0] ?? null,
    ['gitlabConnection'],
  );
  const userLink = useLiveQuery(
    (store) =>
      viewer === null
        ? null
        : ([...store.gitlabUserLinks.values()].find((row) => row.userId === viewer.id) ?? null),
    ['gitlabUserLink'],
    [viewer?.id],
  );

  const [webhook, setWebhook] = useState<{ url: string; secret: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [instanceUrl, setInstanceUrl] = useState('https://gitlab.com');
  const [accessToken, setAccessToken] = useState('');
  const [branchFormat, setBranchFormat] = useState(DEFAULT_GIT_BRANCH_FORMAT);
  const [loginDraft, setLoginDraft] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (connection !== null) {
      setInstanceUrl(connection.instanceUrl);
      setBranchFormat(connection.branchNameFormat);
    } else {
      setInstanceUrl('https://gitlab.com');
      setBranchFormat(DEFAULT_GIT_BRANCH_FORMAT);
    }
  }, [connection]);

  useEffect(() => {
    if (userLink !== null) setLoginDraft(userLink.gitlabUsername);
  }, [userLink]);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    loadGitLabSettings()
      .then((data) => {
        if (!live) return;
        setWebhook(data.gitlabWebhook);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        setLoadError(
          failure instanceof ApiError && failure.isOffline
            ? 'GitLab settings could not be fetched — this device looks offline.'
            : 'GitLab settings could not be fetched.',
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
        id: 'gitlab.connect',
        title: 'Connect GitLab',
        keys: ['n'],
        when: 'list',
        group: 'GitLab',
        enabled: () => isAdmin && connection === null && !busy,
        run: () => {
          void onEnable();
        },
      },
    ],
    [isAdmin, connection, busy],
  );

  const onEnable = async () => {
    setBusy(true);
    setLoadError(null);
    try {
      await enableGitLabConnection({
        instanceUrl: instanceUrl.trim() === '' ? undefined : instanceUrl.trim(),
        accessToken: accessToken.trim() === '' ? undefined : accessToken.trim(),
      });
      setAccessToken('');
      setAttempt((n) => n + 1);
    } catch (failure: unknown) {
      setLoadError(failure instanceof ApiError ? failure.message : 'Could not connect GitLab.');
    } finally {
      setBusy(false);
    }
  };

  const onSaveWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    if (connection === null) return;
    setBusy(true);
    setLoadError(null);
    try {
      await updateGitLabConnection({
        instanceUrl: instanceUrl.trim() === '' ? undefined : instanceUrl.trim(),
        accessToken: accessToken.trim() === '' ? undefined : accessToken.trim(),
        branchNameFormat: branchFormat,
        linkCommits: connection.linkCommits,
        linkbacks: connection.linkbacks,
      });
      setAccessToken('');
    } catch (failure: unknown) {
      setLoadError(
        failure instanceof ApiError ? failure.message : 'Could not save GitLab settings.',
      );
    } finally {
      setBusy(false);
    }
  };

  const onToggleCommits = async (linkCommits: boolean) => {
    if (connection === null) return;
    setBusy(true);
    try {
      await updateGitLabConnection({ linkCommits });
    } catch (failure: unknown) {
      setLoadError(
        failure instanceof ApiError ? failure.message : 'Could not update commit linking.',
      );
    } finally {
      setBusy(false);
    }
  };

  const onToggleLinkbacks = async (linkbacks: boolean) => {
    if (connection === null) return;
    setBusy(true);
    try {
      await updateGitLabConnection({ linkbacks });
    } catch (failure: unknown) {
      setLoadError(failure instanceof ApiError ? failure.message : 'Could not update linkbacks.');
    } finally {
      setBusy(false);
    }
  };

  const onSaveLogin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setLoadError(null);
    try {
      await linkGitLabUsername(loginDraft.trim());
    } catch (failure: unknown) {
      setLoadError(
        failure instanceof ApiError ? failure.message : 'Could not save GitLab username.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>GitLab</h1>
      </header>
      <div className={styles.body}>
        <section className={styles.section} aria-labelledby="gitlab-about">
          <h2 className={styles.sectionTitle} id="gitlab-about">
            Merge requests and commits
          </h2>
          <p className={styles.sectionHint}>
            Link a merge request or commit to an issue when the title, description or branch name
            contains the issue id, or a closing word such as fixes or closes. Copy git branch name
            from an issue with the keyboard shortcut. Magic words in comments do not create links.
          </p>
        </section>

        {loadError === null ? null : (
          <div className={styles.failure} role="alert">
            <p className={styles.failureText}>{loadError}</p>
            <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
          </div>
        )}

        <section className={styles.section} aria-labelledby="gitlab-workspace">
          <h2 className={styles.sectionTitle} id="gitlab-workspace">
            Workspace
          </h2>
          {connection === null ? (
            <>
              <p className={styles.sectionHint}>
                One GitLab instance per workspace. Admins enable it here with a personal or project
                access token (<code>api</code> scope; <code>read_api</code> disables linkbacks).
                GitLab has no bot accounts, so notes are posted as the token owner — a dedicated
                user is recommended.
              </p>
              {isAdmin ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onEnable();
                  }}
                >
                  <Input
                    label="Instance URL"
                    value={instanceUrl}
                    onChange={(event) => setInstanceUrl(event.target.value)}
                    hint="gitlab.com, or a self-hosted origin with no path."
                    disabled={busy}
                  />
                  <Input
                    label="Access token"
                    value={accessToken}
                    onChange={(event) => setAccessToken(event.target.value)}
                    hint="Personal or project access token. Optional for inbound linking; required for linkbacks."
                    disabled={busy}
                  />
                  <div className={styles.row}>
                    <Button variant="primary" disabled={busy} type="submit">
                      Enable GitLab
                    </Button>
                  </div>
                </form>
              ) : (
                <p className={styles.note}>Ask an admin to enable GitLab for this workspace.</p>
              )}
            </>
          ) : (
            <form onSubmit={(event) => void onSaveWorkspace(event)}>
              <div className={styles.row}>
                <Badge>{connection.enabled ? 'Enabled' : 'Disabled'}</Badge>
              </div>
              <Input
                label="Instance URL"
                value={instanceUrl}
                onChange={(event) => setInstanceUrl(event.target.value)}
                hint="gitlab.com, or a self-hosted origin with no path."
                disabled={!isAdmin || busy}
              />
              <Input
                label="Access token"
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
                hint="Leave blank to keep the current token. Saving a new one replaces it."
                disabled={!isAdmin || busy}
              />
              <Input
                label="Branch name format"
                value={branchFormat}
                onChange={(event) => setBranchFormat(event.target.value)}
                hint="Placeholders: {identifier}, {title}, {user}."
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
          <section className={styles.section} aria-labelledby="gitlab-webhook">
            <h2 className={styles.sectionTitle} id="gitlab-webhook">
              Webhook
            </h2>
            <p className={styles.sectionHint}>
              Add this URL as a Group webhook (covers every project) or a Project webhook. Enable
              Push events, Merge request events and Pipeline events. Keep SSL verification on.
            </p>
            <p className={styles.mono}>{webhook.url}</p>
            <SecretField
              label="Webhook token"
              value={webhook.secret}
              consequence="Paste this into GitLab as the secret token. It is not shown again on a later visit unless you are still an admin of this workspace."
            />
          </section>
        ) : null}

        {connection !== null && isAdmin ? (
          <section className={styles.section} aria-labelledby="gitlab-commits">
            <h2 className={styles.sectionTitle} id="gitlab-commits">
              Commit linking
            </h2>
            <Checkbox
              label="Link commits to issues with magic words"
              checked={connection.linkCommits}
              disabled={busy}
              onChange={(event) => void onToggleCommits(event.target.checked)}
            />
            <p className={styles.sectionHint}>
              Requires Push events on the webhook. A magic word in the commit message links the
              commit; comments never do.
            </p>
          </section>
        ) : null}

        {connection !== null && isAdmin ? (
          <section className={styles.section} aria-labelledby="gitlab-linkbacks">
            <h2 className={styles.sectionTitle} id="gitlab-linkbacks">
              Linkbacks
            </h2>
            <Checkbox
              label="Post a note on the merge request or commit when it links to an issue"
              checked={connection.linkbacks}
              disabled={busy}
              onChange={(event) => void onToggleLinkbacks(event.target.checked)}
            />
            <p className={styles.sectionHint}>
              Private teams get the issue URL only. Notes are posted as the token owner. Turn this
              off if GitLab notifications from those notes are noise.
            </p>
          </section>
        ) : null}

        <section className={styles.section} aria-labelledby="gitlab-account">
          <h2 className={styles.sectionTitle} id="gitlab-account">
            Your GitLab account
          </h2>
          <p className={styles.sectionHint}>
            Linking your username attributes merge requests to you.
          </p>
          {userLink !== null ? (
            <p className={styles.note}>Connected as @{userLink.gitlabUsername}</p>
          ) : null}
          <form onSubmit={(event) => void onSaveLogin(event)}>
            <Input
              label="GitLab username"
              value={loginDraft}
              onChange={(event) => setLoginDraft(event.target.value)}
              disabled={busy}
            />
            <div className={styles.row}>
              <Button variant="primary" disabled={busy || loginDraft.trim() === ''} type="submit">
                Save username
              </Button>
              {userLink !== null ? (
                <Button
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    setBusy(true);
                    unlinkGitLabUsername()
                      .catch((failure: unknown) => {
                        setLoadError(
                          failure instanceof ApiError ? failure.message : 'Could not disconnect.',
                        );
                      })
                      .finally(() => setBusy(false));
                  }}
                >
                  Disconnect account
                </Button>
              ) : null}
            </div>
          </form>
        </section>

        {busy && connection === null ? (
          <div>
            <Spinner label="Working" />
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={disconnecting}
        title="Disconnect GitLab?"
        consequence="Issues keep any merge request or commit cards already attached. New events stop linking until GitLab is enabled again."
        confirmLabel="Disconnect"
        destructive
        busy={busy}
        onClose={() => setDisconnecting(false)}
        onConfirm={() => {
          if (busy) return;
          setBusy(true);
          void disconnectGitLab()
            .then(() => {
              setDisconnecting(false);
              setWebhook(null);
            })
            .catch((failure: unknown) => {
              setLoadError(
                failure instanceof ApiError ? failure.message : 'Could not disconnect GitLab.',
              );
            })
            .finally(() => setBusy(false));
        }}
      />
    </div>
  );
}
