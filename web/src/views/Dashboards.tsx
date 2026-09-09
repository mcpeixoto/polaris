/**
 * Workspace dashboards — pages of Insights tiles over the replica.
 *
 * A dashboard's scope — Personal, Workspace, or a team's — was already computed here, and
 * then spent entirely on the sort: the list came out with the personal ones first and
 * nothing on screen said why. Scope is the one fact that changes what a row *is* (who else
 * can see it, whose page it is), so it is drawn as the group it sorts into. `ListGroup`
 * remembers the fold per person, which is what makes a workspace with forty team boards
 * usable by somebody who only ever opens their own two.
 *
 * The row carries an owner and a last-touched time, because "which of these four burn-ups
 * is the one we actually keep up to date" is the question a list of names cannot answer.
 *
 * Row actions are in a `…` menu and on right-click, from one list of items so the two agree.
 * `FavoriteKind` has a `dashboard` now, so the API accepts the write and the sidebar draws
 * the row; the star is not in this menu yet, which is a gap in this file rather than in the
 * kind. Duplicate is composed out of the create and the
 * tile create rather than a mutation of its own — the API has no copy — which is why it
 * copies the tiles one at a time and says so if the copy stops half way.
 */

import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext, useKeymap } from '~/app/keymap';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  ListGroup,
  Menu,
  type MenuNode,
} from '~/components';
import {
  createDashboard,
  createDashboardTile,
  deleteDashboard,
  renameDashboard,
} from '~/features/dashboards/mutations';
import { EntityLoading, useStoreSettled } from '~/features/entity-gate/EntityGate';
import { CopyGlyph, DotsGlyph, PencilGlyph, TrashGlyph } from '~/features/issue/glyphs';
import { plural } from '~/features/insights/plural';
import { personName } from '~/features/prefs/prefs';
import { when } from '~/features/time';
import { useContextMenu } from '~/hooks/useContextMenu';
import { listRowDomId, useListCursor } from '~/hooks/useListCursor';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerId } from '~/hooks/useViewer';
import type { Store, UUID } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './Dashboards.module.css';

const PREFERENCE_KEY = 'dashboards';

/** The three scopes, in the order a person reads them: mine, everyone's, each team's. */
type ScopeKind = 'personal' | 'workspace' | 'team';

interface DashboardRow {
  readonly id: UUID;
  readonly name: string;
  readonly description: string;
  readonly scope: string;
  readonly scopeKind: ScopeKind;
  readonly ownerName: string;
  readonly updatedAt: string;
  readonly tileCount: number;
}

interface Group {
  readonly key: string;
  readonly name: string;
  readonly rows: readonly DashboardRow[];
}

