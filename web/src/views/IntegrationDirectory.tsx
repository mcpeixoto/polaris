/**
 * Settings → Integrations: the first-party catalogue on one screen, plus a
 * submit form for tools that are not in the list yet.
 *
 * Each row is either a link to the settings page that already exists, or a "not yet"
 * badge for something the inventory still lists as a gap. Connection state is live off
 * the replica so a GitHub install made on another device shows up here without a refresh
 * of this page's own query.
 *
 * The catalogue is grouped by the `category` every entry already carried and was not using
 * for anything: seventeen rows in one flat list is a list nobody scans, and a person
 * arriving here is looking for "the chat one" far more often than for a specific product
 * name. The filter is there for when they do know the name — it matches the category too,
 * so typing "chat" and typing "Slack" both land.
 *
 * Submissions are not replicated. The form posts, the list re-queries, and a guest never
 * sees either — the server refuses both, and this screen hides them first.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import {
  Badge,
  Button,
  EmptyState,
  Input,
  SettingsPage,
  SettingsSection,
  Spinner,
  Textarea,
} from '~/components';
import {
  DIRECTORY,
  directoryStatus,
  STATUS_LABEL,
  type DirectoryEntry,
  type IntegrationStatus,
} from '~/features/integrations/directory';
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

interface DirectoryRow {
  entry: DirectoryEntry;
  status: IntegrationStatus;
}

export function IntegrationDirectory() {
  const viewer = useViewer();
  const canSubmit = viewer !== null && viewer.role !== 'guest';
  const [filter, setFilter] = useState('');

  const rows = useLiveQuery(
    (store: Store) => DIRECTORY.map((entry) => ({ entry, status: directoryStatus(store, entry) })),
    ['githubConnection', 'gitlabConnection', 'sentryConnection', 'slackConnection', 'askForm'],
  );

  const groups = useMemo(() => groupByCategory(rows, filter), [rows, filter]);

  return (
    <SettingsPage
      title="Integrations"
      description="First-party integrations use the same GraphQL API, webhooks, and OAuth as everyone else. Connect the ones that ship; the rest stay listed so the gap is visible."
    >
      <SettingsSection
        actions={
          <Input
            label="Filter integrations"
            hideLabel
            type="search"
            value={filter}
            placeholder="Filter by name or category"
            autoComplete="off"
            onChange={(event) => setFilter(event.target.value)}
          />
        }
      >
        {groups.length === 0 ? (
          <EmptyState
            title="No integration matches"
            description="Nothing in the catalogue matches that. Clear the filter to see all of them."
            action={<Button onClick={() => setFilter('')}>Clear the filter</Button>}
          />
        ) : (
          groups.map(({ category, entries }) => (
            <section key={category} className={styles.group}>
              {/* The heading is what replaced the per-row category column. Two places saying
                  the same word, one of them in a 7rem column that truncated "Source control",
                  was one place too many. */}
              <h3 className={styles.groupTitle}>{category}</h3>
              <ul className={styles.list}>
                {entries.map(({ entry, status }) => (
                  <li key={entry.id} className={styles.item}>
                    <DirectoryRowBody entry={entry} status={status} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </SettingsSection>

      {canSubmit ? <SubmitSection /> : null}
    </SettingsPage>
  );
}

function DirectoryRowBody({ entry, status }: DirectoryRow) {
  const body = (
    <>
      <span className={styles.name}>{entry.name}</span>
      <span className={styles.summary}>{entry.summary}</span>
      <Badge tone={status === 'connected' ? 'success' : status === 'coming' ? 'neutral' : 'accent'}>
        {STATUS_LABEL[status]}
      </Badge>
    </>
  );

  return entry.href === undefined ? (
    <div className={styles.row}>{body}</div>
  ) : (
    <Link className={styles.row} to={entry.href}>
      {body}
    </Link>
  );
}

interface DirectoryGroup {
  category: string;
  entries: readonly DirectoryRow[];
}

/**
 * Group in the catalogue's own order rather than alphabetically.
 *
 * `DIRECTORY` is hand-ordered — source control first, the long tail of "not yet" last — and
 * sorting the categories by name would throw that away for no gain. So a category takes the
 * position of its first entry, which preserves the author's ranking and still puts every
 * member of a category together.
 */
function groupByCategory(rows: readonly DirectoryRow[], filter: string): readonly DirectoryGroup[] {
  const needle = filter.trim().toLowerCase();
  const matches =
    needle === ''
      ? rows
      : rows.filter(
          ({ entry }) =>
            entry.name.toLowerCase().includes(needle) ||
            entry.category.toLowerCase().includes(needle),
        );

  const order: string[] = [];
  const byCategory = new Map<string, DirectoryRow[]>();
  for (const row of matches) {
    const bucket = byCategory.get(row.entry.category);
    if (bucket === undefined) {
      order.push(row.entry.category);
      byCategory.set(row.entry.category, [row]);
    } else {
      bucket.push(row);
    }
  }

  return order.map((category) => ({ category, entries: byCategory.get(category) ?? [] }));
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
    <SettingsSection
      title="Propose an integration"
      description="Propose a third-party tool that is not in the catalogue yet. It is recorded here for this workspace; it does not appear as connected until somebody actually builds it."
      error={failure ?? undefined}
      flush
    >
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
        {submitted === null ? null : (
          <p className={styles.notice} role="status">
            {submitted.name} is on the list. It stays a proposal until the integration itself ships.
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy}>
          Propose integration
        </Button>
      </form>

      {/*
        Three branches, not one. The list used to render only when it had rows, so somebody
        who had just proposed something watched the form clear and nothing else happen —
        indistinguishable from a post that went nowhere — and a failed fetch showed the same
        nothing as an empty workspace.
      */}
      {listError !== null ? (
        <EmptyState
          title="Proposals could not be loaded"
          description={listError}
          action={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
        />
      ) : proposals === null ? (
        <div className={styles.proposalsLoading}>
          <Spinner label="Loading proposals" />
        </div>
      ) : proposals.length === 0 ? (
        <EmptyState
          title="No proposals yet"
          description="Nobody in this workspace has proposed an integration. The form above is how one gets here."
        />
      ) : (
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
      )}
    </SettingsSection>
  );
}
