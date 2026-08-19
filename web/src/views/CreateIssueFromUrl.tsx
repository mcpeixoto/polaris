/**
 * `/new` and `/team/:key/new`: open the composer with the query string already applied.
 *
 * The overlay is owned by the shell. This route is the address that Slack unfurls, email
 * templates and "copy create URL" produce; it exists so those links survive a paste into
 * a browser that is already signed in.
 */

import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { useEngine } from '~/app/context';
import { EmptyState } from '~/components';
import { useCreateIssue } from '~/features/issue/create-context';
import { parseCreateURL, resolveCreateURL } from '~/features/issue/create-url';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import styles from './CreateIssueFromUrl.module.css';

export function CreateIssueFromUrl() {
  const { teamKey } = useParams<{ teamKey?: string }>();
  const [search] = useSearchParams();
  const engine = useEngine();
  const viewerId = useViewerId();
  const { open } = useCreateIssue();
  const opened = useRef(false);

  const ready = useLiveQuery((store) => store.teams.size > 0, ['team']);

  useEffect(() => {
    if (!ready || opened.current) return;
    opened.current = true;
    const raw = parseCreateURL(search, teamKey ?? null);
    open(resolveCreateURL(engine.store, raw, viewerId));
  }, [engine.store, open, ready, search, teamKey, viewerId]);

  return (
    <div className={styles.screen}>
      <h1 className={styles.screenTitle}>New issue</h1>
      <EmptyState
        title="New issue"
        description="The composer is open. ⌘⏎ files it; Esc puts it away."
      />
    </div>
  );
}
