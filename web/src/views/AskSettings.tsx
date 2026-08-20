/**
 * Workspace Asks: shareable forms that turn a submission into a team's triage issue.
 *
 * Slack and SAML-gated web forms stay out. v1 is the slack-less surface: a token URL
 * anybody can open, no account required.
 */

import { useState, type FormEvent } from 'react';

import { useEngine } from '~/app/context';
import { Button, EmptyState, Input, Select, Textarea } from '~/components';
import { createAskForm, deleteAskForm } from '~/features/asks/mutations';
import { copyText } from '~/features/github/copy';
import { report } from '~/features/issue/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store } from '~/store';
import { ApiError } from '~/sync/api';
import styles from '~/features/labels/LabelSettings.module.css';

export function AskSettings() {
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

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

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/ask/${token}`;
    void copyText(url).then((ok) => {
      if (ok) setCopied(token);
    });
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Asks</h1>
      </header>

      <div className={styles.body}>
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <section className={styles.section}>
          <p className={styles.sectionHint}>
            Share a link. Anyone who opens it can file an issue into that team's triage — they do
            not need a Polaris account.
          </p>

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
            <ul className={styles.tree}>
              {forms.map((form) => {
                const team = teams.find((row) => row.id === form.teamId);
                const link = form.token === '' ? '' : `${window.location.origin}/ask/${form.token}`;
                return (
                  <li key={form.id} className={styles.row}>
                    <div>
                      <strong>{form.name}</strong>
                      <span className={styles.sectionHint}>
                        {team?.name ?? 'Team'}
                        {link === '' ? null : ` · ${link}`}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={form.token === ''}
                      onClick={() => copyLink(form.token)}
                    >
                      {copied === form.token ? 'Copied' : 'Copy link'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setError(null);
                        deleteAskForm(engine, form.id).catch(fail);
                      }}
                    >
                      Delete
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
