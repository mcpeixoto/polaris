/**
 * Personal API keys: the credentials this account authenticates a script with.
 *
 * ## Why this screen is built unlike every other one
 *
 * Everything else in the product renders from the local replica. A view subscribes to the
 * store, the sync stream keeps the store current, and a write is drawn optimistically long
 * before the server has answered — which is the whole reason `useLiveQuery` and
 * `engine.mutate` exist and why a keystroke here feels instant.
 *
 * None of that happens here, because there is no `apiKey` entity in the store to subscribe
 * to. Keys are read on one settings screen, rarely, and replicating them would put a
 * credential's metadata in every device's IndexedDB for no gain — the decision is recorded in
 * docs/07-milestones/01-milestone-1.md and beside `EntityByType` in store/types, and the
 * server keeps its half of it by emitting nothing to the change log when a key is made.
 *
 * So the data path is the plainest in the client: one GraphQL query into component state, and
 * the same query again after a write. There is deliberately no optimistic patch. A created
 * key's identity — its id, its prefix, the scopes the server expanded — is not something the
 * client can guess, and a revoke drawn optimistically would tell somebody a credential had
 * stopped working a moment before it actually had, which is the one lie a security screen
 * must not tell.
 *
 * ## The token
 *
 * It is rendered in exactly one place: the SecretField in the dialog that has just minted it.
 * Nothing here logs it, stores it, puts it in a route or keeps it after that dialog closes,
 * and the listing has no column that could hold one — `ApiKey` carries no token field on the
 * wire at all. The server stores only a SHA-256, so that panel is not merely the best look
 * the user gets at their key, it is the only one that will ever exist. Everything about how
 * that dialog behaves follows from this paragraph.
 */

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';

import { useActions, useKeyContext } from '~/app/keymap';
import { Badge, Button, Checkbox, EmptyState, Input, Modal, Spinner, Tooltip } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
// Not from the barrel: SecretField is new in this milestone and the barrel is edited in a
// separate pass. See the note accompanying these screens.
import { SecretField } from '~/components/SecretField';
import {
  apiKeyStatus,
  API_KEY_SCOPES,
  createApiKey,
  revocationConsequence,
  revokeApiKey,
  type ApiKeyScope,
  type ApiKeyStatus,
  type ApiKeySummary,
  type CreatedApiKey,
} from '~/features/apikeys/mutations';
import { API_KEYS_QUERY } from '~/features/apikeys/operations';
import { exact, when } from '~/features/time';
import type { UUID } from '~/store';
import { ApiError, gql } from '~/sync/api';
import styles from './ApiKeys.module.css';

/** Where each status sits in the table. Revoked keys sink; they are history, not options. */
const STATUS_RANK: Readonly<Record<ApiKeyStatus, number>> = { active: 0, expired: 1, revoked: 2 };

const STATUS_TONE = { active: 'success', expired: 'warning', revoked: 'danger' } as const;

const STATUS_LABEL: Readonly<Record<ApiKeyStatus, string>> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
};

