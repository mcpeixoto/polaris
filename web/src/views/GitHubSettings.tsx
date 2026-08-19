/**
 * GitHub: workspace install, branch names, commit webhook, personal login.
 *
 * The connection and the user link are on the replica. The commit-webhook secret is not,
 * so that half is a GraphQL query. The screen still works with no GitHub App credentials
 * in the environment: enable, paste a webhook, type a username. OAuth stays disabled
 * until POLARIS_GITHUB_CLIENT_ID is set.
 */

import { useEffect, useState, type FormEvent } from 'react';

import { useActions, useKeyContext } from '~/app/keymap';
import { Badge, Button, Checkbox, Input, Spinner } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { SecretField } from '~/components/SecretField';
import { DEFAULT_GIT_BRANCH_FORMAT } from '~/features/github/branch';
import {
  disconnectGitHub,
  enableGitHubConnection,
  linkGitHubLogin,
  loadGitHubSettings,
  startGitHubOAuth,
  unlinkGitHubLogin,
  updateGitHubConnection,
} from '~/features/github/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import { ApiError } from '~/sync/api';

import styles from './GitHubSettings.module.css';

export function GitHubSettings() {
  const viewer = useViewer();
  const isAdmin = viewer !== null && (viewer.role === 'owner' || viewer.role === 'admin');
  const connection = useLiveQuery(
    (store) => [...store.githubConnections.values()][0] ?? null,
    ['githubConnection'],
  );
  const userLink = useLiveQuery(
    (store) =>
      viewer === null
        ? null
        : ([...store.githubUserLinks.values()].find((row) => row.userId === viewer.id) ?? null),
    ['githubUserLink'],
    [viewer?.id],
  );

  const [oauthConfigured, setOAuthConfigured] = useState(false);
  const [webhook, setWebhook] = useState<{ url: string; secret: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [orgLogin, setOrgLogin] = useState('');
  const [branchFormat, setBranchFormat] = useState(DEFAULT_GIT_BRANCH_FORMAT);
  const [loginDraft, setLoginDraft] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (connection !== null) {
      setOrgLogin(connection.orgLogin ?? '');
      setBranchFormat(connection.branchNameFormat);
    } else {
      setOrgLogin('');
      setBranchFormat(DEFAULT_GIT_BRANCH_FORMAT);
    }
  }, [connection]);

  useEffect(() => {
    if (userLink !== null) setLoginDraft(userLink.githubLogin);
  }, [userLink]);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    loadGitHubSettings()
      .then((data) => {
        if (!live) return;
        setOAuthConfigured(data.githubOAuthConfigured);
        setWebhook(data.githubCommitWebhook);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        setLoadError(
          failure instanceof ApiError && failure.isOffline
            ? 'GitHub settings could not be fetched — this device looks offline.'
            : 'GitHub settings could not be fetched.',
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
        id: 'github.connect',
        title: 'Connect GitHub',
        keys: ['n'],
        when: 'list',
        group: 'GitHub',
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
      await enableGitHubConnection({});
      setAttempt((n) => n + 1);
    } catch (failure: unknown) {
      setLoadError(failure instanceof ApiError ? failure.message : 'Could not connect GitHub.');
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
      await updateGitHubConnection({
        orgLogin: orgLogin.trim() === '' ? undefined : orgLogin.trim(),
        branchNameFormat: branchFormat,
        linkCommits: connection.linkCommits,
        linkbacks: connection.linkbacks,
      });
    } catch (failure: unknown) {
      setLoadError(
        failure instanceof ApiError ? failure.message : 'Could not save GitHub settings.',
      );
    } finally {
      setBusy(false);
    }
  };

  const onToggleCommits = async (linkCommits: boolean) => {
    if (connection === null) return;
    setBusy(true);
    try {
      await updateGitHubConnection({ linkCommits });
      setAttempt((n) => n + 1);
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
      await updateGitHubConnection({ linkbacks });
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
      await linkGitHubLogin(loginDraft.trim());
    } catch (failure: unknown) {
      setLoadError(
        failure instanceof ApiError ? failure.message : 'Could not save GitHub username.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>GitHub</h1>
      </header>
      <div className={styles.body}>
        <section className={styles.section} aria-labelledby="github-about">
          <h2 className={styles.sectionTitle} id="github-about">
            Pull requests and commits
          </h2>
          <p className={styles.sectionHint}>
            Link a pull request or commit to an issue when the title, description or branch name
            contains the issue id, or a closing word such as fixes or closes. Copy git branch name
            from an issue with the keyboard shortcut.
          </p>
        </section>

        {loadError === null ? null : (
          <div className={styles.failure} role="alert">
            <p className={styles.failureText}>{loadError}</p>
            <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
          </div>
        )}

        <section className={styles.section} aria-labelledby="github-workspace">
          <h2 className={styles.sectionTitle} id="github-workspace">
            Workspace
          </h2>
          {connection === null ? (
            <>
              <p className={styles.sectionHint}>
                One GitHub connection per workspace. Admins enable it here; a GitHub App is optional
                until you set POLARIS_GITHUB_CLIENT_ID on the server.
              </p>
              {isAdmin ? (
                <div className={styles.row}>
                  <Button variant="primary" disabled={busy} onClick={() => void onEnable()}>
                    Enable GitHub
                  </Button>
                </div>
              ) : (
                <p className={styles.note}>Ask an admin to enable GitHub for this workspace.</p>
              )}
            </>
          ) : (
            <form onSubmit={(event) => void onSaveWorkspace(event)}>
              <div className={styles.row}>
                <Badge>{connection.enabled ? 'Enabled' : 'Disabled'}</Badge>
              </div>
              <Input
                label="Organisation"
                value={orgLogin}
                onChange={(event) => setOrgLogin(event.target.value)}
                hint="GitHub org login, if this workspace maps to one."
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

        {connection !== null && isAdmin ? (
          <section className={styles.section} aria-labelledby="github-commits">
            <h2 className={styles.sectionTitle} id="github-commits">
              Commit linking
            </h2>
            <Checkbox
              label="Link commits to issues with magic words"
              checked={connection.linkCommits}
              disabled={busy}
              onChange={(event) => void onToggleCommits(event.target.checked)}
            />
            {connection.linkCommits && webhook !== null ? (
              <>
                <p className={styles.sectionHint}>
                  Add a GitHub org or repo webhook for Push events, content type application/json,
                  with this URL and secret.
                </p>
                <p className={styles.mono}>{webhook.url}</p>
                <SecretField
                  label="Webhook secret"
                  value={webhook.secret}
                  consequence="Paste this into GitHub now. It is not shown again on a later visit unless you are still an admin of this workspace."
                />
              </>
            ) : null}
          </section>
        ) : null}

        {connection !== null && isAdmin ? (
          <section className={styles.section} aria-labelledby="github-linkbacks">
            <h2 className={styles.sectionTitle} id="github-linkbacks">
              Linkbacks
            </h2>
            <Checkbox
              label="Post a comment on the pull request or commit when it links to an issue"
              checked={connection.linkbacks}
              disabled={busy}
              onChange={(event) => void onToggleLinkbacks(event.target.checked)}
            />
            <p className={styles.sectionHint}>
              Private teams get the issue URL only. Turn this off if GitHub notifications from those
              comments are noise.
            </p>
          </section>
        ) : null}

        <section className={styles.section} aria-labelledby="github-account">
          <h2 className={styles.sectionTitle} id="github-account">
            Your GitHub account
          </h2>
          <p className={styles.sectionHint}>
            Linking your login attributes pull requests to you. Without OAuth app credentials on the
            server you can type the username yourself.
          </p>
          {userLink !== null ? (
            <p className={styles.note}>Connected as @{userLink.githubLogin}</p>
          ) : null}
          <form onSubmit={(event) => void onSaveLogin(event)}>
            <Input
              label="GitHub username"
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
                    unlinkGitHubLogin()
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
              <Button
                disabled={busy || !oauthConfigured}
                type="button"
                onClick={() => {
                  setBusy(true);
                  startGitHubOAuth().catch((failure: unknown) => {
                    setBusy(false);
                    setLoadError(
                      failure instanceof ApiError
                        ? failure.message
                        : 'GitHub OAuth is not configured on this install.',
                    );
                  });
                }}
              >
                Connect with GitHub
              </Button>
            </div>
            {oauthConfigured ? null : (
              <p className={styles.note}>
                Connect with GitHub stays off until this install has POLARIS_GITHUB_CLIENT_ID and
                POLARIS_GITHUB_CLIENT_SECRET.
              </p>
            )}
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
        title="Disconnect GitHub?"
        consequence="Issues keep any pull request or commit cards already attached. New events stop linking until GitHub is enabled again."
        confirmLabel="Disconnect"
        destructive
        busy={busy}
        onClose={() => setDisconnecting(false)}
        onConfirm={() => {
          if (busy) return;
          setBusy(true);
          void disconnectGitHub()
            .then(() => {
              setDisconnecting(false);
              setWebhook(null);
            })
            .catch((failure: unknown) => {
              setLoadError(
                failure instanceof ApiError ? failure.message : 'Could not disconnect GitHub.',
              );
            })
            .finally(() => setBusy(false));
        }}
      />
    </div>
  );
}
