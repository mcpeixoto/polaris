/**
 * Outbound webhooks: HTTPS URLs that receive signed change events.
 *
 * Same data path as API keys — one GraphQL query into component state, no replica, no
 * optimistic patch — because a webhook carries a signing secret that exists in the create
 * response once.
 */

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';

import { useActions, useKeyContext } from '~/app/keymap';
import { Badge, Button, Checkbox, EmptyState, Input, Modal, Spinner } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { SecretField } from '~/components/SecretField';
import {
  createWebhook,
  deleteWebhook,
  setWebhookEnabled,
  WEBHOOK_RESOURCE_TYPES,
  type CreatedWebhook,
  type WebhookSummary,
} from '~/features/webhooks/mutations';
import { WEBHOOKS_QUERY } from '~/features/webhooks/operations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';
import { ApiError, gql } from '~/sync/api';
import styles from './Webhooks.module.css';

export function Webhooks() {
  const [hooks, setHooks] = useState<readonly WebhookSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<WebhookSummary | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoadError(null);
    gql<{ webhooks: readonly WebhookSummary[] }>(WEBHOOKS_QUERY, undefined, {
      signal: controller.signal,
    })
      .then((data) => {
        if (live) setHooks(data.webhooks);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        setHooks(null);
        setLoadError(
          failure instanceof ApiError && failure.isOffline
            ? 'Webhooks could not be fetched — this device looks offline.'
            : 'Webhooks could not be fetched. Only admins can read them.',
        );
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [attempt]);

  const reload = () => setAttempt((n) => n + 1);
  const loading = hooks === null && loadError === null;

  const openCreate = useRef(() => setCreating(true));
  openCreate.current = () => {
    if (removing !== null) return;
    setCreating(true);
  };

  useKeyContext('list');
  useActions(
    [
      {
        id: 'webhook.create',
        title: 'Create a webhook',
        keys: ['n'],
        when: 'list',
        group: 'Webhooks',
        run: () => openCreate.current(),
      },
    ],
    [],
  );

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Webhooks</h1>
        <div className={styles.spacer} />
        <Button variant="primary" onClick={() => openCreate.current()}>
          New webhook
        </Button>
      </header>

      <div className={styles.body}>
        <section className={styles.intro} aria-labelledby="webhooks-about">
          <h2 className={styles.sectionTitle} id="webhooks-about">
            Push, signed
          </h2>
          <p className={styles.sectionHint}>
            Each webhook POSTs JSON to an HTTPS URL when something in this workspace changes. The
            body is signed with HMAC-SHA256 using a secret shown once. Public-team subscriptions
            never include private-team data; a team-scoped webhook will, if you point it at a
            private team.
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
            <Spinner label="Loading webhooks" />
          </div>
        ) : null}

        {hooks === null || hooks.length > 0 ? null : (
          <EmptyState
            title="No webhooks yet"
            description="A webhook is how an integration hears about issues without polling."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                New webhook
              </Button>
            }
          />
        )}

        {hooks === null || hooks.length === 0 ? null : (
          <table className={styles.table}>
            <caption className={styles.caption}>
              Outbound webhooks for this workspace. Disabled ones stay in the list.
            </caption>
            <thead>
              <tr>
                <th scope="col">URL</th>
                <th scope="col">Scope</th>
                <th scope="col">Types</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className={styles.hidden}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {hooks.map((hook) => (
                <tr key={hook.id} className={hook.enabled ? undefined : styles.revokedRow}>
                  <td className={styles.keyCell}>
                    <span className={styles.prefix}>{hook.url}</span>
                  </td>
                  <td>{hook.allPublicTeams ? 'Public teams' : 'One team'}</td>
                  <td>{hook.resourceTypes.join(', ')}</td>
                  <td>
                    <Badge tone={hook.enabled ? 'success' : 'danger'}>
                      {hook.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </td>
                  <td className={styles.actions}>
                    <Button
                      onClick={() => {
                        void setWebhookEnabled(hook.id, !hook.enabled).then(reload);
                      }}
                    >
                      {hook.enabled ? 'Disable' : 'Enable'}
                    </Button>{' '}
                    <Button onClick={() => setRemoving(hook)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating ? (
        <CreateWebhookDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title={removing ? `Delete webhook for ${removing.url}?` : 'Delete webhook?'}
        consequence="Deliveries stop immediately. The signing secret is discarded with the row; a new webhook is a new secret."
        confirmLabel="Delete webhook"
        destructive
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing === null || busy) return;
          setBusy(true);
          void deleteWebhook(removing.id)
            .then(() => {
              setRemoving(null);
              reload();
            })
            .finally(() => setBusy(false));
        }}
      />
    </div>
  );
}

function CreateWebhookDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const urlRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const teams = useLiveQuery(
    (store) => [...store.teams.values()].sort((a, b) => a.key.localeCompare(b.key)),
    ['team'],
    [],
  );

  const [url, setUrl] = useState('');
  const [allPublic, setAllPublic] = useState(true);
  const [teamId, setTeamId] = useState<UUID | ''>('');
  const [types, setTypes] = useState<readonly string[]>(['Issue']);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const [nudged, setNudged] = useState(false);

  useKeyContext('modal');

  const close = () => {
    setCreated(null);
    onClose();
  };

  const toggleType = (type: string) => {
    setTypes((current) =>
      current.includes(type) ? current.filter((held) => held !== type) : [...current, type],
    );
  };

  const save = async () => {
    if (saving || created !== null) return;
    const trimmed = url.trim();
    if (trimmed === '') {
      setFailure('A webhook needs an HTTPS URL.');
      return;
    }
    if (types.length === 0) {
      setFailure('Subscribe to at least one resource type.');
      return;
    }
    if (!allPublic && teamId === '') {
      setFailure('Pick a team, or cover all public teams.');
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      const made = await createWebhook({
        url: trimmed,
        allPublicTeams: allPublic,
        resourceTypes: types,
        ...(allPublic || teamId === '' ? {} : { teamId }),
      });
      setCreated(made);
      onCreated();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'That webhook could not be created.');
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void save();
  };

  const teamOptions = useMemo(
    () => teams.map((team) => ({ id: team.id, label: `${team.key} · ${team.name}` })),
    [teams],
  );

  return (
    <Modal
      open
      title={created ? 'Copy the signing secret' : 'New webhook'}
      description={
        created
          ? 'This is the only time the secret is shown. HMAC-SHA256 the raw body with it.'
          : 'HTTPS only. Private addresses are refused.'
      }
      initialFocus={urlRef}
      onClose={() => {
        if (created !== null) {
          setNudged(true);
          return;
        }
        close();
      }}
      footer={
        created ? (
          <Button variant="primary" onClick={close}>
            I have copied the secret
          </Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" form={formId} disabled={saving}>
              Create webhook
            </Button>
          </>
        )
      }
    >
      {created ? (
        <>
          <SecretField
            label="Signing secret"
            value={created.secret}
            consequence="It cannot be shown again. A lost secret means a new webhook."
          />
          {nudged ? (
            <p className={styles.nudge}>
              The secret is still on this screen. Copy it before leaving.
            </p>
          ) : null}
        </>
      ) : (
        <form id={formId} className={styles.form} onSubmit={onSubmit}>
          <Input
            ref={urlRef}
            label="URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/webhooks/polaris"
            autoComplete="off"
          />
          <fieldset className={styles.scopeSet}>
            <legend className={styles.legend}>Scope</legend>
            <Checkbox
              label="All public teams"
              checked={allPublic}
              onChange={(event) => setAllPublic(event.target.checked)}
            />
            {allPublic ? (
              <p className={styles.hint}>
                Private-team issues are never sent on this subscription.
              </p>
            ) : (
              <label className={styles.hint}>
                Team
                <select
                  value={teamId}
                  onChange={(event) => setTeamId(event.target.value as UUID | '')}
                >
                  <option value="">Select a team</option>
                  {teamOptions.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>
          <fieldset className={styles.scopeSet}>
            <legend className={styles.legend}>Resource types</legend>
            {WEBHOOK_RESOURCE_TYPES.map((type) => (
              <Checkbox
                key={type}
                label={type}
                checked={types.includes(type)}
                onChange={() => toggleType(type)}
              />
            ))}
          </fieldset>
          {failure ? (
            <p className={styles.error} role="alert">
              {failure}
            </p>
          ) : null}
        </form>
      )}
    </Modal>
  );
}
