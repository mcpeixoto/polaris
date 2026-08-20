/**
 * Pulse: the workspace feed of project updates.
 *
 * A dense list, like the inbox, of status posts already in the replica. There is no
 * extra query — posting an update emits a change-log row, and that row is what lands
 * here. Guests do not see it: Pulse is a workspace-level surface.
 */

import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';

import { useActions } from '~/app/keymap';
import { EmptyState } from '~/components';
import { dayKeyOf } from '~/features/inbox/inbox';
import { browserTimezone } from '~/features/locale';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { listPulse, type PulseTab } from '~/features/pulse/pulse';
import { when } from '~/features/time';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer, useViewerId } from '~/hooks/useViewer';
import type { Store } from '~/store';

import styles from './Pulse.module.css';

export function Pulse() {
  const navigate = useNavigate();
  const viewer = useViewer();
  const viewerId = useViewerId();
  const timezone = browserTimezone();
  const [tab, setTab] = useState<PulseTab>('for-me');
  const [cursor, setCursor] = useState(0);

  const days = useLiveQuery(
    (store: Store) => listPulse(store, viewerId, tab, timezone),
    ['project', 'projectMember', 'projectUpdate', 'user'],
    [viewerId, tab, timezone],
  );

  const flat = days.flatMap((day) => day.events);
  const active = flat[cursor];

  useActions(
    [
      {
        id: 'pulse.up',
        title: 'Previous update',
        keys: ['k', 'ArrowUp'],
        group: 'Pulse',
        run: () => setCursor((current) => Math.max(0, current - 1)),
      },
      {
        id: 'pulse.down',
        title: 'Next update',
        keys: ['j', 'ArrowDown'],
        group: 'Pulse',
        run: () => setCursor((current) => Math.min(Math.max(flat.length - 1, 0), current + 1)),
      },
      {
        id: 'pulse.open',
        title: 'Open update',
        keys: ['Enter', 'o'],
        group: 'Pulse',
        run: () => {
          if (active !== undefined) void navigate(active.href);
        },
      },
    ],
    [cursor, flat.length, active, navigate],
  );

  if (viewer !== null && viewer.role === 'guest') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Pulse</h1>
        <div className={styles.tabs} role="tablist" aria-label="Pulse tabs">
          <TabButton
            current={tab}
            id="for-me"
            onSelect={(next) => {
              setTab(next);
              setCursor(0);
            }}
          >
            For me
          </TabButton>
          <TabButton
            current={tab}
            id="recent"
            onSelect={(next) => {
              setTab(next);
              setCursor(0);
            }}
          >
            Recent
          </TabButton>
        </div>
      </header>

      {flat.length === 0 ? (
        <div className={styles.empty}>
          <EmptyState
            title={tab === 'for-me' ? 'Nothing for you yet' : 'No updates yet'}
            description="Project status updates in this workspace will land here as they are posted."
          />
        </div>
      ) : (
        <div className={styles.list}>
          {days.map((day) => (
            <section key={day.key}>
              <h2 className={styles.day}>{labelDay(day.key, timezone)}</h2>
              <ul className={styles.rows}>
                {day.events.map((row, offset) => {
                  const index = indexOfDay(days, day.key) + offset;
                  return (
                    <li key={row.id}>
                      <Link
                        to={row.href}
                        className={[styles.row, index === cursor ? styles.active : null]
                          .filter(Boolean)
                          .join(' ')}
                        onFocus={() => setCursor(index)}
                      >
                        <div className={styles.meta}>
                          <ProjectHealthBadge health={row.health} compact />
                          <span className={styles.project}>{row.projectName}</span>
                          <span className={styles.actor}>{row.actor}</span>
                          <time className={styles.when} dateTime={row.at} title={row.at}>
                            {when(row.at)}
                          </time>
                        </div>
                        {row.body !== '' && <p className={styles.body}>{row.body}</p>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function indexOfDay(
  days: readonly { readonly key: string; readonly events: readonly unknown[] }[],
  key: string,
): number {
  let index = 0;
  for (const day of days) {
    if (day.key === key) return index;
    index += day.events.length;
  }
  return index;
}

function TabButton({
  current,
  id,
  onSelect,
  children,
}: {
  current: PulseTab;
  id: PulseTab;
  onSelect: (tab: PulseTab) => void;
  children: string;
}) {
  const selected = current === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={[styles.tab, selected ? styles.tabActive : null].filter(Boolean).join(' ')}
      onClick={() => onSelect(id)}
    >
      {children}
    </button>
  );
}

function labelDay(key: string, timezone: string): string {
  const today = dayKeyOf(new Date().toISOString(), timezone);
  if (key === today) return 'Today';
  const parsed = Date.parse(`${key}T12:00:00Z`);
  if (Number.isNaN(parsed)) return key;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  }).format(parsed);
}
