/**
 * Settings → Integrations: the first-party catalogue on one screen, plus a
 * submit form for tools that are not in the list yet.
 *
 * Each row is either a link to the settings page that already exists, or a "not yet"
 * badge for something the inventory still lists as a gap. Connection state is live off
 * the replica so a GitHub install made on another device shows up here without a refresh
 * of this page's own query.
 *
 * Submissions are not replicated. The form posts, the list re-queries, and a guest never
 * sees either — the server refuses both, and this screen hides them first.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { Badge, Button, Input, Textarea } from '~/components';
import { DIRECTORY, directoryStatus, STATUS_LABEL } from '~/features/integrations/directory';
import {
  fetchIntegrationSubmissions,
  submitIntegration,
  type IntegrationSubmission,
} from '~/features/integrations/submit';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import type { Store } from '~/store';
import { ApiError } from '~/sync/api';

import styles from './IntegrationDirectory.module.css';

export function IntegrationDirectory() {
  const viewer = useViewer();
  const canSubmit = viewer !== null && viewer.role !== 'guest';
  const rows = useLiveQuery(
    (store: Store) => DIRECTORY.map((entry) => ({ entry, status: directoryStatus(store, entry) })),
    ['githubConnection', 'gitlabConnection', 'sentryConnection', 'slackConnection', 'askForm'],
  );

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Integrations</h1>
      </header>
      <div className={styles.body}>
        <p className={styles.lede}>
          First-party integrations use the same GraphQL API, webhooks, and OAuth as everyone else.
          Connect the ones that ship; the rest stay listed so the gap is visible.
        </p>
        <ul className={styles.list}>
          {rows.map(({ entry, status }) => {
            const badge = (
              <Badge
                tone={
                  status === 'connected' ? 'success' : status === 'coming' ? 'neutral' : 'accent'
                }
              >
                {STATUS_LABEL[status]}
              </Badge>
            );
            const body = (
              <>
                <span className={styles.name}>{entry.name}</span>
                <span className={styles.category}>{entry.category}</span>
                <span className={styles.summary}>{entry.summary}</span>
                {badge}
              </>
            );
            return (
              <li key={entry.id} className={styles.item}>
                {entry.href === undefined ? (
                  <div className={styles.row}>{body}</div>
                ) : (
                  <Link className={styles.row} to={entry.href}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        {canSubmit ? <SubmitSection /> : null}
      </div>
    </div>
  );
}

function SubmitSection() {
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [summary, setSummary] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<IntegrationSubmission | null>(null);
  const [proposals, setProposals] = useState<readonly IntegrationSubmission[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchIntegrationSubmissions(controller.signal)
      .then((rows) => {
        setProposals(rows);
        setListError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setListError(
          cause instanceof ApiError ? cause.message : 'Could not load submitted integrations.',
        );
      });
    return () => controller.abort();
  }, [attempt]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send();
  };

  const send = async () => {
    if (busy) return;
    const trimmedName = name.trim();
    const trimmedWebsite = website.trim();
    const trimmedSummary = summary.trim();
    let blocked = false;
    if (trimmedName === '') {
      setNameError('An integration needs a name.');
      blocked = true;
    } else {
      setNameError(null);
    }
    if (trimmedWebsite === '') {
      setWebsiteError('An integration needs a website.');
      blocked = true;
    } else {
      setWebsiteError(null);
    }
    if (trimmedSummary === '') {
      setSummaryError('Say what the integration does.');
      blocked = true;
    } else {
      setSummaryError(null);
    }
    if (blocked) return;

    setBusy(true);
    setFailure(null);
    try {
      const row = await submitIntegration({
        name: trimmedName,
        website: trimmedWebsite,
        summary: trimmedSummary,
      });
      setSubmitted(row);
      setName('');
      setWebsite('');
      setSummary('');
      setAttempt((n) => n + 1);
    } catch (cause: unknown) {
      setFailure(
        cause instanceof ApiError ? cause.message : 'That integration could not be submitted.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.submit}>
      <h2 className={styles.submitTitle}>Submit an integration</h2>
      <p className={styles.lede}>
        Propose a third-party tool that is not in the catalogue yet. It is recorded here for this
        workspace; it does not appear as connected until somebody actually builds it.
      </p>
      <form className={styles.form} onSubmit={onSubmit}>
        <Input
          label="Name"
          value={name}
          error={nameError ?? undefined}
          placeholder="Zapier"
          autoComplete="off"
          onChange={(event) => {
            setName(event.target.value);
            if (nameError !== null) setNameError(null);
          }}
        />
        <Input
          label="Website"
          type="url"
          value={website}
          error={websiteError ?? undefined}
          placeholder="https://example.com"
          autoComplete="off"
          onChange={(event) => {
            setWebsite(event.target.value);
            if (websiteError !== null) setWebsiteError(null);
          }}
        />
        <Textarea
          label="What it does"
          value={summary}
          error={summaryError ?? undefined}
          minRows={3}
          maxRows={6}
          onChange={(event) => {
            setSummary(event.target.value);
            if (summaryError !== null) setSummaryError(null);
          }}
        />
        {failure === null ? null : (
          <p className={styles.error} role="alert">
            {failure}
          </p>
        )}
        {submitted === null ? null : (
          <p className={styles.notice} role="status">
            {submitted.name} is on the list. It stays a proposal until the integration itself ships.
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy}>
          Submit
        </Button>
      </form>
      {listError === null ? null : (
        <p className={styles.error} role="alert">
          {listError}
        </p>
      )}
      {proposals !== null && proposals.length > 0 ? (
        <ul className={styles.proposals}>
          {proposals.map((row) => (
            <li key={row.id} className={styles.proposal}>
              <a
                className={styles.proposalName}
                href={row.website}
                rel="noreferrer"
                target="_blank"
              >
                {row.name}
              </a>
              <span className={styles.proposalSummary}>{row.summary}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
