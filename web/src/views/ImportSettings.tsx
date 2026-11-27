/**
 * Import a Linear workspace.
 *
 * The job is not an entity in the replica. It is read on this one screen, and the change
 * log is silent about it, so a store subscription would be a subscription to nothing. The
 * list is a GraphQL query into component state, asked again while a job is still queued
 * or running, and not asked again once every job has finished. A settings tab left open
 * is not a reason to poll a workspace that is sitting still.
 *
 * Starting one is a plain `gql` call, not `engine.mutate`. The variable is a Linear API
 * key, and the outbox replays a queued mutation by re-sending its variables — a key
 * sitting on the device until the network came back. The key is handed to the server and
 * then dropped, including from this input.
 *
 * The route is open to members, the same way Export is. The mutation and the list are
 * not: both answer to an administrator on the server. A member who opens the address is
 * told that here, rather than shown a form whose first result would be the refusal.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
  Badge,
  Button,
  EmptyState,
  Input,
  SettingsPage,
  SettingsSection,
  LoadingRows,
  type BadgeTone,
} from '~/components';
import { SettingsRow } from '~/components/SettingsSection';
import {
  importInFlight,
  listImportJobs,
  startLinearImport,
  type ImportJob,
} from '~/features/imports/mutations';
import { exact, when } from '~/features/time';
import { useViewerRole } from '~/hooks/useViewer';
import { ApiError } from '~/sync/api';

import styles from './ImportSettings.module.css';

/**
 * How often a running import is re-read.
 *
 * Short enough that a finished job does not sit on "running" for a coffee, long enough
 * that an open tab is not a load generator.
 */
const IMPORT_POLL_MS = 3000;

// COPY:
const PAGE_TITLE = 'Import';
// COPY:
const SECTION_TITLE = 'Import from Linear';
// COPY:
const SECTION_DESCRIPTION =
  'Copies teams, statuses, labels, projects, cycles, issues and comments from a Linear workspace. Issue numbers are kept where they are free. Nobody is notified about imported issues. Running it again skips what was already imported.';
// COPY:
const MEMBER_NOTE = 'Only a workspace administrator can import from Linear.';
// COPY:
const KEY_LABEL = 'Linear API key';
// COPY:
const START_LABEL = 'Start import';
// COPY:
const LIST_TITLE = 'Imports';
// COPY:
const LIST_CAPTION = 'Newest first. A job that failed keeps its error.';
// COPY:
const EMPTY_TITLE = 'No imports yet';
// COPY:
const EMPTY_DESCRIPTION = 'A Linear import will show up here once it has been started.';
// COPY:
const LOADING_ROLE = 'Loading import';
// COPY:
const LOADING_LIST = 'Loading imports';
// COPY:
const LOAD_FAILED = 'Imports could not be fetched.';
// COPY:
const START_FAILED = 'The import could not be started.';
// COPY:
const TRY_AGAIN = 'Try again';
// COPY:
const LINK_LEAD = 'Personal API keys are created in ';
// COPY:
const LINK_LABEL = 'Linear account security';

const STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
  queued: 'neutral',
  running: 'accent',
  done: 'success',
  failed: 'danger',
};

// COPY: queued
// COPY: running
// COPY: done
// COPY: failed
const STATUS_LABEL: Readonly<Record<string, string>> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/**
 * RFC 3339 sorts lexically, so newest-first needs no parsing. The server already returns
 * the list that way; sorting here is what keeps a poll from shuffling the table if one
 * answer arrives out of order.
 */
