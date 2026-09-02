/**
 * Workspace Asks: shareable forms and Slack intake that land in a team's triage.
 *
 * SAML-gated web forms stay out. Slack Asks reuses the workspace Slack install.
 *
 * A form's link is the credential — `AskFormPage` works signed out, and the token in the URL
 * is the whole of the authorisation. That is why deleting one is confirmed the way revoking
 * an API key is, and why the link is shown in full beside a copy button rather than hidden
 * behind one — it is the thing people read out, screenshot and paste.
 */

import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { useEngine } from '~/app/context';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Input,
  Select,
  SettingsPage,
  SettingsSection,
  Textarea,
} from '~/components';
import { createAskForm, deleteAskForm } from '~/features/asks/mutations';
import { report } from '~/features/issue/mutations';
import { setSlackAsksEnabled } from '~/features/slack/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import type { AskForm, Store } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './AskSettings.module.css';

export function AskSettings() {
  const engine = useEngine();
  const viewer = useViewer();
  const isAdmin = viewer !== null && (viewer.role === 'owner' || viewer.role === 'admin');
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deleting, setDeleting] = useState<AskForm | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const teams = useLiveQuery(
    (store: Store) => {
      return [...store.teams.values()]
        .filter((team) => team.archivedAt === undefined && team.retiredAt === undefined)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    ['team'],
  );

  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');

  const forms = useLiveQuery(
    (store: Store) => {
      return [...store.askForms.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    ['askForm'],
  );

  const slack = useLiveQuery(
    (store: Store) => [...store.slackConnections.values()][0] ?? null,
    ['slackConnection'],
  );

  const fail = (failure: unknown) => {
    setError(failure instanceof ApiError ? failure.message : 'That change could not be saved.');
    report(failure);
  };

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    const dest = teamId === '' ? teams[0]?.id : teamId;
    if (trimmed === '' || dest === undefined) return;
    setError(null);
    createAskForm(engine, {
      teamId: dest,
      name: trimmed,
      description: description.trim(),
    })
      .then(() => {
        setName('');
        setDescription('');
      })
      .catch(fail);
  };

  const confirmDelete = async () => {
    if (deleting === null || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAskForm(engine, deleting.id);
      setDeleting(null);
    } catch (failure) {
      setDeleteError(
        failure instanceof ApiError ? failure.message : 'That form could not be deleted.',
      );
      report(failure);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <SettingsPage title="Asks" error={error ?? undefined}>
      <SettingsSection title="Slack">
        {slack === null ? (
          <p className={styles.hint}>
            Connect Slack in <Link to="/settings/slack">Settings → Slack</Link>, then come back here
            to file triage issues from <code>/asks</code> or a message that starts with 🎫.
          </p>
        ) : (
          <>
            <p className={styles.hint}>
              People without a Polaris account can file an Ask with <code>/asks Title</code> or by
              starting a Slack message with 🎫. Issues land on the Slack connection&apos;s default
              team, in triage when that team runs it.
            </p>
            <Checkbox
              label="Create Asks from Slack"
              checked={slack.asksEnabled}
              disabled={!isAdmin || !slack.enabled}
              onChange={(event) => {
                setError(null);
                setSlackAsksEnabled(engine, event.target.checked).catch(fail);
              }}
            />
          </>
        )}
      </SettingsSection>

      <SettingsSection
        title="Forms"
        description="Share a link. Anyone who opens it can file an issue into that team's triage — they do not need a Polaris account."
        flush
      >
        <form className={styles.create} onSubmit={onCreate}>
          <Input
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <Select
            label="Team"
            value={teamId === '' ? (teams[0]?.id ?? '') : teamId}
            onChange={(event) => setTeamId(event.target.value)}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
          <Textarea
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <Button type="submit" disabled={teams.length === 0}>
            Create form
          </Button>
        </form>

        {forms.length === 0 ? (
          <EmptyState
            title="No intake forms"
            description="Create a form, copy its link, and send it to people who are not in this workspace."
          />
        ) : (
          <ul className={styles.forms}>
            {forms.map((form) => {
              const team = teams.find((row) => row.id === form.teamId);
              return (
                <li key={form.id} className={styles.form}>
                  <div className={styles.formHead}>
                    <strong className={styles.formName}>{form.name}</strong>
                    <span className={styles.formTeam}>{team?.name ?? 'Team'}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      // Named per row: a list of controls that reads "Delete, Delete, Delete"
                      // is a list nobody can act on, and each of these destroys a URL that is
                      // already in strangers' inboxes.
                      aria-label={`Delete ${form.name}`}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(form);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                  {form.token === '' ? (
                    <p className={styles.hint}>
                      This form has no link yet. It appears once the server has minted its token.
                    </p>
                  ) : (
                    <AskLink name={form.name} url={`${window.location.origin}/ask/${form.token}`} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={deleting !== null}
        title={deleting === null ? '' : `Delete ${deleting.name}?`}
        consequence="Its link stops working immediately, and the link is public — anybody still holding it, in an inbox or a wiki or a Slack thread, gets a dead form with no way to reach you. Issues already filed through it stay exactly where they are."
        confirmLabel="Delete this form"
        destructive
        busy={deleteBusy}
        error={deleteError ?? undefined}
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          if (deleteBusy) return;
          setDeleting(null);
          setDeleteError(null);
        }}
      />
    </SettingsPage>
  );
}

/**
 * One form's public link, and the three things a hand-rolled copy button keeps getting wrong.
 *
 * The shape is `components/SecretField`'s, which is the right one and is not reused directly
 * only because every control on this page needs to name its own row. The URL is real text
 * rather than an input value, because the link is the one thing on this row somebody reads
 * out, screenshots or copies out of the page — and a value that only exists as a form
 * control's `value` is invisible to selection, to find-in-page and to anything reading the
 * document. It is still focusable and still selects itself on focus, so ⌘C works without a
 * mouse. A copy that fails — no `navigator.clipboard`, or an insecure origin — leaves the
 * text selected so the platform's own copy is one keystroke away, rather than the button
 * doing nothing at all. The
 * outcome goes in a live region rather than into the button's label, so the button is still
 * called "Copy link" a minute later and the confirmation is actually announced. And the
 * region reserves its width, so confirming does not shove the button out from under the
 * pointer that just pressed it.
 */
function AskLink({ name, url }: { name: string; url: string }) {
  const valueRef = useRef<HTMLElement>(null);
  const [outcome, setOutcome] = useState<'idle' | 'copied' | 'selected'>('idle');

  /** Selects the whole URL, so the platform's own copy is one keystroke away. */
  const selectValue = () => {
    const node = valueRef.current;
    const selection = window.getSelection?.();
    if (node === null || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copy = () => {
    const select = () => {
      selectValue();
      setOutcome('selected');
    };
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) {
      select();
      return;
    }
    void clipboard.writeText(url).then(() => setOutcome('copied'), select);
  };

  return (
    <div className={styles.link}>
      <code
        ref={valueRef}
        className={styles.linkValue}
        tabIndex={0}
        aria-label={`Link for ${name}`}
        onFocus={selectValue}
      >
        {url}
      </code>
      <Button size="sm" aria-label={`Copy the link for ${name}`} onClick={copy}>
        Copy link
      </Button>
      <span className={styles.copied} role="status" aria-live="polite">
        {outcome === 'copied'
          ? 'Copied'
          : outcome === 'selected'
            ? 'Selected — copy it with your keyboard'
            : ''}
      </span>
    </div>
  );
}
