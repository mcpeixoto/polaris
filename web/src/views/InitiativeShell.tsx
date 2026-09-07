/**
 * The frame every initiative tab hangs in: where you are, what it is called, what state it
 * is in, and everything you can do to the initiative as a whole.
 *
 * It is built to the shape `IssueDetail` established, because an initiative is a detail
 * screen and there is no reason for it to be a different one. The trail says where the page
 * sits; the name is edited in place rather than through a form field two sections down; the
 * status is a pill that opens the same menu the rest of the product opens; and the acts that
 * are not everyday — archive, copy, favourite — sit behind the `…` menu instead of standing
 * permanently in the header. Archive used to be a bare ghost button beside the title, which
 * put a destructive act at the top of the screen on every visit and gave the four commands
 * beside it nowhere to live.
 *
 * The shortcuts are the shell's because the controls are: `e` renames, `s` opens the status
 * menu, and the `…` items each have an action so the keyboard and the menu cannot drift.
 * `useKeyContext('detail')` is pushed here rather than in the body so that the Activity tab
 * gets them too.
 */

import { useRef, useState } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext } from '~/app/keymap';
import {
  Breadcrumb,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Menu,
  StateIcon,
  Tabs,
  TitleField,
  type MenuNode,
  type TitleHandle,
} from '~/components';
import { DotsGlyph, StarGlyph } from '~/features/issue/glyphs';
import { EntityLoading, useEntityState } from '~/features/entity-gate/EntityGate';
import { copyText } from '~/features/github/copy';
import { InitiativeGlyph } from '~/features/initiatives/glyphs';
import {
  archiveInitiative,
  formatInitiativeStatus,
  INITIATIVE_STATUS_ICON,
  INITIATIVE_STATUSES,
  updateInitiative,
} from '~/features/initiatives/mutations';
import { report } from '~/features/issue/mutations';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import { latestInitiativeUpdate } from '~/features/initiative-updates/helpers';
import { setInitiativeSubscription } from '~/features/subscriptions/mutations';
import { SubscribeBell } from '~/features/subscriptions/SubscribeBell';
import { isFavorite, toggleFavorite } from '~/features/view/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewer, useViewerId } from '~/hooks/useViewer';
import { ApiError } from '~/sync/api';
import styles from './InitiativeShell.module.css';

