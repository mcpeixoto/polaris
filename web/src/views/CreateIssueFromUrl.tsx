/**
 * `/new` and `/team/:key/new`: open the composer with the query string already applied.
 *
 * The overlay is owned by the shell. This route is the address that Slack unfurls, email
 * templates and "copy create URL" produce; it exists so those links survive a paste into
 * a browser that is already signed in.
 *
 * What is under the composer is therefore a report on whether the composer opened, and it
 * used to be a claim instead: "The composer is open" was rendered from the first frame,
 * before the replica had a team to file into and whether or not the request was accepted.
 * On a slow first sync that page said the dialog was up and then waited forever, and when a
 * composer was already on screen the shell dropped the seed and the page never mentioned it.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, EmptyState, SkeletonRows } from '~/components';
import { useCreateIssue } from '~/features/issue/create-context';
import { parseCreateURL, resolveCreateURL } from '~/features/issue/create-url';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import styles from './CreateIssueFromUrl.module.css';

/**
 * How long the replica gets to produce a team before this page stops waiting.
 *
 * Long enough that a first sync over a slow connection still lands in the composer, short
 * enough that somebody staring at placeholder rows is given a way out rather than a spinner
 * with no end. The wait is not cancelled by the answer arriving — `ready` is what opens the
 * composer, and this only decides when to admit it has not.
 */
const WAIT_MS = 10_000;

type Phase = 'waiting' | 'open' | 'dropped' | 'timedOut';

export function CreateIssueFromUrl() {
  const { teamKey } = useParams<{ teamKey?: string }>();
  const [search] = useSearchParams();
  const engine = useEngine();
  const viewerId = useViewerId();
  const { open } = useCreateIssue();
  const opened = useRef(false);
  const [phase, setPhase] = useState<Phase>('waiting');
  const [attempt, setAttempt] = useState(0);

  const ready = useLiveQuery((store) => store.teams.size > 0, ['team']);

  useEffect(() => {
    if (!ready || opened.current) return;
    opened.current = true;
    const raw = parseCreateURL(search, teamKey ?? null);
    const accepted = open(resolveCreateURL(engine.store, raw, viewerId));
    setPhase(accepted ? 'open' : 'dropped');
  }, [attempt, engine.store, open, ready, search, teamKey, viewerId]);

  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setPhase('timedOut'), WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [attempt, ready]);

  const retry = () => {
    opened.current = false;
    setPhase('waiting');
    setAttempt((n) => n + 1);
  };

  return (
    <div className={styles.screen}>
      <h1 className={styles.screenTitle}>New issue</h1>
      {phase === 'open' ? (
        <EmptyState
          title="New issue"
          description="The composer is open. ⌘⏎ files it; Esc puts it away."
        />
      ) : phase === 'dropped' ? (
        <EmptyState
          title="A composer is already open"
          description="This link could not fill it in without discarding what is already typed there. File or close that one, then try again."
          action={
            <Button variant="primary" onClick={retry}>
              Try again
            </Button>
          }
        />
      ) : phase === 'timedOut' ? (
        <EmptyState
          title="This workspace has not arrived yet"
          description="The composer needs a team to file into and none has synced. Check the connection, then try again."
          action={
            <Button variant="primary" onClick={retry}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className={styles.loading} role="status" aria-busy="true">
          <p className={styles.loadingNote}>Opening the composer…</p>
          <SkeletonRows count={4} />
        </div>
      )}
    </div>
  );
}
