/**
 * GitHub: workspace install, branch names, commit webhook, personal login.
 *
 * The connection and the user link are on the replica. The commit-webhook secret is not,
 * so that half is a GraphQL query. The screen still works with no GitHub App credentials
 * in the environment: enable, paste a webhook, type a username. OAuth stays disabled
 * until POLARIS_GITHUB_CLIENT_ID is set.
 *
 * Two forms live here — the workspace connection and the viewer's own login — and they
 * fail independently, so they report independently. A single page-top banner used to
 * collect every refusal and offer "Try again", which re-runs the fetch above and cannot
 * retry the save that failed.
 */

import { useEffect, useState, type FormEvent } from 'react';

import { useActions, useKeyContext } from '~/app/keymap';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DangerZone,
  DangerZoneRow,
  EmptyState,
  Input,
  SaveIndicator,
  SecretField,
  SettingsPage,
  SettingsSection,
  Spinner,
  useSaveState,
} from '~/components';
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

/*
 * One describe function per section, defined out here so `useSaveState` keeps a stable
 * `run` across renders. Each shows the server's own refusal where there is one — "that
 * organisation does not exist" beats any sentence written in advance.
 */
const describeWorkspaceFailure = (failure: unknown): string =>
  failure instanceof ApiError ? failure.message : 'Could not save GitHub settings.';
const describeCommitsFailure = (failure: unknown): string =>
  failure instanceof ApiError ? failure.message : 'Could not update commit linking.';
const describeLinkbacksFailure = (failure: unknown): string =>
  failure instanceof ApiError ? failure.message : 'Could not update linkbacks.';
