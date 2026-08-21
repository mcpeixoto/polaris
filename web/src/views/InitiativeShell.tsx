/**
 * Initiative shell — name, health and Overview / Activity tabs.
 */

import { useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router';

import { Button, EmptyState } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { useEngine } from '~/app/context';
import { archiveInitiative, formatInitiativeStatus } from '~/features/initiatives/mutations';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { latestInitiativeUpdate } from '~/features/initiative-updates/helpers';
import { report, setInitiativeSubscription } from '~/features/subscriptions/mutations';
import { SubscribeBell } from '~/features/subscriptions/SubscribeBell';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import { ApiError } from '~/sync/api';
import styles from './InitiativeShell.module.css';

function tabClass({ isActive }: { isActive: boolean }): string {
  const tab = styles.tab ?? '';
  const active = styles.tabActive ?? '';
  return isActive ? `${tab} ${active}`.trim() : tab;
}

export function InitiativeShell() {
  const engine = useEngine();
  const navigate = useNavigate();
  const { initiativeId = '' } = useParams<{ initiativeId: string }>();
  const viewer = useViewer();
  const [archiving, setArchiving] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const initiative = useLiveQuery(
    (store) => store.initiatives.get(initiativeId) ?? null,
    ['initiative'],
    [initiativeId],
  );

  const latest = useLiveQuery(
    (store) => latestInitiativeUpdate(store, initiativeId),
    ['initiativeUpdate'],
    [initiativeId],
  );

  const watch = useLiveQuery(
    (store) => {
      if (viewer === null) return null;
      const id = store.initiativeSubscriptionIdFor(viewer.id, initiativeId);
      return id === undefined ? null : (store.get('initiativeSubscription', id) ?? null);
    },
    ['initiativeSubscription'],
    [initiativeId, viewer?.id],
  );

  if (initiative === null) {
    return (
      <EmptyState
        title="No such initiative"
        description="It may have been archived or deleted."
        action={<Button onClick={() => navigate(-1)}>Go back</Button>}
      />
    );
  }

  const confirmArchive = () => {
    setArchiveBusy(true);
    setArchiveError(null);
    archiveInitiative(engine, initiative.id)
      .then(() => {
        setArchiveBusy(false);
        setArchiving(false);
        void navigate('/initiatives');
      })
      .catch((failure: unknown) => {
        setArchiveBusy(false);
        setArchiveError(
          failure instanceof ApiError ? failure.message : 'That initiative could not be archived.',
        );
      });
  };

  const base = `/initiative/${initiative.id}`;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{initiative.name}</h1>
          {latest !== undefined && <ProjectHealthBadge health={latest.health} />}
          <span className={styles.status}>{formatInitiativeStatus(initiative.status)}</span>
          {viewer !== null && viewer.role !== 'guest' ? (
            <SubscribeBell
              menuLabel="Initiative notifications"
              flags={[
                {
                  id: 'issuesAdded',
                  label: 'An issue is added to a linked project',
                  on: watch?.issuesAdded === true,
                },
                {
                  id: 'issuesCompleted',
                  label: 'An issue in a linked project is completed',
                  on: watch?.issuesCompleted === true,
                },
                { id: 'updates', label: 'A new update is posted', on: watch?.updates === true },
              ]}
              onToggle={(id) => {
                setInitiativeSubscription(engine, {
                  initiativeId: initiative.id,
                  userId: viewer.id,
                  issuesAdded:
                    id === 'issuesAdded' ? watch?.issuesAdded !== true : watch?.issuesAdded === true,
                  issuesCompleted:
                    id === 'issuesCompleted'
                      ? watch?.issuesCompleted !== true
                      : watch?.issuesCompleted === true,
                  updates: id === 'updates' ? watch?.updates !== true : watch?.updates === true,
                }).catch(report);
              }}
            />
          ) : null}
          <Button variant="ghost" onClick={() => setArchiving(true)}>
            Archive
          </Button>
        </div>
        <nav className={styles.tabs} aria-label="Initiative sections">
          <NavLink to={base} end className={tabClass}>
            Overview
          </NavLink>
          <NavLink to={`${base}/activity`} className={tabClass}>
            Activity
          </NavLink>
        </nav>
      </header>
      <div className={styles.body}>
        <Outlet />
      </div>
      <ConfirmDialog
        open={archiving}
        title={`Archive ${initiative.name}?`}
        consequence="It leaves the Initiatives list. Linked projects stay where they are. There is no archives page for initiatives yet, so bringing it back is an API call."
        confirmLabel="Archive"
        destructive
        busy={archiveBusy}
        error={archiveError ?? undefined}
        onConfirm={confirmArchive}
        onClose={() => {
          if (archiveBusy) return;
          setArchiving(false);
          setArchiveError(null);
        }}
      />
    </div>
  );
}