function newestFirst(jobs: readonly ImportJob[]): ImportJob[] {
  return [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function upsertJob(current: readonly ImportJob[] | null, job: ImportJob): ImportJob[] {
  return newestFirst([job, ...(current ?? []).filter((row) => row.id !== job.id)]);
}

function failureText(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

function Moment({ at }: { at: string | null }) {
  if (at === null || at === '') return <>—</>;
  return (
    <time dateTime={at} title={exact(at)}>
      {when(at)}
    </time>
  );
}

export function ImportSettings() {
  const role = useViewerRole();
  const isAdmin = role === 'owner' || role === 'admin';

  const [jobs, setJobs] = useState<readonly ImportJob[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [apiKey, setApiKey] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Read by the poll's error path, which has to decide whether to ask again without
  // waiting for a render that may not have committed the list yet.
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  useEffect(() => {
    if (!isAdmin) return undefined;

    const controller = new AbortController();
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pull = () => {
      // Aborted rather than merely ignored, so leaving the screen mid-request does not
      // hold the socket. The rejection lands in the catch with `live` already false.
      void listImportJobs(controller.signal)
        .then((next) => {
          if (!live) return;
          const ordered = newestFirst(next);
          setJobs(ordered);
          setLoadError(null);
          // One shot, then the next only if something is still moving. A finished list
          // does not schedule, which is what stops the poll — including the poll that
          // just watched the last job finish.
          if (ordered.some(importInFlight)) timer = setTimeout(pull, IMPORT_POLL_MS);
        })
        .catch((cause: unknown) => {
          if (!live) return;
          setLoadError(failureText(cause, LOAD_FAILED));
          // A blip must not freeze a row on "Running" until the person reloads the page.
          // A first load that failed has nothing in flight to keep asking about.
          if (jobsRef.current?.some(importInFlight)) timer = setTimeout(pull, IMPORT_POLL_MS);
        });
    };

    pull();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    };
  }, [isAdmin, attempt]);

  const inFlight = jobs?.some(importInFlight) ?? false;
  // Disabled until the list has answered, too. Otherwise a second import can be started
  // in the gap before the screen learns the first one is already running.
  const startDisabled = apiKey.trim() === '' || inFlight || starting || jobs === null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (startDisabled) return;
    const key = apiKey.trim();
    setStarting(true);
    setStartError(null);
    void startLinearImport(key)
      .then((job) => {
        setApiKey('');
        setJobs((current) => upsertJob(current, job));
        // The job is queued. Bumping the attempt is what starts the poll: the effect
        // reads the list again and schedules the next read only while one is in flight.
        setAttempt((n) => n + 1);
      })
      .catch((cause: unknown) => {
        setStartError(failureText(cause, START_FAILED));
      })
      .finally(() => {
        setStarting(false);
      });
  };

  return (
    <SettingsPage title={PAGE_TITLE}>
      <SettingsSection
        title={SECTION_TITLE}
        description={SECTION_DESCRIPTION}
        error={startError ?? undefined}
      >
        {role === null ? (
          <SettingsRow>
            <LoadingRows label={LOADING_ROLE} count={2} />
          </SettingsRow>
        ) : isAdmin ? (
          <form className={styles.form} onSubmit={onSubmit}>
            <SettingsRow>
              <p className={styles.note}>
                {LINK_LEAD}
                <a
                  className={styles.link}
                  href="https://linear.app/settings/account/security"
                  target="_blank"
                  rel="noreferrer"
                >
                  {LINK_LABEL}
                </a>
                .
              </p>
            </SettingsRow>
            <SettingsRow label={KEY_LABEL} wide>
              <Input
                label={KEY_LABEL}
                hideLabel
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </SettingsRow>
            <SettingsRow>
              <div className={styles.start}>
                <Button type="submit" variant="primary" disabled={startDisabled} loading={starting}>
                  {START_LABEL}
                </Button>
              </div>
            </SettingsRow>
          </form>
        ) : (
          <SettingsRow>
            <p className={styles.note}>{MEMBER_NOTE}</p>
          </SettingsRow>
        )}
      </SettingsSection>

      {isAdmin ? (
        <SettingsSection title={LIST_TITLE}>
          {loadError !== null ? (
            <SettingsRow>
              <div className={styles.failure} role="alert">
                <p className={styles.failureText}>{loadError}</p>
                <Button onClick={() => setAttempt((n) => n + 1)}>{TRY_AGAIN}</Button>
              </div>
            </SettingsRow>
          ) : null}

          {jobs === null && loadError === null ? (
            <SettingsRow>
              <LoadingRows label={LOADING_LIST} count={3} />
            </SettingsRow>
          ) : null}

          {jobs !== null && jobs.length === 0 ? (
            <SettingsRow>
              <EmptyState title={EMPTY_TITLE} description={EMPTY_DESCRIPTION} />
            </SettingsRow>
          ) : null}

          {jobs === null || jobs.length === 0 ? null : (
            <table className={styles.table}>
              <caption className={styles.caption}>{LIST_CAPTION}</caption>
              <thead>
                <tr>
                  {/* COPY: */}
                  <th scope="col">Status</th>
                  {/* COPY: */}
                  <th scope="col">Started</th>
                  {/* COPY: */}
                  <th scope="col">Finished</th>
                  {/* COPY: */}
                  <th scope="col">Progress</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <JobRow key={job.id} job={job} />
                ))}
              </tbody>
            </table>
          )}
        </SettingsSection>
      ) : null}
    </SettingsPage>
  );
}

function JobRow({ job }: { job: ImportJob }) {
  return (
    <>
      <tr>
        <td>
          <Badge tone={STATUS_TONE[job.status] ?? 'neutral'}>{statusLabel(job.status)}</Badge>
        </td>
        <td>
          <Moment at={job.startedAt} />
        </td>
        <td>
          <Moment at={job.finishedAt} />
        </td>
        <td className={styles.progressCell}>
          <ul className={styles.progress}>
            {job.progress.map((row) => (
              <li key={row.entity}>
                {row.entity} {row.done} / {row.total}
              </li>
            ))}
          </ul>
        </td>
      </tr>
      {job.status === 'failed' && job.error !== null && job.error !== '' ? (
        <tr>
          <td className={styles.jobError} colSpan={4}>
            {job.error}
          </td>
        </tr>
      ) : null}
    </>
  );
}