export function ApiKeys() {
  /** Null until the query answers, and null again if it fails: absent, not empty. */
  const [keys, setKeys] = useState<readonly ApiKeySummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Bumped to re-run the fetch. The retry button and every write both go through it. */
  const [attempt, setAttempt] = useState(0);

  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<UUID | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoadError(null);

    gql<{ apiKeys: readonly ApiKeySummary[] }>(API_KEYS_QUERY, undefined, {
      signal: controller.signal,
    })
      .then((data) => {
        if (live) setKeys(data.apiKeys);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        // Cleared rather than left stale. A list of keys is read to decide what to revoke, and
        // showing yesterday's answer beside "could not be refreshed" invites somebody to act
        // on a row that may no longer exist.
        setKeys(null);
        setLoadError(
          failure instanceof ApiError && failure.isOffline
            ? 'Your keys could not be fetched — this device looks offline. They are not kept on it, so there is nothing to show until the connection is back.'
            : 'Your keys could not be fetched.',
        );
      });

    return () => {
      live = false;
      // Aborted rather than merely ignored, so leaving the screen mid-request does not hold a
      // socket open. The rejection it causes lands in the catch above with `live` already
      // false, which is why that branch checks before touching state.
      controller.abort();
    };
  }, [attempt]);

  const reload = () => setAttempt((n) => n + 1);

  const rows = useMemo(() => {
    if (keys === null) return [];
    return [...keys]
      .map((key) => ({ key, status: apiKeyStatus(key) }))
      .sort(
        (a, b) =>
          STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
          // RFC 3339 sorts lexically, so newest-first needs no parsing. A key made this
          // morning is the one somebody is looking for; a key made in 2024 is the one they
          // are trying to remember the purpose of.
          b.key.createdAt.localeCompare(a.key.createdAt),
      );
  }, [keys]);

  const target = revoking === null ? null : (keys?.find((key) => key.id === revoking) ?? null);

  /**
   * Read through a ref by the registered action below. An action's `run` closure is captured
   * once at registration, so calling `setCreating` through a fresh closure each render would
   * mean the shortcut toggling a boolean nobody is reading any more.
   */
  const openCreate = useRef<() => void>(() => {});
  openCreate.current = () => {
    // A second dialog on top of a confirmation is two irreversible decisions stacked on one
    // another, and the one underneath is the one that gets pressed by accident.
    if (revoking !== null) return;
    setCreating(true);
  };

  useKeyContext('list');

  useActions(
    [
      {
        id: 'apiKey.create',
        title: 'Create an API key',
        keys: ['n'],
        when: 'list',
        group: 'API keys',
        run: () => openCreate.current(),
      },
    ],
    [],
  );

  const askRevoke = (key: ApiKeySummary) => {
    setRevokeError(null);
    setRevoking(key.id);
  };

  const confirmRevoke = async () => {
    if (revoking === null || busy) return;
    setBusy(true);
    setRevokeError(null);
    try {
      await revokeApiKey(revoking);
      setRevoking(null);
      // The row does not disappear, it comes back marked revoked — which is why this is a
      // refetch and not a splice out of local state.
      reload();
    } catch (failure) {
      setRevokeError(
        failure instanceof ApiError ? failure.message : 'That key could not be revoked.',
      );
    } finally {
      setBusy(false);
    }
  };

  const loading = keys === null && loadError === null;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>API keys</h1>
        {keys === null ? null : (
          <Badge>{keys.length === 1 ? '1 key' : `${keys.length} keys`}</Badge>
        )}
        <div className={styles.spacer} />
        <Tooltip label="Create an API key" keys="n">
          <Button variant="primary" onClick={() => setCreating(true)}>
            New key
          </Button>
        </Tooltip>
      </header>

      <div className={styles.body}>
        <section className={styles.intro} aria-labelledby="apikeys-about">
          <h2 className={styles.sectionTitle} id="apikeys-about">
            What a key can do
          </h2>
          <p className={styles.sectionHint}>
            A key acts as you and never as more than you: everything you can do, unless you narrow
            it when you make it. It belongs to no device and no session, and it keeps working until
            it expires or you revoke it. Nobody else can see these — not your admins, not us — and
            no screen can show a token twice.
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
            <Spinner label="Loading your API keys" />
          </div>
        ) : null}

        {keys === null || keys.length > 0 ? null : (
          <EmptyState
            title="No API keys yet"
            description="Keys are for the things that act on your behalf without you there — a deploy script, a CI job, an integration you wrote."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Create a key
              </Button>
            }
          />
        )}

        {rows.length === 0 ? null : (
          <table className={styles.table}>
            <caption className={styles.caption}>
              The keys on your own account. Revoked and expired ones stay in the list, at the
              bottom, so that a key which stopped working can still be accounted for.
            </caption>
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Scopes</th>
                <th scope="col">Created</th>
                <th scope="col">Last used</th>
                <th scope="col">Expires</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className={styles.hidden}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, status }) => (
                <KeyRow key={key.id} apiKey={key} status={status} onRevoke={() => askRevoke(key)} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating ? (
        <CreateKeyDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            // The new row has a server-minted prefix and an expanded scope set, neither of
            // which this screen could have drawn for itself. Asking again is cheaper than
            // guessing wrong about a credential.
            reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={target !== null}
        title={target === null ? '' : `Revoke ${target.name}?`}
        consequence={target === null ? '' : revocationConsequence(target)}
        confirmLabel="Revoke this key"
        destructive
        busy={busy}
        error={revokeError ?? undefined}
        onConfirm={() => void confirmRevoke()}
        onClose={() => setRevoking(null)}
      />
    </div>
  );
}

interface KeyRowProps {
  apiKey: ApiKeySummary;
  status: ApiKeyStatus;
  onRevoke: () => void;
}

