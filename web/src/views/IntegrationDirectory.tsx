/**
 * Settings → Integrations: the first-party catalogue on one screen.
 *
 * Each row is either a link to the settings page that already exists, or a "not yet"
 * badge for something the inventory still lists as a gap. Connection state is live off
 * the replica so a GitHub install made on another device shows up here without a refresh
 * of this page's own query.
 */

import { Link } from 'react-router';

import { Badge } from '~/components';
import { DIRECTORY, directoryStatus, STATUS_LABEL } from '~/features/integrations/directory';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store } from '~/store';

import styles from './IntegrationDirectory.module.css';

export function IntegrationDirectory() {
  const rows = useLiveQuery(
    (store: Store) => DIRECTORY.map((entry) => ({ entry, status: directoryStatus(store, entry) })),
    ['githubConnection', 'gitlabConnection', 'sentryConnection', 'askForm'],
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
      </div>
    </div>
  );
}