export function InitiativeShell() {
  const engine = useEngine();
  const navigate = useNavigate();
  const { initiativeId = '' } = useParams<{ initiativeId: string }>();
  const viewer = useViewer();
  const viewerId = useViewerId();
  const [archiving, setArchiving] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const titleRef = useRef<TitleHandle | null>(null);
  const status = useMenuTrigger();
  const more = useMenuTrigger();

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

  const favourite = useLiveQuery(
    (store) =>
      viewerId === null ? false : isFavorite(store, viewerId, 'initiative', initiativeId),
    ['favorite'],
    [initiativeId, viewerId ?? ''],
  );

  const state = useEntityState(initiative);

  const watch = useLiveQuery(
    (store) => {
      if (viewer === null) return null;
      const id = store.initiativeSubscriptionIdFor(viewer.id, initiativeId);
      return id === undefined ? undefined : (store.get('initiativeSubscription', id) ?? undefined);
    },
    ['initiativeSubscription'],
    [initiativeId, viewer?.id],
  );

  useActions(
    [
      {
        id: 'initiative.rename',
        title: 'Rename initiative',
        keys: ['e'],
        when: 'detail',
        group: 'Initiatives',
        run: () => titleRef.current?.focus(),
      },
      {
        id: 'initiative.rename.cancel',
        title: 'Stop renaming the initiative',
        keys: ['Escape'],
        when: 'detail',
        group: 'Initiatives',
        enabled: () => titleRef.current?.editing() === true,
        run: () => titleRef.current?.revert(),
      },
      {
        id: 'initiative.status',
        title: 'Set initiative status',
        keys: ['s'],
        when: 'detail',
        group: 'Initiatives',
        run: () => status.show(),
      },
      {
        id: 'initiative.favorite',
        title: 'Favourite initiative',
        when: 'detail',
        group: 'Initiatives',
        available: () => viewerId !== null,
        run: () => {
          if (viewerId === null) return;
          toggleFavorite(engine, viewerId, 'initiative', initiativeId).catch(report);
        },
      },
      {
        id: 'initiative.copyLink',
        title: 'Copy link to initiative',
        when: 'detail',
        group: 'Initiatives',
        run: () => void copyText(`${window.location.origin}/initiative/${initiativeId}`),
      },
      {
        id: 'initiative.archive',
        title: 'Archive initiative',
        when: 'detail',
        group: 'Initiatives',
        run: () => setArchiving(true),
      },
    ],
    [initiativeId, viewerId ?? ''],
  );

  useKeyContext('detail');

  if (state === 'loading') return <EntityLoading label="Loading initiative…" lines={4} />;
  // `useLiveQuery` answers null for an initiative that is absent and for one still on the
  // wire alike, and the shell mounts before the first snapshot lands. Without the gate,
  // every deep link on a cold start flashed "No such initiative" over a row that was about
  // to arrive.
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

  const statusItems: MenuNode[] = INITIATIVE_STATUSES.map((value) => ({
    id: value,
    label: formatInitiativeStatus(value),
    icon: <StateIcon category={INITIATIVE_STATUS_ICON[value]} decorative />,
    selected: value === initiative.status,
    onSelect: () => {
      updateInitiative(engine, initiative.id, { status: value }).catch(report);
    },
  }));

  const moreItems: MenuNode[] = [
    {
      id: 'copy-link',
      label: 'Copy link',
      onSelect: () => void copyText(`${window.location.origin}/initiative/${initiative.id}`),
    },
    { id: 'copy-id', label: 'Copy ID', onSelect: () => void copyText(initiative.id) },
    ...(viewerId === null
      ? []
      : [
          {
            id: 'favourite',
            label: favourite ? 'Remove from favourites' : 'Add to favourites',
            onSelect: () => {
              toggleFavorite(engine, viewerId, 'initiative', initiative.id).catch(report);
            },
          } satisfies MenuNode,
        ]),
    { kind: 'separator' },
    {
      id: 'archive',
      label: 'Archive initiative',
      danger: true,
      onSelect: () => setArchiving(true),
    },
  ];

  const base = `/initiative/${initiative.id}`;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.crumbRow}>
          <Breadcrumb
            items={[
              { label: 'Initiatives', to: '/initiatives' },
              { label: initiative.name, icon: <InitiativeGlyph /> },
            ]}
          />
          <div className={styles.spacer} />
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
                    id === 'issuesAdded'
                      ? watch?.issuesAdded !== true
                      : watch?.issuesAdded === true,
                  issuesCompleted:
                    id === 'issuesCompleted'
                      ? watch?.issuesCompleted !== true
                      : watch?.issuesCompleted === true,
                  updates: id === 'updates' ? watch?.updates !== true : watch?.updates === true,
                }).catch(report);
              }}
            />
          ) : null}
          {viewerId === null ? null : (
            <IconButton
              icon={<StarGlyph on={favourite} />}
              aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'}
              aria-pressed={favourite}
              onClick={() =>
                toggleFavorite(engine, viewerId, 'initiative', initiative.id).catch(report)
              }
            />
          )}
          <IconButton
            {...more.props}
            variant="secondary"
            icon={<DotsGlyph />}
            aria-label="More actions"
          />
        </div>

        <div className={styles.titleRow}>
          {/* The heading is text and the editable name is the field beside it, hidden the
              way `IssueDetail`'s `.screenTitle` is. A `<textarea>` inside an `<h1>` gives
              the heading no name at all, and the heading list is how somebody arriving with
              a screen reader finds out where they are. */}
          <h1 className={styles.screenTitle}>{initiative.name}</h1>
          <TitleField
            key={`initiative-title-${initiative.id}`}
            subjectId={initiative.id}
            value={initiative.name}
            label="Name"
            handle={titleRef}
            className={styles.titleField}
            onSave={(name) => updateInitiative(engine, initiative.id, { name }).catch(report)}
          />
          {latest !== undefined && <ProjectHealthBadge health={latest.health} />}
          <Button
            {...status.props}
            variant="pill"
            icon={<StateIcon category={INITIATIVE_STATUS_ICON[initiative.status]} decorative />}
          >
            {formatInitiativeStatus(initiative.status)}
          </Button>
        </div>

        <Tabs
          aria-label="Initiative sections"
          items={[
            { id: 'overview', label: 'Overview', to: base, end: true },
            { id: 'activity', label: 'Activity', to: `${base}/activity` },
          ]}
        />
      </header>

      <Menu
        open={status.open}
        onClose={status.hide}
        trigger={status.ref}
        label="Status"
        items={statusItems}
      />
      <Menu
        open={more.open}
        onClose={more.hide}
        trigger={more.ref}
        label="More actions"
        placement="bottom-end"
        items={moreItems}
      />

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
