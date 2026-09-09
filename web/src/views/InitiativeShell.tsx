/**
 * The frame every initiative tab hangs in: where you are, what it is called, and everything
 * you can do to the initiative as a whole.
 *
 * It is one header row, which is what the project screen and Linear both draw. It used to be
 * three — a breadcrumb, then the title with a status pill and a health badge beside it, then
 * the tabs — so a third of the screen was chrome before the page began, and the same name
 * appeared twice in the top two rows. The name is the last crumb now, and it is still the
 * field the initiative is renamed in: read hundreds of times, renamed once, so at rest it is
 * text and it becomes a control when you put the caret in it.
 *
 * The status pill moved into the body's Properties row, where the rest of the properties
 * already are: a pill in the header was a seventh property kept apart from the other six for
 * no reason but the order the screen was built in. Health did not move, and sits beside the
 * name the way the project header's does — it is the one fact a reader wants in the same
 * glance as the name, and it belongs to the initiative rather than to the tab, so it has to
 * be readable from Activity too.
 *
 * The tabs get a row of their own, with the rail toggle at its far end — the rail belongs to
 * the Overview but the toggle belongs here, so that hiding it survives a trip to Activity and
 * back. See `features/initiatives/rail.ts` for why the state travels down the outlet.
 *
 * The shortcuts are the shell's where the controls are: `e` renames, and the `…` items each
 * have an action so the keyboard and the menu cannot drift. `s`, `a` and `shift+t` belong to
 * the property row that owns those triggers. `useKeyContext('detail')` is pushed here rather
 * than in the body so that the Activity tab gets them too.
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
  Tabs,
  TitleField,
  type MenuNode,
  type TitleHandle,
} from '~/components';
import { DotsGlyph, StarGlyph } from '~/features/issue/glyphs';
import { EntityLoading, useEntityState } from '~/features/entity-gate/EntityGate';
import { entityRowMenuItems } from '~/features/entity/entityRowMenu';
import { copyText } from '~/features/github/copy';
import { EntityIcon } from '~/features/icon/EntityIcon';
import { IconPicker } from '~/features/icon/IconPicker';
import { DEFAULT_ENTITY_COLOR } from '~/features/icon/glyphs';
import { InitiativeGlyph, RailGlyph } from '~/features/initiatives/glyphs';
import { latestInitiativeUpdate } from '~/features/initiative-updates/helpers';
import { ProjectHealthBadge } from '~/features/project-updates/ProjectHealthBadge';
import {
  INITIATIVE_RAIL_ID,
  INITIATIVE_RAIL_KEY,
  type InitiativeOutletContext,
} from '~/features/initiatives/rail';
import { archiveInitiative, updateInitiative } from '~/features/initiatives/mutations';
import { report } from '~/features/issue/mutations';
import { setInitiativeSubscription } from '~/features/subscriptions/mutations';
import { SubscribeBell } from '~/features/subscriptions/SubscribeBell';
import { readCollapsed, writeCollapsed } from '~/features/view/collapse';
import { isFavorite, toggleFavorite } from '~/features/view/mutations';
import { useContextMenu } from '~/hooks/useContextMenu';
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
  const more = useMenuTrigger();
  const iconPicker = useMenuTrigger('dialog');
  const contextMenu = useContextMenu<string>();
  const [railOpen, setRailOpen] = useState(
    () => !readCollapsed(INITIATIVE_RAIL_KEY).has(INITIATIVE_RAIL_ID),
  );

  const toggleRail = () => {
    setRailOpen((open) => {
      // Read-modify-write against storage: the rail's own sections share this key, and one
      // of them may have been folded in another tab since this was read.
      const stored = new Set(readCollapsed(INITIATIVE_RAIL_KEY));
      if (open) stored.add(INITIATIVE_RAIL_ID);
      else stored.delete(INITIATIVE_RAIL_ID);
      writeCollapsed(INITIATIVE_RAIL_KEY, stored);
      return !open;
    });
  };

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
        id: 'initiative.rail',
        title: 'Show or hide the initiative properties',
        when: 'detail',
        group: 'Initiatives',
        run: toggleRail,
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

  const closeMenus = () => {
    more.hide();
    contextMenu.close();
  };

  /**
   * `Initiatives.tsx`'s menu, from the same builder so the wording and order stay shared.
   * `Open initiative` is dropped — this is the initiative it would open — and `Copy ID` rides
   * in the properties slot, which the list has no equivalent for. There is no Delete because
   * an initiative has never had one; archiving is the only way out, on both screens.
   */
  const moreItems = (): MenuNode[] =>
    entityRowMenuItems(
      { noun: 'initiative', name: initiative.name, favorited: favourite },
      {
        copyLink: () => {
          closeMenus();
          void copyText(`${window.location.origin}/initiative/${initiative.id}`);
        },
        ...(viewerId === null
          ? {}
          : {
              toggleFavorite: () => {
                closeMenus();
                toggleFavorite(engine, viewerId, 'initiative', initiative.id).catch(report);
              },
            }),
        properties: [
          {
            id: 'copy-id',
            label: 'Copy ID',
            onSelect: () => {
              closeMenus();
              void copyText(initiative.id);
            },
          },
        ],
        archive: () => {
          closeMenus();
          setArchiving(true);
        },
      },
    );

  const base = `/initiative/${initiative.id}`;

  return (
    <div className={styles.screen}>
      <header
        className={styles.header}
        onContextMenu={(event) => {
          // A descendant that already answered this right-click owns it: two menus at once
          // means neither can be clicked.
          if (event.defaultPrevented) return;
          event.preventDefault();
          contextMenu.openAt(event.clientX, event.clientY, initiative.id);
        }}
      >
        {/* The name is the rename field in the last crumb, so the screen would otherwise
            have no heading at all. Hidden the way `IssueDetail`'s `.screenTitle` is: a
            `<textarea>` inside an `<h1>` gives the heading no name, and the heading list is
            how somebody with a screen reader finds out which initiative they opened. */}
        <h1 className={styles.screenTitle}>{initiative.name}</h1>
        <Breadcrumb
          className={styles.crumbs}
          items={[
            { label: 'Initiatives', to: '/initiatives' },
            {
              // `control` rather than `icon`: the mark is a button now, and the icon slot
              // is aria-hidden — a focusable control inside it is a tab stop nothing
              // announces. This is where the eye already goes to check which initiative is
              // open, so it is where the glyph is changed.
              control: (
                <button
                  {...iconPicker.props}
                  type="button"
                  className={styles.markButton}
                  aria-label="Change initiative icon"
                >
                  <EntityIcon
                    icon={initiative.icon}
                    color={initiative.color ?? DEFAULT_ENTITY_COLOR}
                    fallback={<InitiativeGlyph />}
                    size="md"
                  />
                </button>
              ),
              label: (
                <TitleField
                  key={`initiative-title-${initiative.id}`}
                  subjectId={initiative.id}
                  value={initiative.name}
                  label="Name"
                  size="md"
                  handle={titleRef}
                  className={styles.titleField}
                  onSave={(name) => updateInitiative(engine, initiative.id, { name }).catch(report)}
                />
              ),
            },
          ]}
        />
        {/* Beside the name rather than in the trailing group: health is the one fact a
            reader wants in the same glance as the initiative. */}
        {latest === undefined ? null : <ProjectHealthBadge health={latest.health} compact />}
        <div className={styles.headerEnd}>
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
              className={favourite ? styles.starOn : undefined}
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
      </header>

      <div className={styles.tabRow}>
        <Tabs
          aria-label="Initiative sections"
          className={styles.tabs}
          items={[
            { id: 'overview', label: 'Overview', to: base, end: true },
            { id: 'activity', label: 'Activity', to: `${base}/activity` },
          ]}
        />
        <IconButton
          icon={<RailGlyph />}
          aria-label={railOpen ? 'Hide properties' : 'Show properties'}
          aria-pressed={railOpen}
          onClick={toggleRail}
        />
      </div>

      <Menu
        open={more.open}
        onClose={more.hide}
        trigger={more.ref}
        label="More actions"
        placement="bottom-end"
        items={moreItems()}
      />

      {contextMenu.at === null ? null : <div {...contextMenu.anchorProps} />}
      <Menu
        open={contextMenu.at !== null}
        onClose={contextMenu.close}
        trigger={contextMenu.anchorRef}
        label={`Options for ${initiative.name}`}
        items={moreItems()}
      />

      <div className={styles.body}>
        <Outlet context={{ railOpen } satisfies InitiativeOutletContext} />
      </div>
      <IconPicker
        open={iconPicker.open}
        onClose={iconPicker.hide}
        trigger={iconPicker.ref}
        value={{ icon: initiative.icon ?? '', color: initiative.color ?? DEFAULT_ENTITY_COLOR }}
        onChange={(next) => {
          // One half per act — the picker never sends both, so neither does the mutation.
          const fields =
            next.icon === (initiative.icon ?? '') ? { color: next.color } : { icon: next.icon };
          void updateInitiative(engine, initiative.id, fields).catch(report);
        }}
        actionId="initiative.closeHeaderIconPicker"
        label="Initiative icon"
      />

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
