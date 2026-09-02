/**
 * OAuth applications this workspace owns: client id, redirect URIs, scopes.
 *
 * Same data path as API keys — one GraphQL query into component state, no replica, no
 * optimistic patch — because a client secret exists in the create/rotate response once.
 */

import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';

import { useActions, useKeyContext } from '~/app/keymap';
import { Badge, Button, Checkbox, EmptyState, Input, Modal, Spinner, Textarea } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { SecretField } from '~/components/SecretField';
import {
  createOauthClient,
  deleteOauthClient,
  OAUTH_SCOPES,
  parseRedirectUris,
  rotateOauthClientSecret,
  updateOauthClient,
  type CreatedOauthClient,
  type OauthClientSummary,
  type OauthScope,
} from '~/features/oauth/mutations';
import { OAUTH_CLIENTS_QUERY } from '~/features/oauth/operations';
import { ApiError, gql } from '~/sync/api';
import styles from './OAuthApps.module.css';

export function OAuthApps() {
  const [apps, setApps] = useState<readonly OauthClientSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<OauthClientSummary | null>(null);
  const [removing, setRemoving] = useState<OauthClientSummary | null>(null);
  const [busy, setBusy] = useState(false);
  // The refusal belongs inside the dialog that asked, not in the page banner underneath it.
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoadError(null);
    gql<{ oauthClients: readonly OauthClientSummary[] }>(OAUTH_CLIENTS_QUERY, undefined, {
      signal: controller.signal,
    })
      .then((data) => {
        if (live) setApps(data.oauthClients);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        setApps(null);
        setLoadError(
          failure instanceof ApiError && failure.isOffline
            ? 'OAuth applications could not be fetched — this device looks offline.'
            : 'OAuth applications could not be fetched. Only admins can read them.',
        );
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [attempt]);

  const reload = () => setAttempt((n) => n + 1);
  const loading = apps === null && loadError === null;

  const openCreate = useRef(() => setCreating(true));
  openCreate.current = () => {
    if (removing !== null || editing !== null) return;
    setCreating(true);
  };

  useKeyContext('list');
  useActions(
    [
      {
        id: 'oauthApp.create',
        title: 'Create an OAuth application',
        keys: ['n'],
        when: 'list',
        group: 'OAuth apps',
        run: () => openCreate.current(),
      },
    ],
    [],
  );

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>OAuth apps</h1>
        {apps === null ? null : (
          <Badge>{apps.length === 1 ? '1 app' : `${apps.length} apps`}</Badge>
        )}
        <div className={styles.spacer} />
        <Button variant="primary" onClick={() => openCreate.current()}>
          New OAuth app
        </Button>
      </header>

      <div className={styles.body}>
        <section className={styles.intro} aria-labelledby="oauth-about">
          <h2 className={styles.sectionTitle} id="oauth-about">
            Third-party access
          </h2>
          <p className={styles.sectionHint}>
            An application you create here can ask members of this workspace — or, if you mark it
            public, of any workspace — to authorize it. The client secret is shown once. Give the
            app its own workspace if more than one admin should manage it.
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
            <Spinner label="Loading OAuth applications" />
          </div>
        ) : null}

        {apps === null || apps.length > 0 ? null : (
          <EmptyState
            title="No OAuth applications yet"
            description="Create one to let a third-party integration sign in as a user or as an app actor, with the scopes you allow."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Create an OAuth app
              </Button>
            }
          />
        )}

        {apps === null || apps.length === 0 ? null : (
          <table className={styles.table}>
            <caption className={styles.caption}>
              Applications owned by this workspace. The client secret is never in this list.
            </caption>
            <thead>
              <tr>
                <th scope="col">Application</th>
                <th scope="col">Scopes</th>
                <th scope="col">Redirect URIs</th>
                <th scope="col">
                  <span className={styles.hidden}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <AppRow
                  key={app.id}
                  app={app}
                  onEdit={() => setEditing(app)}
                  onDelete={() => setRemoving(app)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating ? (
        <CreateAppDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            reload();
          }}
        />
      ) : null}

      {editing ? (
        <EditAppDialog
          app={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title={removing ? `Delete ${removing.name}?` : 'Delete application?'}
        consequence="Existing tokens stop working immediately. The client secret is discarded with the row."
        confirmLabel="Delete application"
        destructive
        busy={busy}
        error={removeError ?? undefined}
        onClose={() => {
          setRemoving(null);
          setRemoveError(null);
        }}
        onConfirm={() => {
          if (removing === null || busy) return;
          setBusy(true);
          setRemoveError(null);
          deleteOauthClient(removing.id)
            .then(() => {
              setRemoving(null);
              reload();
            })
            .catch((failure: unknown) => {
              setRemoveError(
                failure instanceof ApiError
                  ? failure.message
                  : 'That application could not be deleted.',
              );
            })
            .finally(() => setBusy(false));
        }}
      />
    </div>
  );
}

function AppRow({
  app,
  onEdit,
  onDelete,
}: {
  app: OauthClientSummary;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <tr>
      <th scope="row" className={styles.keyCell}>
        <span className={styles.identity}>
          <span className={styles.name}>{app.name}</span>
          <code className={styles.prefix}>{app.clientId}</code>
        </span>
      </th>
      <td>
        <span className={styles.scopes}>
          {app.allowedScopes.map((scope) => (
            <Badge key={scope}>{scope}</Badge>
          ))}
        </span>
      </td>
      <td>{app.redirectUris.length}</td>
      <td className={styles.actions}>
        <span className={styles.rowActions}>
          <Button size="sm" onClick={onEdit} aria-label={`Edit ${app.name}`}>
            Edit
          </Button>
          <Button size="sm" variant="danger" onClick={onDelete} aria-label={`Delete ${app.name}`}>
            Delete
          </Button>
        </span>
      </td>
    </tr>
  );
}

function CreateAppDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const nameRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const [name, setName] = useState('');
  const [redirects, setRedirects] = useState('http://localhost:3000/callback');
  const [scopes, setScopes] = useState<readonly OauthScope[]>(['read', 'write']);
  const [developer, setDeveloper] = useState('');
  const [publicEnabled, setPublicEnabled] = useState(false);
  const [clientCredentials, setClientCredentials] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CreatedOauthClient | null>(null);
  const [nudged, setNudged] = useState(false);

  useKeyContext('modal');

  const close = () => {
    setCreated(null);
    onClose();
  };

  const toggleScope = (scope: OauthScope) => {
    if (scope === 'read') return;
    setScopes((current) =>
      current.includes(scope) ? current.filter((held) => held !== scope) : [...current, scope],
    );
  };

  const save = async () => {
    if (saving || created !== null) return;
    const trimmed = name.trim();
    const uris = parseRedirectUris(redirects);
    if (trimmed === '') {
      setFailure('An application needs a name.');
      nameRef.current?.focus();
      return;
    }
    if (uris.length === 0) {
      setFailure('At least one redirect URI is required.');
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      const made = await createOauthClient({
        name: trimmed,
        redirectUris: uris,
        allowedScopes: scopes,
        ...(developer.trim() === '' ? {} : { developer: developer.trim() }),
        publicEnabled,
        clientCredentialsEnabled: clientCredentials,
      });
      setCreated(made);
      onCreated();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'That application could not be created.');
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void save();
  };

  if (created !== null) {
    return (
      <Modal
        open
        onClose={() => setNudged(true)}
        title={`${created.oauthClient.name} is ready`}
        description="This is the only time the client secret will ever be shown. Copy both values into the integration now."
        size="md"
        footer={
          <Button variant="primary" onClick={close}>
            I have saved it — close
          </Button>
        }
      >
        <SecretField
          label="Client ID"
          value={created.oauthClient.clientId}
          consequence="Public identifier. Third parties put this on the authorize URL."
        />
        <SecretField
          label="Client secret"
          value={created.clientSecret}
          consequence="Copy it now. The server keeps only a hash, so nobody can show it again."
        />
        {nudged ? (
          <p className={styles.nudge} role="status">
            Nothing is lost yet — the secret is still above. Copy it, then use the button below.
          </p>
        ) : null}
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={close}
      title="New OAuth application"
      description="You will see the client secret once, on the next screen."
      size="lg"
      initialFocus={nameRef}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={saving}>
            Create application
          </Button>
        </>
      }
    >
      <AppForm
        formId={formId}
        nameRef={nameRef}
        name={name}
        redirects={redirects}
        scopes={scopes}
        developer={developer}
        publicEnabled={publicEnabled}
        clientCredentials={clientCredentials}
        failure={failure}
        onSubmit={onSubmit}
        onName={setName}
        onRedirects={setRedirects}
        onToggleScope={toggleScope}
        onDeveloper={setDeveloper}
        onPublic={setPublicEnabled}
        onClientCredentials={setClientCredentials}
      />
    </Modal>
  );
}