const describeLoginFailure = (failure: unknown): string =>
  failure instanceof ApiError ? failure.message : 'Could not save GitHub username.';

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orgLogin, setOrgLogin] = useState('');
  const [branchFormat, setBranchFormat] = useState(DEFAULT_GIT_BRANCH_FORMAT);
  const [loginDraft, setLoginDraft] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  // Kept apart from loadError: that banner's "Try again" re-runs the settings fetch, which
  // cannot retry a refused disconnect, and it renders underneath the still-open dialog.
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const workspaceSave = useSaveState(describeWorkspaceFailure);
  const commitsSave = useSaveState(describeCommitsFailure);
  const linkbacksSave = useSaveState(describeLinkbacksFailure);
  const loginSave = useSaveState(describeLoginFailure);

  const savingWorkspace = workspaceSave.state === 'saving';
  const savingLogin = loginSave.state === 'saving';

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
    setLoading(true);
    setLoadError(null);
    loadGitHubSettings()
      .then((data) => {
        if (!live) return;
        setOAuthConfigured(data.githubOAuthConfigured);
        setWebhook(data.githubCommitWebhook);
        setLoading(false);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        setLoadError(
          failure instanceof ApiError && failure.isOffline
            ? 'GitHub settings could not be fetched — this device looks offline.'
            : 'GitHub settings could not be fetched.',
        );
        setLoading(false);
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
        enabled: () => isAdmin && connection === null && !savingWorkspace,
        run: () => {
          void onEnable();
        },
      },
    ],
    [isAdmin, connection, savingWorkspace],
  );

  const onEnable = async () => {
    const landed = await workspaceSave.run(() => enableGitHubConnection({}));
    if (landed) setAttempt((n) => n + 1);
  };

  const onSaveWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    if (connection === null) return;
    await workspaceSave.run(() =>
      updateGitHubConnection({
        orgLogin: orgLogin.trim() === '' ? undefined : orgLogin.trim(),
        branchNameFormat: branchFormat,
        linkCommits: connection.linkCommits,
        linkbacks: connection.linkbacks,
      }),
    );
  };

  const onToggleCommits = async (linkCommits: boolean) => {
    if (connection === null) return;
    const landed = await commitsSave.run(() => updateGitHubConnection({ linkCommits }));
    // The secret only exists while commits are linked, so the fetch has to run again.
    if (landed) setAttempt((n) => n + 1);
  };

  const onToggleLinkbacks = async (linkbacks: boolean) => {
    if (connection === null) return;
    await linkbacksSave.run(() => updateGitHubConnection({ linkbacks }));
  };

  const onSaveLogin = async (event: FormEvent) => {
    event.preventDefault();
    await loginSave.run(() => linkGitHubLogin(loginDraft.trim()));
  };

  const retry = () => setAttempt((n) => n + 1);

  const webhookPanel = loading ? (
    <Spinner label="Loading webhook details" />
  ) : webhook === null ? (
    <EmptyState
      title="Webhook details could not be loaded"
      description={
        loadError ??
        'The server did not return a URL and secret for this connection. Nothing is broken on GitHub — this page simply has nothing to show you yet.'
      }
      action={<Button onClick={retry}>Try again</Button>}
    />
  ) : (
    <>
      <p className={styles.hint}>
        Add a GitHub org or repo webhook for Push events, content type application/json, with this
        URL and secret.
      </p>
      <p className={styles.mono}>{webhook.url}</p>
      <SecretField
        label="Webhook secret"
        value={webhook.secret}
        consequence="Paste this into GitHub's webhook secret field. This page shows the secret currently in force, so a later visit can read it again; if it is ever rotated, every webhook still sending the old one is rejected until each is updated."
      />
    </>
  );

  return (
    <SettingsPage
      title="GitHub"
      description="Link a pull request or commit to an issue when the title, description or branch name contains the issue id, or a closing word such as fixes or closes. Copy git branch name from an issue with the keyboard shortcut."
      error={loadError ?? undefined}
    >
      <SettingsSection
        title="Workspace"
        status={<SaveIndicator state={workspaceSave.state} />}
        error={workspaceSave.error}
      >
        {connection === null ? (
          <>
            <p className={styles.hint}>
              One GitHub connection per workspace. Admins enable it here; a GitHub App is optional
              until you set POLARIS_GITHUB_CLIENT_ID on the server.
            </p>
            {isAdmin ? (
              <div className={styles.row}>
                <Button
                  variant="primary"
                  disabled={savingWorkspace}
                  onClick={() => void onEnable()}
                >
                  Enable GitHub
                </Button>
              </div>
            ) : (
              <p className={styles.hint}>Ask an admin to enable GitHub for this workspace.</p>
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
              onChange={(event) => {
                setOrgLogin(event.target.value);
                workspaceSave.clear();
              }}
              hint="GitHub org login, if this workspace maps to one."
              disabled={!isAdmin || savingWorkspace}
            />
            <Input
              label="Branch name format"
              value={branchFormat}
              onChange={(event) => {
                setBranchFormat(event.target.value);
                workspaceSave.clear();
              }}
              hint="Placeholders: {identifier}, {title}, {user}."
              disabled={!isAdmin || savingWorkspace}
            />
            {isAdmin ? (
              <div className={styles.row}>
                <Button variant="primary" disabled={savingWorkspace} type="submit">
                  Save
                </Button>
              </div>
            ) : null}
          </form>
        )}
      </SettingsSection>

      {connection !== null && isAdmin ? (
        <SettingsSection
          title="Commit linking"
          status={<SaveIndicator state={commitsSave.state} />}
          error={commitsSave.error}
        >
          <Checkbox
            label="Link commits to issues with magic words"
            checked={connection.linkCommits}
            disabled={commitsSave.state === 'saving'}
            onChange={(event) => void onToggleCommits(event.target.checked)}
          />
          {connection.linkCommits ? webhookPanel : null}
        </SettingsSection>
      ) : null}

      {connection !== null && isAdmin ? (
        <SettingsSection
          title="Linkbacks"
          status={<SaveIndicator state={linkbacksSave.state} />}
          error={linkbacksSave.error}
        >
          <Checkbox
            label="Post a comment on the pull request or commit when it links to an issue"
            checked={connection.linkbacks}
            disabled={linkbacksSave.state === 'saving'}
            onChange={(event) => void onToggleLinkbacks(event.target.checked)}
          />
          <p className={styles.hint}>
            Private teams get the issue URL only. Turn this off if GitHub notifications from those
            comments are noise.
          </p>
        </SettingsSection>
      ) : null}

      <SettingsSection
        title="Your GitHub account"
        description="Linking your login attributes pull requests to you. Without OAuth app credentials on the server you can type the username yourself."
        status={<SaveIndicator state={loginSave.state} />}
        error={loginSave.error}
        flush={connection === null || !isAdmin}
      >
        {userLink !== null ? (
          <p className={styles.hint}>Connected as @{userLink.githubLogin}</p>
        ) : null}
        <form onSubmit={(event) => void onSaveLogin(event)}>
          <Input
            label="GitHub username"
            value={loginDraft}
            onChange={(event) => {
              setLoginDraft(event.target.value);
              loginSave.clear();
            }}
            disabled={savingLogin}
          />
          <div className={styles.row}>
            <Button
              variant="primary"
              disabled={savingLogin || loginDraft.trim() === ''}
              type="submit"
            >
              Save username
            </Button>
            {userLink !== null ? (
              <Button
                disabled={savingLogin}
                type="button"
                onClick={() => void loginSave.run(unlinkGitHubLogin)}
              >
                Disconnect account
              </Button>
            ) : null}
            <Button
              disabled={savingLogin || !oauthConfigured}
              type="button"
              onClick={() => void loginSave.run(startGitHubOAuth)}
            >
              Connect with GitHub
            </Button>
          </div>
          {oauthConfigured ? null : (
            <p className={styles.hint}>
              Connect with GitHub stays off until this install has POLARIS_GITHUB_CLIENT_ID and
              POLARIS_GITHUB_CLIENT_SECRET.
            </p>
          )}
        </form>
      </SettingsSection>

      {connection !== null && isAdmin ? (
        <DangerZone>
          <DangerZoneRow
            title="Disconnect GitHub"
            consequence="Issues keep any pull request or commit cards already attached. New events stop linking until GitHub is enabled again."
            action={
              <Button
                variant="danger"
                disabled={disconnectBusy}
                onClick={() => setDisconnecting(true)}
              >
                Disconnect GitHub
              </Button>
            }
          />
        </DangerZone>
      ) : null}

      <ConfirmDialog
        open={disconnecting}
        title="Disconnect GitHub?"
        consequence="Issues keep any pull request or commit cards already attached. New events stop linking until GitHub is enabled again."
        confirmLabel="Disconnect"
        destructive
        busy={disconnectBusy}
        error={disconnectError ?? undefined}
        onClose={() => {
          setDisconnecting(false);
          setDisconnectError(null);
        }}
        onConfirm={() => {
          if (disconnectBusy) return;
          setDisconnectBusy(true);
          setDisconnectError(null);
          disconnectGitHub()
            .then(() => {
              setDisconnecting(false);
              setWebhook(null);
            })
            .catch((failure: unknown) => {
              // Inside the dialog, not in the page banner the open modal covers.
              setDisconnectError(
                failure instanceof ApiError ? failure.message : 'Could not disconnect GitHub.',
              );
            })
            .finally(() => setDisconnectBusy(false));
        }}
      />
    </SettingsPage>
  );
}
