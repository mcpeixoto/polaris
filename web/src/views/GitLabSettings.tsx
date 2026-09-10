/**
 * GitLab: workspace instance, branch names, webhook, personal username.
 *
 * The connection and the user link are on the replica. The webhook token is not, so
 * that half is a GraphQL query. Setup is a personal or project access token plus a
 * Group or Project webhook — GitLab has no App install.
 *
 * Two forms live here — the workspace connection and the viewer's own username — and they
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
import { SettingsRow } from '~/components/SettingsSection';
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

/*
 * One describe function per section, defined out here so `useSaveState` keeps a stable
 * `run` across renders. Each shows the server's own refusal where there is one — "that
 * token was rejected" beats any sentence written in advance.
 */
const describeWorkspaceFailure = (failure: unknown): string =>
  failure instanceof ApiError ? failure.message : 'Could not save GitLab settings.';
const describeCommitsFailure = (failure: unknown): string =>
  failure instanceof ApiError ? failure.message : 'Could not update commit linking.';
const describeLinkbacksFailure = (failure: unknown): string =>
  failure instanceof ApiError ? failure.message : 'Could not update linkbacks.';
const describeLoginFailure = (failure: unknown): string =>
  failure instanceof ApiError ? failure.message : 'Could not save GitLab username.';

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [instanceUrl, setInstanceUrl] = useState('https://gitlab.com');
  const [accessToken, setAccessToken] = useState('');
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
    setLoading(true);
    setLoadError(null);
    loadGitLabSettings()
      .then((data) => {
        if (!live) return;
        setWebhook(data.gitlabWebhook);
        setLoading(false);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        setLoadError(
          failure instanceof ApiError && failure.isOffline
            ? 'GitLab settings could not be fetched — this device looks offline.'
            : 'GitLab settings could not be fetched.',
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
        id: 'gitlab.connect',
        title: 'Connect GitLab',
        keys: ['n'],
        when: 'list',
        group: 'GitLab',
        enabled: () => isAdmin && connection === null && !savingWorkspace,
        run: () => {
          void onEnable();
        },
      },
    ],
    [isAdmin, connection, savingWorkspace],
  );

  const onEnable = async () => {
    const landed = await workspaceSave.run(() =>
      enableGitLabConnection({
        instanceUrl: instanceUrl.trim() === '' ? undefined : instanceUrl.trim(),
        accessToken: accessToken.trim() === '' ? undefined : accessToken.trim(),
      }),
    );
    if (!landed) return;
    setAccessToken('');
    setAttempt((n) => n + 1);
  };

  const onSaveWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    if (connection === null) return;
    const landed = await workspaceSave.run(() =>
      updateGitLabConnection({
        instanceUrl: instanceUrl.trim() === '' ? undefined : instanceUrl.trim(),
        accessToken: accessToken.trim() === '' ? undefined : accessToken.trim(),
        branchNameFormat: branchFormat,
        linkCommits: connection.linkCommits,
        linkbacks: connection.linkbacks,
      }),
    );
    // The token is write-only, so the field goes back to blank — but only once the server
    // has taken it. Clearing on a refusal would throw away what the user just typed.
    if (landed) setAccessToken('');
  };

  const onToggleCommits = async (linkCommits: boolean) => {
    if (connection === null) return;
    await commitsSave.run(() => updateGitLabConnection({ linkCommits }));
  };

  const onToggleLinkbacks = async (linkbacks: boolean) => {
    if (connection === null) return;
    await linkbacksSave.run(() => updateGitLabConnection({ linkbacks }));
  };

  const onSaveLogin = async (event: FormEvent) => {
    event.preventDefault();
    await loginSave.run(() => linkGitLabUsername(loginDraft.trim()));
  };

  const retry = () => setAttempt((n) => n + 1);

  return (
    <SettingsPage
      title="GitLab"
      description="Link a merge request or commit to an issue when the title, description or branch name contains the issue id, or a closing word such as fixes or closes. Copy git branch name from an issue with the keyboard shortcut. Magic words in comments do not create links."
      error={loadError ?? undefined}
    >
      <SettingsSection
        title="Workspace"
        status={<SaveIndicator state={workspaceSave.state} />}
        error={workspaceSave.error}
      >
        {connection === null ? (
          isAdmin ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onEnable();
              }}
            >
              <SettingsRow>
                <p className={styles.note}>
                  One GitLab instance per workspace. Admins enable it here with a personal or
                  project access token (<code>api</code> scope; <code>read_api</code> disables
                  linkbacks). GitLab has no bot accounts, so notes are posted as the token owner — a
                  dedicated user is recommended.
                </p>
              </SettingsRow>
              <SettingsRow
                label="Instance URL"
                description="gitlab.com, or a self-hosted origin with no path."
                wide
              >
                <Input
                  label="Instance URL"
                  hideLabel
                  value={instanceUrl}
                  onChange={(event) => {
                    setInstanceUrl(event.target.value);
                    workspaceSave.clear();
                  }}
                  disabled={savingWorkspace}
                />
              </SettingsRow>
              <SettingsRow
                label="Access token"
                description="Personal or project access token. Optional for inbound linking; required for linkbacks."
                wide
              >
                <Input
                  label="Access token"
                  hideLabel
                  value={accessToken}
                  onChange={(event) => {
                    setAccessToken(event.target.value);
                    workspaceSave.clear();
                  }}
                  disabled={savingWorkspace}
                  // A long-lived api-scoped credential. Not masked — the field is filled by
                  // pasting from GitLab and read back to check the paste took, which is the
                  // same argument SecretField makes — but the browser must not keep a copy
                  // of it in autofill or hand it to a spellchecker.
                  autoComplete="off"
                  spellCheck={false}
                />
              </SettingsRow>
              <SettingsRow>
                <div className={styles.actions}>
                  <Button variant="primary" disabled={savingWorkspace} type="submit">
                    Enable GitLab
                  </Button>
                </div>
              </SettingsRow>
            </form>
          ) : (
            <>
              <SettingsRow>
                <p className={styles.note}>
                  One GitLab instance per workspace. Admins enable it here with a personal or
                  project access token (<code>api</code> scope; <code>read_api</code> disables
                  linkbacks). GitLab has no bot accounts, so notes are posted as the token owner — a
                  dedicated user is recommended.
                </p>
              </SettingsRow>
              <SettingsRow>
                <p className={styles.note}>Ask an admin to enable GitLab for this workspace.</p>
              </SettingsRow>
            </>
          )
        ) : (
          <form onSubmit={(event) => void onSaveWorkspace(event)}>
            <SettingsRow label="Status">
              <Badge>{connection.enabled ? 'Enabled' : 'Disabled'}</Badge>
            </SettingsRow>
            <SettingsRow
              label="Instance URL"
              description="gitlab.com, or a self-hosted origin with no path."
              wide
            >
              <Input
                label="Instance URL"
                hideLabel
                value={instanceUrl}
                onChange={(event) => {
                  setInstanceUrl(event.target.value);
                  workspaceSave.clear();
                }}
                disabled={!isAdmin || savingWorkspace}
              />
            </SettingsRow>
            <SettingsRow
              label="Access token"
              description="Leave blank to keep the current token. Saving a new one replaces it."
              wide
            >
              <Input
                label="Access token"
                hideLabel
                value={accessToken}
                onChange={(event) => {
                  setAccessToken(event.target.value);
                  workspaceSave.clear();
                }}
                disabled={!isAdmin || savingWorkspace}
                autoComplete="off"
                spellCheck={false}
              />
            </SettingsRow>
            <SettingsRow
              label="Branch name format"
              description="Placeholders: {identifier}, {title}, {user}."
              wide
            >
              <Input
                label="Branch name format"
                hideLabel
                value={branchFormat}
                onChange={(event) => {
                  setBranchFormat(event.target.value);
                  workspaceSave.clear();
                }}
                disabled={!isAdmin || savingWorkspace}
              />
            </SettingsRow>
            {isAdmin ? (
              <SettingsRow>
                <div className={styles.actions}>
                  <Button variant="primary" disabled={savingWorkspace} type="submit">
                    Save
                  </Button>
                </div>
              </SettingsRow>
            ) : null}
          </form>
        )}
      </SettingsSection>

      {connection !== null && isAdmin ? (
        <SettingsSection title="Webhook">
          {loading ? (
            <SettingsRow>
              <Spinner label="Loading webhook details" />
            </SettingsRow>
          ) : webhook === null ? (
            <SettingsRow>
              <EmptyState
                title="Webhook details could not be loaded"
                description={
                  loadError ??
                  'The server did not return a URL and token for this connection. Nothing is broken on GitLab — this page simply has nothing to show you yet.'
                }
                action={<Button onClick={retry}>Try again</Button>}
              />
            </SettingsRow>
          ) : (
            <>
              <SettingsRow>
                <p className={styles.note}>
                  Add this URL as a Group webhook (covers every project) or a Project webhook.
                  Enable Push events, Merge request events and Pipeline events. Keep SSL
                  verification on.
                </p>
                <p className={styles.mono}>{webhook.url}</p>
              </SettingsRow>
              <SettingsRow>
                <SecretField
                  label="Webhook token"
                  value={webhook.secret}
                  consequence="Paste this into GitLab as the secret token. This page shows the token currently in force, so a later visit can read it again; if it is ever rotated, every webhook still sending the old one is rejected until each is updated."
                />
              </SettingsRow>
            </>
          )}
        </SettingsSection>
      ) : null}

      {connection !== null && isAdmin ? (
        <SettingsSection
          title="Commit linking"
          status={<SaveIndicator state={commitsSave.state} />}
          error={commitsSave.error}
        >
          <SettingsRow
            label="Link commits to issues with magic words"
            description="Requires Push events on the webhook. A magic word in the commit message links the commit; comments never do."
          >
            <Checkbox
              aria-label="Link commits to issues with magic words"
              checked={connection.linkCommits}
              disabled={commitsSave.state === 'saving'}
              onChange={(event) => void onToggleCommits(event.target.checked)}
            />
          </SettingsRow>
        </SettingsSection>
      ) : null}

      {connection !== null && isAdmin ? (
        <SettingsSection
          title="Linkbacks"
          status={<SaveIndicator state={linkbacksSave.state} />}
          error={linkbacksSave.error}
        >
          <SettingsRow
            label="Post a note on the merge request or commit when it links to an issue"
            description="Private teams get the issue URL only. Notes are posted as the token owner. Turn this off if GitLab notifications from those notes are noise."
          >
            <Checkbox
              aria-label="Post a note on the merge request or commit when it links to an issue"
              checked={connection.linkbacks}
              disabled={linkbacksSave.state === 'saving'}
              onChange={(event) => void onToggleLinkbacks(event.target.checked)}
            />
          </SettingsRow>
        </SettingsSection>
      ) : null}

      <SettingsSection
        title="Your GitLab account"
        description="Linking your username attributes merge requests to you."
        status={<SaveIndicator state={loginSave.state} />}
        error={loginSave.error}
      >
        <form onSubmit={(event) => void onSaveLogin(event)}>
          <SettingsRow
            label="GitLab username"
            description={userLink === null ? undefined : `Connected as @${userLink.gitlabUsername}`}
            wide
          >
            <Input
              label="GitLab username"
              hideLabel
              value={loginDraft}
              onChange={(event) => {
                setLoginDraft(event.target.value);
                loginSave.clear();
              }}
              disabled={savingLogin}
            />
          </SettingsRow>
          <SettingsRow>
            <div className={styles.actions}>
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
                  onClick={() => void loginSave.run(unlinkGitLabUsername)}
                >
                  Disconnect account
                </Button>
              ) : null}
            </div>
          </SettingsRow>
        </form>
      </SettingsSection>

      {connection !== null && isAdmin ? (
        <DangerZone>
          <DangerZoneRow
            title="Disconnect GitLab"
            consequence="Issues keep any merge request or commit cards already attached. New events stop linking until GitLab is enabled again."
            actionLabel="Disconnect GitLab"
            busy={disconnectBusy}
            onAction={() => setDisconnecting(true)}
          />
        </DangerZone>
      ) : null}

      <ConfirmDialog
        open={disconnecting}
        title="Disconnect GitLab?"
        consequence="Issues keep any merge request or commit cards already attached. New events stop linking until GitLab is enabled again."
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
          disconnectGitLab()
            .then(() => {
              setDisconnecting(false);
              setWebhook(null);
            })
            .catch((failure: unknown) => {
              // Inside the dialog, not in the page banner the open modal covers.
              setDisconnectError(
                failure instanceof ApiError ? failure.message : 'Could not disconnect GitLab.',
              );
            })
            .finally(() => setDisconnectBusy(false));
        }}
      />
    </SettingsPage>
  );
}