function KeyRow({ apiKey, status, onRevoke }: KeyRowProps) {
  return (
    <tr className={status === 'revoked' ? styles.revokedRow : undefined}>
      <th scope="row" className={styles.keyCell}>
        <span className={styles.identity}>
          <span className={styles.name}>{apiKey.name}</span>
          {/* The prefix, and only ever the prefix. It is what matches this row against a key
              pasted into a CI configuration; the rest of the token is not ours to show. */}
          <code className={styles.prefix}>{apiKey.prefix}…</code>
        </span>
      </th>

      <td>
        {apiKey.scopes.length === 0 ? (
          <span className={styles.unscoped}>Everything you can do</span>
        ) : (
          <span className={styles.scopes}>
            {apiKey.scopes.map((scope) => (
              <Badge key={scope}>{scope}</Badge>
            ))}
          </span>
        )}
      </td>

      <td title={exact(apiKey.createdAt)}>{when(apiKey.createdAt)}</td>

      {/* "Never" rather than an empty cell. A blank here is indistinguishable from a column
          that failed to load, and this is the one fact somebody reads before deciding a key
          is safe to revoke. */}
      <td className={apiKey.lastUsedAt === null ? styles.never : undefined}>
        {apiKey.lastUsedAt === null ? (
          'Never'
        ) : (
          <span title={exact(apiKey.lastUsedAt)}>{when(apiKey.lastUsedAt)}</span>
        )}
      </td>

      <td className={apiKey.expiresAt === null ? styles.never : undefined}>
        {apiKey.expiresAt === null ? (
          'Does not expire'
        ) : (
          <span title={exact(apiKey.expiresAt)}>{when(apiKey.expiresAt)}</span>
        )}
      </td>

      <td>
        <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
      </td>

      <td className={styles.actions}>
        {status === 'revoked' ? null : (
          <Button
            size="sm"
            variant="danger"
            // Named per row, because a table of six buttons all called "Revoke" is a table a
            // screen-reader user cannot act on without counting.
            aria-label={`Revoke ${apiKey.name}`}
            onClick={onRevoke}
          >
            Revoke
          </Button>
        )}
      </td>
    </tr>
  );
}

interface CreateKeyDialogProps {
  onClose: () => void;
  /** Called once the key exists, so the listing behind can re-read itself. */
  onCreated: () => void;
}

/**
 * Making a key, and then showing its token.
 *
 * Two states that are not two steps of one form — the second is the whole reason the first
 * exists. Everything about it follows from the token being unrecoverable: it is rendered into
 * a field the user copies from rather than a sentence they have to select by hand, the
 * consequence is stated in the field rather than in small print, and the dialog does not
 * dismiss itself or accept a dismissal it was not clearly asked for.
 *
 * That last part is why `onClose` does not close while a token is on screen. Escape, a click
 * on the backdrop and the header's cross are all gestures people make without reading, and
 * this is the one dialog in the product where not reading costs a credential. They are
 * answered with a line explaining that the token is still here, and the only way out is the
 * footer button, which says what pressing it means.
 */