export function Dashboards() {
  const engine = useEngine();
  const navigate = useNavigate();
  const { registry, context } = useKeymap();
  const viewerId = useViewerId();
  const create = () => registry.invoke('dashboard.create', { source: 'menu', context });
  const settled = useStoreSettled();

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuRow, setMenuRow] = useState<DashboardRow | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const [renaming, setRenaming] = useState<UUID | null>(null);
  const [deleting, setDeleting] = useState<DashboardRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const rows = useLiveQuery(
    (store) => listDashboards(store, viewerId),
    ['dashboard', 'dashboardTile', 'team', 'user'],
    [viewerId],
  );

  const groups = useMemo(() => groupRows(rows), [rows]);

  // A folded group's rows are not in the cursor's list: `j` through rows nobody can see is
  // a cursor pointing at nothing, and Enter on one opens a page out of nowhere.
  const ids = useMemo(
    () =>
      groups.flatMap((group) => (collapsed.has(group.key) ? [] : group.rows.map((row) => row.id))),
    [groups, collapsed],
  );

  useKeyContext('list');
  const cursor = useListCursor({
    ids,
    prefix: 'dashboardList',
    noun: 'dashboard',
    onOpen: (id) => void navigate(`/dashboard/${id}`),
  });

  const contextMenu = useContextMenu<UUID>({
    onOpen: (id) => cursor.setCursor(id),
    returnFocusTo: scrollerRef,
  });

  useActions(
    [
      {
        id: 'dashboardList.rename',
        title: 'Rename dashboard',
        keys: ['e'],
        when: 'list',
        group: 'Dashboards',
        enabled: () => cursor.cursorId !== null,
        run: () => setRenaming(cursor.cursorId),
      },
    ],
    [cursor.cursorId],
  );

  const closeMenus = () => {
    setMenuOpen(false);
    setMenuRow(null);
    contextMenu.close();
  };

  const rename = (id: UUID, name: string) => {
    setRenaming(null);
    const trimmed = name.trim();
    const row = rows.find((candidate) => candidate.id === id);
    // An emptied name is not a rename, and neither is the name it already has.
    if (row === undefined || trimmed === '' || trimmed === row.name) return;
    setFailure(null);
    void renameDashboard(engine, id, trimmed).catch((error: unknown) =>
      setFailure(messageOf(error, 'That name could not be saved.')),
    );
  };

  const duplicate = async (row: DashboardRow) => {
    closeMenus();
    setFailure(null);
    try {
      const id = await createDashboard(engine, {
        name: `${row.name} copy`,
        description: row.description,
        ...(row.scopeKind === 'personal' && viewerId !== null
          ? { private: true, ownerId: viewerId }
          : null),
        ...(engine.store.get('dashboard', row.id)?.teamId === undefined
          ? null
          : { teamId: engine.store.get('dashboard', row.id)?.teamId }),
      });
      // Tiles are their own rows and their own mutation, so a copy is a copy of each. In
      // order, because a dashboard's tiles are positioned and a fan-out would land them in
      // whatever order the server finished in.
      for (const tileId of engine.store.tileIdsForDashboard(row.id)) {
        const tile = engine.store.dashboardTiles.get(tileId);
        if (tile === undefined) continue;
        await createDashboardTile(engine, {
          dashboardId: id,
          title: tile.title,
          measure: tile.measure,
          slice: tile.slice,
          display: tile.display,
          filter: tile.filter,
        });
      }
      void navigate(`/dashboard/${id}`);
    } catch (error) {
      setFailure(messageOf(error, 'That dashboard could not be duplicated.'));
    }
  };

  const confirmDelete = () => {
    if (deleting === null) return;
    setDeleteBusy(true);
    setFailure(null);
    void deleteDashboard(engine, deleting.id)
      .then(() => setDeleting(null))
      .catch((error: unknown) => setFailure(messageOf(error, 'That dashboard was not deleted.')))
      .finally(() => setDeleteBusy(false));
  };

  /** One menu, whichever way it was opened: the ⋯ button and the right-click agree. */
  const itemsFor = (row: DashboardRow): MenuNode[] => [
    {
      id: 'rename',
      label: 'Rename',
      icon: <PencilGlyph />,
      keys: 'e',
      onSelect: () => {
        closeMenus();
        setRenaming(row.id);
      },
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: <CopyGlyph />,
      onSelect: () => void duplicate(row),
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <TrashGlyph />,
      danger: true,
      onSelect: () => {
        closeMenus();
        setFailure(null);
        setDeleting(row);
      },
    },
  ];

  const contextRow =
    contextMenu.id === null ? null : (rows.find((row) => row.id === contextMenu.id) ?? null);

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Dashboards</h1>
        <Button variant="primary" onClick={create}>
          New dashboard
        </Button>
      </header>

      {failure === null ? null : (
        <p className={styles.error} role="alert">
          {failure}
        </p>
      )}

      {rows.length === 0 && !settled ? (
        // "No dashboards yet" is a claim, and on a cold start it was one the client could
        // not yet make: the list is empty because the snapshot has not landed.
        <EntityLoading label="Loading dashboards…" lines={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No dashboards yet"
          description="A dashboard is a page of Insights tiles — issue count, effort, cycle time — over the live replica."
          action={
            <Button variant="primary" onClick={create}>
              New dashboard
            </Button>
          }
        />
      ) : (
        <div
          ref={scrollerRef}
          className={styles.list}
          role="listbox"
          aria-label="Dashboards"
          aria-activedescendant={
            cursor.cursorId === null ? undefined : listRowDomId('dashboardList', cursor.cursorId)
          }
          tabIndex={0}
        >
          {groups.map((group) => (
            <ListGroup
              key={group.key}
              groupKey={group.key}
              preferenceKey={PREFERENCE_KEY}
              name={group.name}
              count={group.rows.length}
              onToggle={(key, shut) =>
                setCollapsed((held) => {
                  const next = new Set(held);
                  if (shut) next.add(key);
                  else next.delete(key);
                  return next;
                })
              }
            >
              <ul role="presentation" className={styles.groupList}>
                {group.rows.map((row) => (
                  <li
                    key={row.id}
                    {...cursor.rowProps(row.id)}
                    role="option"
                    className={[styles.item, row.id === cursor.cursorId ? styles.cursorItem : null]
                      .filter(Boolean)
                      .join(' ')}
                    onContextMenu={(event) => {
                      contextMenu.openFromEvent(event, row.id);
                    }}
                  >
                    {renaming === row.id ? (
                      // Committed on blur, like the dashboard's own title field. Enter is
                      // the list's Open action and belongs to the registry, so a rename that
                      // needed a key of its own here would be a second keyboard.
                      <span className={styles.renaming}>
                        <Input
                          label={`Rename ${row.name}`}
                          hideLabel
                          // Focused in the following frame, not with `autoFocus`: the menu
                          // this was chosen from hands focus back to its trigger as it
                          // closes, and a field focused inside that same tick is blurred by
                          // the restore — which commits the rename and shuts the editor
                          // before anybody can type in it.
                          ref={(node) => {
                            if (node !== null) requestAnimationFrame(() => node.focus());
                          }}
                          defaultValue={row.name}
                          onBlur={(event) => rename(row.id, event.target.value)}
                        />
                      </span>
                    ) : (
                      <Link
                        to={`/dashboard/${row.id}`}
                        className={styles.row}
                        onClick={() => cursor.setCursor(row.id)}
                      >
                        <span className={styles.body}>
                          <span className={styles.name}>{row.name}</span>
                          {row.description !== '' && (
                            <span className={styles.summary}>{row.description}</span>
                          )}
                        </span>
                        <span className={styles.owner}>{row.ownerName}</span>
                        <span className={styles.updated}>{when(row.updatedAt)}</span>
                        <span className={styles.count}>{plural(row.tileCount, 'tiles')}</span>
                      </Link>
                    )}
                    <IconButton
                      aria-label={`Options for ${row.name}`}
                      size="sm"
                      className={styles.menuButton}
                      onClick={(event) => {
                        event.preventDefault();
                        menuTriggerRef.current = event.currentTarget;
                        cursor.setCursor(row.id);
                        setMenuRow(row);
                        setMenuOpen(true);
                      }}
                      icon={<DotsGlyph />}
                    />
                  </li>
                ))}
              </ul>
            </ListGroup>
          ))}
        </div>
      )}

      <Menu
        open={menuOpen}
        onClose={() => {
          setMenuOpen(false);
          setMenuRow(null);
        }}
        trigger={menuTriggerRef}
        label={menuRow === null ? 'Dashboard options' : `Options for ${menuRow.name}`}
        keysPresentation="kbd"
        density="compact"
        items={menuRow === null ? [] : itemsFor(menuRow)}
      />

      {contextMenu.at === null ? null : <div {...contextMenu.anchorProps} />}
      <Menu
        open={contextMenu.at !== null && contextRow !== null}
        onClose={contextMenu.close}
        trigger={contextMenu.anchorRef}
        label={contextRow === null ? 'Dashboard options' : `Options for ${contextRow.name}`}
        keysPresentation="kbd"
        density="compact"
        items={contextRow === null ? [] : itemsFor(contextRow)}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? 'this dashboard'}?`}
        consequence="The page and its tiles go for good. The issues they counted are untouched — a tile is a question about them, not a copy of them."
        confirmLabel="Delete dashboard"
        destructive
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** Personal first, then the workspace, then each team by its own name. */
function groupRows(rows: readonly DashboardRow[]): readonly Group[] {
  const groups: Group[] = [];
  const push = (key: string, name: string, kept: readonly DashboardRow[]) => {
    if (kept.length > 0) groups.push({ key, name, rows: kept });
  };

  push(
    'personal',
    'Personal',
    rows.filter((row) => row.scopeKind === 'personal'),
  );
  push(
    'workspace',
    'Workspace',
    rows.filter((row) => row.scopeKind === 'workspace'),
  );

  const teams = [
    ...new Set(rows.filter((row) => row.scopeKind === 'team').map((row) => row.scope)),
  ];
  for (const team of teams.sort((a, b) => a.localeCompare(b))) {
    push(
      `team:${team}`,
      team,
      rows.filter((row) => row.scopeKind === 'team' && row.scope === team),
    );
  }
  return groups;
}

function listDashboards(store: Store, viewerId: UUID | null): DashboardRow[] {
  const rows: DashboardRow[] = [];
  for (const dashboard of store.dashboards.values()) {
    if (dashboard.archivedAt !== undefined || dashboard.deletedAt !== undefined) continue;
    if (dashboard.ownerId !== undefined && dashboard.ownerId !== viewerId) continue;
    let tileCount = 0;
    for (const tileId of store.tileIdsForDashboard(dashboard.id)) {
      if (store.dashboardTiles.has(tileId)) tileCount += 1;
    }
    let scope = 'Workspace';
    let scopeKind: ScopeKind = 'workspace';
    if (dashboard.ownerId !== undefined) {
      scope = 'Personal';
      scopeKind = 'personal';
    } else if (dashboard.teamId !== undefined) {
      const team = store.teams.get(dashboard.teamId);
      scope = team?.key ?? 'Team';
      scopeKind = 'team';
    }
    const owner = dashboard.ownerId === undefined ? undefined : store.users.get(dashboard.ownerId);
    rows.push({
      id: dashboard.id,
      name: dashboard.name,
      description: dashboard.description,
      scope,
      scopeKind,
      // A dashboard nobody owns is the workspace's, and saying so is more use than a blank
      // cell that reads as missing data.
      ownerName: owner === undefined ? 'Everyone' : personName(owner),
      updatedAt: dashboard.updatedAt,
      tileCount,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}
