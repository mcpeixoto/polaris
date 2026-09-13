/**
 * My Issues → Activity: a personal feed of curated issue history.
 *
 * Network-fetched from `myIssueActivity`, not a replica IssueListSource. Assigned / Created /
 * Subscribed are local indexes; history is the permanent curated store that issue detail
 * already loads on demand, and a cross-issue cut of it is the same kind of read.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { Button, EmptyState, Skeleton, Tabs, type TabItem } from '~/components';
import { DotGlyph } from '~/features/issue/glyphs';
import { personName } from '~/features/prefs/prefs';
import { exact, when } from '~/features/time';
import { MY_ISSUE_ACTIVITY_QUERY } from '~/gql/operations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Actor, UUID } from '~/store';
import { gql } from '~/sync/api';
import { describe, type HistoryEntry } from './IssueDetail';
import styles from './MyIssuesActivity.module.css';

export interface MyIssueActivityRow {
  readonly id: UUID;
  readonly issueId: UUID;
  readonly identifier: string;
  readonly title: string;
  readonly actor: Actor;
  readonly kind: string;
  readonly fromValue: unknown;
  readonly toValue: unknown;
  readonly createdAt: string;
}

type Load =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly rows: readonly MyIssueActivityRow[] }
  | { readonly phase: 'failed' };

export function MyIssuesActivity({ tabs }: { readonly tabs: readonly TabItem[] }) {
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const names = useLiveQuery(
    (store) => {
      const out: Record<string, string> = {};
      for (const user of store.users.values()) out[user.id] = personName(user);
      return out;
    },
    ['user'],
  );

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setLoad({ phase: 'loading' });

    void gql<{ myIssueActivity: MyIssueActivityRow[] }>(
      MY_ISSUE_ACTIVITY_QUERY,
      { first: 50 },
      { signal: controller.signal },
    )
      .then((data) => {
        if (!live) return;
        setLoad({ phase: 'ready', rows: data.myIssueActivity });
      })
      .catch(() => {
        if (live) setLoad({ phase: 'failed' });
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [attempt]);

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <h1 className={styles.title}>My issues</h1>
        </nav>
      </header>
      <Tabs className={styles.tabs} aria-label="My issues tabs" items={tabs} />
      <Feed load={load} names={names} onRetry={() => setAttempt((n) => n + 1)} />
    </div>
  );
}

function Feed({
  load,
  names,
  onRetry,
}: {
  load: Load;
  names: Record<string, string>;
  onRetry: () => void;
}) {
  if (load.phase === 'failed') {
    return (
      <p className={styles.failure} role="status">
        <span>Your activity could not be loaded.</span>
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      </p>
    );
  }

  if (load.phase === 'loading') {
    return (
      <div className={styles.skeleton} aria-busy="true" aria-label="Loading activity">
        <Skeleton height="var(--space-4)" width="70%" />
        <Skeleton height="var(--space-4)" width="55%" />
        <Skeleton height="var(--space-4)" width="62%" />
      </div>
    );
  }

  if (load.rows.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        description="Updates on issues you are assigned, created, or subscribed to will show up here."
      />
    );
  }

  return (
    <ul className={styles.feed} aria-label="Activity">
      {load.rows.map((row) => {
        const entry: HistoryEntry = {
          id: row.id,
          issueId: row.issueId,
          actor: row.actor,
          kind: row.kind,
          fromValue: row.fromValue,
          toValue: row.toValue,
          createdAt: row.createdAt,
        };
        return (
          <li key={row.id}>
            <Link to={`/issue/${row.identifier}`} className={styles.row}>
              <span className={styles.issue}>
                <span className={styles.identifier}>{row.identifier}</span>
                <span className={styles.issueTitle}>{row.title}</span>
              </span>
              <span className={styles.glyph}>
                <DotGlyph width={14} height={14} />
              </span>
              <span className={styles.text}>
                <span className={styles.actor}>{actorName(row.actor, names)}</span>{' '}
                {describe(entry, names)}
              </span>
              <time className={styles.when} dateTime={row.createdAt} title={exact(row.createdAt)}>
                {when(row.createdAt)}
              </time>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function actorName(actor: Actor, names: Record<string, string>): string {
  if (actor.type === 'system') return 'Polaris';
  if (actor.id === undefined) return 'Somebody';
  return names[actor.id] ?? 'Somebody';
}