function CreateKeyDialog({ onClose, onCreated }: CreateKeyDialogProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const formId = useId();

  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<readonly ApiKeyScope[]>([]);
  const [expiry, setExpiry] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [expiryError, setExpiryError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nudged, setNudged] = useState(false);
  /**
   * The created key and its token, held only while this dialog is mounted, and in state
   * rather than a ref because it is what the dialog renders. It is never lifted to the
   * screen above, never written anywhere durable, and never logged.
   */
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  // Everything the dialog covers belongs to the dialog: `N` must not open a second one.
  useKeyContext('modal');

  const close = () => {
    // Cleared here as well as by the unmount. Relying on the unmount alone would make the
    // token's lifetime a fact about how the parent happens to render this component today.
    setCreated(null);
    onClose();
  };

  const toggleScope = (scope: ApiKeyScope) => {
    setScopes((current) =>
      current.includes(scope) ? current.filter((held) => held !== scope) : [...current, scope],
    );
  };

  const save = async () => {
    if (saving || created !== null) return;

    const trimmed = name.trim();
    if (trimmed === '') {
      // The server refuses this too. Saying it here means the answer arrives instead of the
      // request rather than after it.
      setNameError(
        'A key needs a name — this is the list you will be reading in a year deciding what to revoke.',
      );
      nameRef.current?.focus();
      return;
    }

    let expiresAt: string | undefined;
    if (expiry !== '') {
      const instant = endOfDay(expiry);
      if (instant === null) {
        setExpiryError('That is not a date this can read. Use the picker, or leave it empty.');
        return;
      }
      if (Date.parse(instant) <= Date.now()) {
        setExpiryError(
          'An expiry has to be in the future. A key born expired authenticates nothing and looks perfectly fine in the list.',
        );
        return;
      }
      expiresAt = instant;
    }

    setSaving(true);
    setNameError(null);
    setExpiryError(null);
    setFailure(null);
    try {
      const key = await createApiKey({ name: trimmed, scopes, expiresAt });
      setCreated(key);
      onCreated();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : 'That key could not be created.');
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save();
  };

  if (created !== null) {
    return (
      <Modal
        open
        // Deliberately not `close`. See the note on this component: while the token is on
        // screen the incidental dismissals are answered rather than obeyed.
        onClose={() => setNudged(true)}
        title={`${created.key.name} is ready`}
        description="This is the only time the token will ever be shown. Copy it now — the server keeps nothing but a hash of it, so nobody, including us, can show it again."
        size="md"
        footer={
          <Button variant="primary" onClick={close}>
            I have saved it — close
          </Button>
        }
      >
        <SecretField
          label={`Token for ${created.key.name}`}
          value={created.token}
          consequence="Copy it into wherever it is going before you close this. If you lose it, the only way forward is to revoke this key and make another."
        />
        {nudged ? (
          <p className={styles.nudge} role="status">
            Nothing is lost yet — the token is still above. Copy it, then use the button below; that
            is the only way out of this dialog, because this is the only moment the token exists.
          </p>
        ) : null}
        <p className={styles.detail}>
          It authenticates as you, with{' '}
          {created.key.scopes.length === 0
            ? 'everything you can do'
            : `the ${created.key.scopes.join(' and ')} scopes`}
          , and it will appear in the list as{' '}
          <code className={styles.prefix}>{created.key.prefix}…</code> — which is all this screen
          will ever know about it.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={close}
      title="New API key"
      description="You will see the token once, on the next screen."
      size="md"
      initialFocus={nameRef}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          {/* Associated with the form by id rather than nested in it, so that Enter in the
              name field submits the dialog the way Enter submits every other form. */}
          <Button type="submit" form={formId} variant="primary" loading={saving}>
            Create key
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={onSubmit}>
        <Input
          ref={nameRef}
          label="Name"
          value={name}
          error={nameError ?? undefined}
          hint="What is holding it, not what it does: “CI — deploy bot (staging)”."
          placeholder="CI — deploy bot"
          autoComplete="off"
          onChange={(event) => {
            setName(event.target.value);
            if (nameError !== null) setNameError(null);
          }}
        />

        <fieldset className={styles.scopeSet}>
          <legend className={styles.legend}>Scopes</legend>
          <p className={styles.hint}>
            Optional, and narrowing only — a scope can never grant a key something you cannot do
            yourself. Leave them all unchecked and the key can do everything you can, which is the
            right answer for a key you are about to hand to a script you wrote and the wrong one for
            a key you are pasting into somebody else's tool.
          </p>
          {API_KEY_SCOPES.map((scope) => (
            <Checkbox
              key={scope.value}
              label={
                <>
                  {scope.label} <span className={styles.scopeDetail}>— {scope.detail}</span>
                </>
              }
              checked={scopes.includes(scope.value)}
              onChange={() => toggleScope(scope.value)}
            />
          ))}
        </fieldset>

        <Input
          label="Expires"
          type="date"
          value={expiry}
          error={expiryError ?? undefined}
          hint="Optional. Empty means the key never expires, which is right for an unattended integration and a slow leak for anything else."
          onChange={(event) => {
            setExpiry(event.target.value);
            if (expiryError !== null) setExpiryError(null);
          }}
        />

        {failure === null ? null : (
          <p className={styles.error} role="alert">
            {failure}
          </p>
        )}
      </form>
    </Modal>
  );
}

/**
 * The end of the given calendar day, as an instant, or null if it will not parse.
 *
 * A date input yields a day and the API wants a moment, and the end of that day in the
 * reader's own zone is the only reading that matches what they typed: somebody who says a key
 * expires on the 30th means it should still work at six in the evening on the 30th, not that
 * it died at midnight as the 30th began.
 */
function endOfDay(day: string): string | null {
  // No trailing Z: a date-time without one is parsed as local time, which is the point.
  const at = new Date(`${day}T23:59:59`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}