function EditAppDialog({
  app,
  onClose,
  onSaved,
}: {
  app: OauthClientSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const [name, setName] = useState(app.name);
  const [redirects, setRedirects] = useState(app.redirectUris.join('\n'));
  const [scopes, setScopes] = useState<readonly OauthScope[]>(app.allowedScopes as OauthScope[]);
  const [developer, setDeveloper] = useState(app.developer ?? '');
  const [publicEnabled, setPublicEnabled] = useState(app.publicEnabled);
  const [clientCredentials, setClientCredentials] = useState(app.clientCredentialsEnabled);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rotated, setRotated] = useState<string | null>(null);
  const [nudged, setNudged] = useState(false);

  useKeyContext('modal');

  const toggleScope = (scope: OauthScope) => {
    if (scope === 'read') return;
    setScopes((current) =>
      current.includes(scope) ? current.filter((held) => held !== scope) : [...current, scope],
    );
  };

  const save = async () => {
    if (saving) return;
    const uris = parseRedirectUris(redirects);
    if (name.trim() === '' || uris.length === 0) {
      setFailure('A name and at least one redirect URI are required.');
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      await updateOauthClient({
        id: app.id,
        name: name.trim(),
        redirectUris: uris,
        allowedScopes: scopes,
        developer: developer.trim() === '' ? undefined : developer.trim(),
        publicEnabled,
        clientCredentialsEnabled: clientCredentials,
      });
      onSaved();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'That application could not be updated.');
    } finally {
      setSaving(false);
    }
  };

  const rotate = async () => {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    try {
      const next = await rotateOauthClientSecret(app.id);
      setRotated(next.clientSecret);
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'The secret could not be rotated.');
    } finally {
      setSaving(false);
    }
  };

  if (rotated !== null) {
    return (
      <Modal
        open
        onClose={() => setNudged(true)}
        title="Copy the new client secret"
        description="Previous client-credentials tokens are revoked. This secret cannot be shown again."
        footer={
          <Button variant="primary" onClick={onSaved}>
            I have saved it — close
          </Button>
        }
      >
        <SecretField
          label="Client secret"
          value={rotated}
          consequence="Integrations must be updated with this value. The old secret no longer works."
        />
        {nudged ? (
          <p className={styles.nudge} role="status">
            The secret is still above. Copy it, then use the button below.
          </p>
        ) : null}
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${app.name}`}
      description={`Client ID ${app.clientId}`}
      size="lg"
      initialFocus={nameRef}
      footer={
        <>
          <Button onClick={() => void rotate()} disabled={saving}>
            Rotate secret
          </Button>
          <div className={styles.spacer} />
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <AppForm
        formId={formId}
        nameRef={nameRef}
        name={name}
        redirects={redirects}
        scopes={scopes}
        developer={developer}
        publicEnabled={publicEnabled}
        clientCredentials={clientCredentials}
        failure={failure}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        onName={setName}
        onRedirects={setRedirects}
        onToggleScope={toggleScope}
        onDeveloper={setDeveloper}
        onPublic={setPublicEnabled}
        onClientCredentials={setClientCredentials}
      />
    </Modal>
  );
}

function AppForm({
  formId,
  nameRef,
  name,
  redirects,
  scopes,
  developer,
  publicEnabled,
  clientCredentials,
  failure,
  onSubmit,
  onName,
  onRedirects,
  onToggleScope,
  onDeveloper,
  onPublic,
  onClientCredentials,
}: {
  formId: string;
  nameRef: RefObject<HTMLInputElement | null>;
  name: string;
  redirects: string;
  scopes: readonly OauthScope[];
  developer: string;
  publicEnabled: boolean;
  clientCredentials: boolean;
  failure: string | null;
  onSubmit: (event: FormEvent) => void;
  onName: (value: string) => void;
  onRedirects: (value: string) => void;
  onToggleScope: (scope: OauthScope) => void;
  onDeveloper: (value: string) => void;
  onPublic: (value: boolean) => void;
  onClientCredentials: (value: boolean) => void;
}) {
  return (
    <form id={formId} className={styles.form} onSubmit={onSubmit}>
      {failure === null ? null : (
        <p className={styles.error} role="alert">
          {failure}
        </p>
      )}
      <Input
        ref={nameRef}
        label="Name"
        value={name}
        hint="Shown on the consent screen."
        autoComplete="off"
        onChange={(event) => onName(event.target.value)}
      />
      <Input
        label="Developer"
        value={developer}
        hint="Optional. Who built this application."
        autoComplete="off"
        onChange={(event) => onDeveloper(event.target.value)}
      />
      <Textarea
        label="Callback URLs"
        value={redirects}
        hint="One absolute http(s) URL per line. http is only allowed for localhost."
        minRows={3}
        onChange={(event) => onRedirects(event.target.value)}
      />
      <fieldset className={styles.scopeSet}>
        <legend className={styles.legend}>Scopes this application may request</legend>
        {OAUTH_SCOPES.map((scope) => (
          <Checkbox
            key={scope.value}
            label={
              <>
                {scope.label}
                <span className={styles.scopeDetail}> — {scope.detail}</span>
              </>
            }
            checked={scopes.includes(scope.value)}
            disabled={scope.value === 'read'}
            onChange={() => onToggleScope(scope.value)}
          />
        ))}
      </fieldset>
      <Checkbox
        label="Public — other workspaces may authorize this application"
        checked={publicEnabled}
        onChange={(event) => onPublic(event.target.checked)}
      />
      <Checkbox
        label="Enable client credentials (server-to-server, app actor)"
        checked={clientCredentials}
        onChange={(event) => onClientCredentials(event.target.checked)}
      />
    </form>
  );
}
