/**
 * The frame every initiative tab hangs in: where you are, what it is called, and everything
 * you can do to the initiative as a whole.
 *
 * It is one header row, which is what the project screen and Linear both draw. It used to be
 * three — a breadcrumb, then the title with a status pill and a health badge beside it, then
 * the tabs — so a third of the screen was chrome before the page began.
 *
 * The name, the mark beside it and the properties are the body's now, at the top of the
 * reading column where Linear puts them and where the page is actually read. The trail keeps
 * a plain copy of the name, because a trail says where you are; it is not a second place to
 * rename anything. Everything that acts on the initiative as a whole — the star, the `…` —
 * stays here, and the body's title block answers a right-click by asking this shell to open
 * that same menu.
 *
 * The tabs get a row of their own, with the rail toggle at its far end — the rail belongs to
 * the Overview but the toggle belongs here, so that hiding it survives a trip to Activity and
 * back. See `features/initiatives/rail.ts` for why the state travels down the outlet.
 *
 * The shortcuts are the shell's where the controls are: the `…` items each have an action so
 * the keyboard and the menu cannot drift. `e`, `s`, `a` and `shift+t` moved to the body with
 * the controls they open. `useKeyContext('detail')` is pushed here rather than in the body so
 * that the Activity tab gets them too.
 */

import { useState } from 'react';
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
  type MenuNode,
} from '~/components';
import { DotsGlyph, StarGlyph } from '~/features/issue/glyphs';
import { EntityLoading, useEntityState } from '~/features/entity-gate/EntityGate';
import { entityRowMenuItems } from '~/features/entity/entityRowMenu';
import { copyText } from '~/features/github/copy';
import { EntityIcon } from '~/features/icon/EntityIcon';
import { IconPicker } from '~/features/icon/IconPicker';
import { DEFAULT_ENTITY_COLOR } from '~/features/icon/glyphs';
import { InitiativeGlyph, RailGlyph } from '~/features/initiatives/glyphs';
import {
  INITIATIVE_RAIL_ID,
  INITIATIVE_RAIL_KEY,
  type InitiativeOutletContext,
} from '~/features/initiatives/outlet';
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
              // Plain text: a trail says where you are. The name is renamed in the body,
              // where it is the page's heading rather than a step in a path.
              label: initiative.name,
            },
          ]}
        />
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
        <Outlet
          context={
            {
              railOpen,
              // The body's title block is where the name and the mark are now, so it is
              // where a right-click on "this initiative" lands. It has no menu of its own.
              openMenuAt: (x: number, y: number) => contextMenu.openAt(x, y, initiative.id),
            } satisfies InitiativeOutletContext
          }
        />
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
