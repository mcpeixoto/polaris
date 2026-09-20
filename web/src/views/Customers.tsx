/**
 * Workspace customers — organisations whose feedback attaches to issues and projects.
 *
 * A customer list is the one list in the product where a name search is not a convenience:
 * customers are not filed under anything, there is no team or project to narrow by, and a
 * workspace that has been selling for a year has hundreds of them in one flat alphabet. So
 * the field is here, above the rows, and it is the only control that is always visible.
 *
 * Beside it, the two questions actually asked of this screen — which of these are live, and
 * which of them matter — as a status `SegmentedControl` and a tier column. The tier was
 * already a fact the product filtered projects by (`features/projects/customerFilter`) and
 * the screen that owns customers did not show it at all.
 *
 * One header, one body. The customer-requests-off branch used to be a second `return` with
 * a header of its own, which is how a heading drifts out of step with the heading beside it;
 * the switch now only decides what goes under the header.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';

import { useEngine } from '~/app/context';
import { useActions, useKeyContext, useKeymap } from '~/app/keymap';
import {
  Avatar,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  Menu,
  SegmentedControl,
  type MenuNode,
} from '~/components';
import { entityRowMenuItems } from '~/features/entity/entityRowMenu';
import {
  CUSTOMER_STATUSES,
  CustomerStatusPicker,
  customerStatusItems,
} from '~/features/customers/CustomerStatusPicker';
import { CustomerTierPicker } from '~/features/customers/CustomerTierPicker';
import {
  archiveCustomer,
  formatCustomerStatus,
  updateCustomer,
  type CustomerFields,
} from '~/features/customers/mutations';
import { EntityLoading, useStoreSettled } from '~/features/entity-gate/EntityGate';
import { copyText } from '~/features/github/copy';
import { DotsGlyph } from '~/features/issue/glyphs';
import { report } from '~/features/issue/mutations';
import { UserPicker } from '~/features/members/UserPicker';
import { useContextMenu } from '~/hooks/useContextMenu';
import { listRowDomId, useListCursor } from '~/hooks/useListCursor';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';
import { useViewerRole } from '~/hooks/useViewer';
import { ApiError } from '~/sync/api';
import type { CustomerStatus, Store, UUID } from '~/store';
import styles from './Customers.module.css';

/** The status filter, which is the statuses plus "all of them". */
type StatusFilter = 'all' | CustomerStatus;

/**
 * The filter above the rows, which is `CUSTOMER_STATUSES` with "all of them" in front.
 *
 * Spelled out from the picker's list rather than beside it: this screen now draws the
 * statuses in three places — the filter, the status cell, the row menu's submenu — and a
 * fourth status added to the union has to reach all three or the filter quietly hides a
 * set of customers nobody can get back.
 */
const STATUS_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...CUSTOMER_STATUSES.map((value) => ({ value, label: formatCustomerStatus(value) })),
];

/** The properties a row lets you change where they are drawn. */
type CellProperty = 'status' | 'tier' | 'owner';

/** What the rows are ordered by. Name is the default because the search is by name. */
type Sort = 'name' | 'requests';

const SORT_OPTIONS: readonly { value: Sort; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'requests', label: 'Requests' },
];

interface CustomerRow {
  readonly id: UUID;
  readonly name: string;
  readonly domains: readonly string[];
  readonly status: CustomerStatus;
  readonly tier: string | null;
  readonly ownerName: string | null;
  readonly ownerId: UUID | undefined;
  readonly requestCount: number;
}

export function Customers() {
  const navigate = useNavigate();
  const engine = useEngine();
  const { registry, context } = useKeymap();
  const viewerRole = useViewerRole();
  // An empty replica and an empty workspace look identical from here, and only one of them
  // should be told "No customers yet" with a button to make the first one.
  const settled = useStoreSettled();
  const create = () => registry.invoke('customer.create', { source: 'menu', context });

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<Sort>('name');
  const [failure, setFailure] = useState<string | null>(null);
  /** Which customer archive was asked about, and whether its request is in flight. */
  const [confirming, setConfirming] = useState<{ readonly id: UUID; readonly name: string } | null>(
    null,
  );
  const [archiving, setArchiving] = useState(false);
  // One ⋯ menu shared by every row, anchored to whichever button opened it: a trigger ref
  // per row would be a ref per customer, rebuilt on every delta.
  const [rowMenuId, setRowMenuId] = useState<UUID | null>(null);
  const [rowMenuOpen, setRowMenuOpen] = useState(false);
  const rowMenuTrigger = useRef<HTMLButtonElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  /**
   * The one property picker the rows share, and which property of which customer it holds.
   *
   * One picker rather than one per row, for the reason `useMenuTrigger` spells out: a row
   * that scrolls out of the list unmounts and would take its menu with it, and three
   * pickers per row is three live queries per row to serve the one that is open.
   * `showFrom` moves the anchor to whichever cell was pressed, so the singleton still opens
   * under the right glyph. Only one can be up at a time, which is why the kind lives beside
   * the customer id rather than in a boolean each.
   */
  const cellPicker = useMenuTrigger<HTMLElement>();
  const [editing, setEditing] = useState<{
    readonly kind: CellProperty;
    readonly id: UUID;
  } | null>(null);

  const openCellPicker = (kind: CellProperty, id: UUID, element: HTMLElement) => {
    setEditing({ kind, id });
    cellPicker.showFrom(element);
  };

  const cellOpen = (kind: CellProperty, id: UUID): boolean =>
    cellPicker.open && editing?.kind === kind && editing.id === id;

  /**
   * The same pickers, opened from a row menu instead of from a cell.
   *
   * This exists because a right-click has no control to hang a menu off — the user aimed at
   * a row — and the one-pixel anchor `useContextMenu` renders is unmounted by the close that
   * precedes the picker opening. So the point is kept here and a fresh anchor drawn at it,
   * the same trade `views/Projects.tsx` makes. The ⋯ menu needs none of this: its button is
   * part of the row and outlives the menu, so that path goes through `openCellPicker`.
   */
  const [menuPicker, setMenuPicker] = useState<{
    readonly kind: CellProperty;
    readonly id: UUID;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const pickerAnchorRef = useRef<HTMLDivElement>(null);

  const workspace = useLiveQuery(
    (store) => store.workspaces.get(store.workspaceId) ?? null,
    ['workspace'],
  );

  const all = useLiveQuery(
    (store) => listCustomers(store),
    ['customer', 'customerRequest', 'user'],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const kept = all.filter((row) => {
      if (status !== 'all' && row.status !== status) return false;
      if (needle === '') return true;
      // The domain is part of the name for searching: "acme.com" is how half the workspace
      // refers to Acme, and a search that only matched the display name would miss it.
      return (
        row.name.toLowerCase().includes(needle) ||
        row.domains.some((domain) => domain.toLowerCase().includes(needle))
      );
    });
    return [...kept].sort((a, b) =>
      sort === 'requests' ? b.requestCount - a.requestCount : a.name.localeCompare(b.name),
    );
  }, [all, query, status, sort]);

  const ids = useMemo(() => rows.map((row) => row.id), [rows]);

  useKeyContext('list');
  const cursor = useListCursor({
    ids,
    prefix: 'customerList',
    noun: 'customer',
    onOpen: (id) => void navigate(`/customer/${id}`),
  });

  const contextMenu = useContextMenu<UUID>({
    onOpen: (id) => cursor.setCursor(id),
    returnFocusTo: scrollerRef,
  });

  useActions(
    [
      {
        // Archive and the status change live in the row menu, and a Mac laptop sends
        // neither Shift+F10 nor a Menu key — so without a chord the whole of it was a
        // pointer-only affordance on a screen whose own search box is keyboard-first.
        id: 'customers.actions',
        title: 'Show actions for the customer',
        keys: ['.'],
        when: 'list',
        group: 'Customers',
        enabled: () => cursor.cursorId !== null,
        run: () => {
          const id = cursor.cursorId;
          if (id === null) return;
          const element = document.getElementById(listRowDomId('customerList', id));
          if (element === null) return;
          contextMenu.openOn(element, id);
        },
      },
    ],
    [],
  );

  // A guest sees nothing customer-shaped, the sidebar link included — so the URL typed in
  // by hand has to say so too. The role comes from the session because a guest's replica
  // holds no `user` rows to read a profile out of.
  if (viewerRole === 'guest') {
    return <Navigate to="/" replace />;
  }

  const disabled = workspace !== null && !workspace.customerRequestsEnabled;

  /**
   * The tiers an admin has named, which decides whether the tier column is a control at all.
   *
   * A tier is free text — `customer.tier` is a string the API takes as given — and a
   * workspace that has never filled this list in has nothing to choose between. Where that
   * is the case the column stays what it was, and the detail screen's text field stays the
   * way to set one; see `CustomerTierPicker`.
   */
  const tiers = workspace === null ? [] : workspace.customerTiers;

  const closeMenus = () => {
    setRowMenuOpen(false);
    setRowMenuId(null);
    contextMenu.close();
  };

  /**
   * A property write from a row, and the one place a refusal from it is shown.
   *
   * `updateCustomer` is optimistic, so the row has already moved by the time the server
   * answers. When it refuses, the sync layer puts the old value back — and without this
   * line the row would simply flick back to what it was with nothing saying why.
   */
  /**
   * A property row in the ⋯ menu and the right-click menu, which are the keyboard's way to
   * a cell trigger that is deliberately not in the tab order. See `CellTrigger`.
   */
  const openFromMenu = (kind: CellProperty, id: UUID) => {
    const button = rowMenuOpen ? rowMenuTrigger.current : null;
    const at = contextMenu.at;
    closeMenus();
    if (button !== null) {
      openCellPicker(kind, id, button);
      return;
    }
    if (at !== null) setMenuPicker({ kind, id, x: at.x, y: at.y });
  };

  const save = (id: UUID, fields: CustomerFields, refused: string) => {
    setFailure(null);
    updateCustomer(engine, id, fields).catch((error: unknown) => {
      setFailure(error instanceof ApiError && error.message !== '' ? error.message : refused);
      report(error);
    });
  };

  /**
   * One array, drawn by the ⋯ button and by the right-click alike.
   *
   * No favourites row: `FavoriteKind` has no `customer`, so there is nothing to write. No
   * Delete either — the API archives a customer and never deletes one, and a row that
   * promised otherwise would be a lie with a confirm dialog on it.
   */
  const itemsFor = (row: CustomerRow): MenuNode[] =>
    entityRowMenuItems(
      { noun: 'customer', name: row.name },
      {
        open: () => {
          closeMenus();
          void navigate(`/customer/${row.id}`);
        },
        openLabel: 'Open customer',
        copyLink: () => {
          closeMenus();
          void copyText(`${window.location.origin}/customer/${row.id}`);
        },
        properties: [
          {
            kind: 'submenu',
            id: 'status',
            label: 'Status',
            // The same rows the status cell's picker draws, from the same builder. A
            // submenu rather than a picker of its own because it draws inside the menu it
            // hangs from — and because this is the keyboard's way to the property, on a
            // surface whose cell triggers are pointer-only by design. See CellTrigger.
            items: customerStatusItems(row.status, (status) => {
              closeMenus();
              if (status === row.status) return;
              save(row.id, { status }, 'That status could not be saved.');
            }),
          },
          // Tier only where the workspace has named some. A row offering a picker that can
          // clear a tier and never set one is worse than no row: it reads as the feature
          // being here and broken rather than as not being set up yet.
          ...(tiers.length === 0
            ? []
            : [
                {
                  id: 'tier',
                  label: 'Tier…',
                  onSelect: () => openFromMenu('tier', row.id),
                },
              ]),
          {
            id: 'owner',
            label: 'Owner…',
            onSelect: () => openFromMenu('owner', row.id),
          },
        ],
        archive: () => {
          closeMenus();
          setFailure(null);
          setConfirming({ id: row.id, name: row.name });
        },
        archiveLabel: 'Archive customer',
      },
    );

  const confirmArchive = () => {
    if (confirming === null) return;
    setArchiving(true);
    setFailure(null);
    void archiveCustomer(engine, confirming.id)
      .then(() => setConfirming(null))
      .catch((error: unknown) =>
        setFailure(
          error instanceof ApiError && error.message !== ''
            ? error.message
            : 'That customer could not be archived.',
        ),
      )
      .finally(() => setArchiving(false));
  };

  const menuRow = rows.find((row) => row.id === rowMenuId) ?? null;
  const contextRow = rows.find((row) => row.id === contextMenu.id) ?? null;
  // Which picker is up and whose, from whichever of the two ways opened it. Re-read from
  // `rows` rather than captured when it opened, so a delta that lands while the menu is up
  // ticks the value the customer actually holds now.
  const openKind: CellProperty | null = cellPicker.open
    ? (editing?.kind ?? null)
    : (menuPicker?.kind ?? null);
  const openId = cellPicker.open ? editing?.id : menuPicker?.id;
  const editingRow = rows.find((row) => row.id === openId) ?? null;
  const pickerTrigger = cellPicker.open ? cellPicker.ref : pickerAnchorRef;
  const closePicker = () => {
    cellPicker.hide();
    setMenuPicker(null);
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Customers</h1>
        {disabled ? null : (
          <Button variant="primary" onClick={create}>
            New customer
          </Button>
        )}
      </header>

      {disabled ? (
        <EmptyState
          title="Customer requests are off"
          description="An admin can turn them back on in Settings → Customer requests. Existing customers stay in the replica."
        />
      ) : all.length === 0 && !settled ? (
        <EntityLoading label="Loading customers…" lines={4} />
      ) : all.length === 0 ? (
        <EmptyState
          title="No customers yet"
          description="A customer is an organisation you attribute feedback to. Requests attach that feedback to issues and projects."
          action={
            <Button variant="primary" onClick={create}>
              New customer
            </Button>
          }
        />
      ) : (
        <>
          <div className={styles.controls}>
            <Input
              className={styles.search}
              label="Search customers"
              hideLabel
              type="search"
              placeholder="Search customers"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <SegmentedControl
              options={STATUS_OPTIONS}
              value={status}
              onChange={setStatus}
              aria-label="Which customers"
              variant="bare"
            />
            <SegmentedControl
              options={SORT_OPTIONS}
              value={sort}
              onChange={setSort}
              aria-label="Sort customers"
              variant="bare"
            />
          </div>

          {rows.length === 0 ? (
            // Not "no customers yet": there are customers, and this is what the controls
            // above have left of them.
            <EmptyState
              title="Nothing matches"
              description="No customer here matches that search and that status."
            />
          ) : (
            <div
              ref={scrollerRef}
              className={styles.list}
              role="listbox"
              aria-label="Customers"
              aria-activedescendant={
                cursor.cursorId === null ? undefined : listRowDomId('customerList', cursor.cursorId)
              }
              tabIndex={0}
            >
              {rows.map((row) => (
                <div
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
                  <Link
                    to={`/customer/${row.id}`}
                    className={styles.row}
                    onClick={() => cursor.setCursor(row.id)}
                  >
                    <span className={styles.body}>
                      <span className={styles.name}>{row.name}</span>
                      {row.domains.length > 0 && (
                        <span className={styles.summary}>{row.domains.join(', ')}</span>
                      )}
                    </span>
                    {/* Three cells that are also controls. The press is stopped at the cell
                        as well as at the button, because the whole row is a <Link>: without
                        it, changing a customer's status would navigate away from the list
                        you were changing it in. */}
                    <span
                      className={styles.status}
                      role="presentation"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <CellTrigger
                        name={formatCustomerStatus(row.status)}
                        action="Change status"
                        open={cellOpen('status', row.id)}
                        onOpen={(element) => openCellPicker('status', row.id, element)}
                      >
                        <span className={styles.cellText}>{formatCustomerStatus(row.status)}</span>
                      </CellTrigger>
                    </span>
                    {tiers.length === 0 ? (
                      // Nothing to choose between: the workspace has named no tiers, and a
                      // menu offering only "No tier" could take a value away and never give
                      // one back. Settings → Customer requests is where the list is made.
                      <span className={styles.tier}>{row.tier ?? 'No tier'}</span>
                    ) : (
                      <span
                        className={styles.tier}
                        role="presentation"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <CellTrigger
                          name={row.tier ?? 'No tier'}
                          action="Set tier"
                          muted={row.tier === null}
                          open={cellOpen('tier', row.id)}
                          onOpen={(element) => openCellPicker('tier', row.id, element)}
                        >
                          <span className={styles.cellText}>{row.tier ?? 'No tier'}</span>
                        </CellTrigger>
                      </span>
                    )}
                    <span
                      className={styles.owner}
                      role="presentation"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <CellTrigger
                        name={row.ownerName ?? 'No owner'}
                        action="Set owner"
                        muted={row.ownerName === null}
                        open={cellOpen('owner', row.id)}
                        onOpen={(element) => openCellPicker('owner', row.id, element)}
                      >
                        {row.ownerName === null ? (
                          // The disc keeps the column from shifting by an avatar's width as
                          // owners come and go, the same way an unassigned issue row does.
                          <span className={styles.noOwner} />
                        ) : (
                          <Avatar
                            name={row.ownerName}
                            size="xs"
                            colorKey={row.ownerId}
                            decorative
                          />
                        )}
                        <span className={styles.cellText}>{row.ownerName ?? 'No owner'}</span>
                      </CellTrigger>
                    </span>
                    <span className={styles.count}>
                      {row.requestCount === 1 ? '1 request' : `${row.requestCount} requests`}
                    </span>
                  </Link>
                  <IconButton
                    aria-label={`Options for ${row.name}`}
                    size="sm"
                    className={styles.menuButton}
                    icon={<DotsGlyph />}
                    onClick={(event) => {
                      event.preventDefault();
                      rowMenuTrigger.current = event.currentTarget;
                      setRowMenuId(row.id);
                      cursor.setCursor(row.id);
                      setRowMenuOpen(true);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* A refusal that has nowhere else to go. While the confirmation is up it is shown
          inside the dialog instead, beside the button that was refused. */}
      {failure === null || confirming !== null ? null : (
        <p className={styles.error} role="alert">
          {failure}
        </p>
      )}

      <Menu
        open={rowMenuOpen && menuRow !== null}
        onClose={closeMenus}
        trigger={rowMenuTrigger}
        label={menuRow === null ? 'Customer options' : `Options for ${menuRow.name}`}
        keysPresentation="kbd"
        density="compact"
        items={menuRow === null ? [] : itemsFor(menuRow)}
      />

      {contextMenu.at === null ? null : <div {...contextMenu.anchorProps} />}
      <Menu
        open={contextMenu.at !== null && contextRow !== null}
        onClose={contextMenu.close}
        trigger={contextMenu.anchorRef}
        label={contextRow === null ? 'Customer options' : `Options for ${contextRow.name}`}
        keysPresentation="kbd"
        density="compact"
        items={contextRow === null ? [] : itemsFor(contextRow)}
      />

      {/* A menu opened from the pointer needs something at the pointer to hang off, and the
          one the context menu rendered went with it. Fixed, because the coordinates are a
          pointer event's. */}
      {menuPicker === null ? null : (
        <div
          ref={pickerAnchorRef}
          style={{
            position: 'fixed',
            width: 1,
            height: 1,
            pointerEvents: 'none',
            top: menuPicker.y,
            left: menuPicker.x,
          }}
        />
      )}

      {/* The three pickers the rows share, opened either from a cell — anchored by
          `cellPicker.ref`, which resolves to whichever cell called `showFrom` — or from a
          row menu. Only ever one of them open. */}
      <CustomerStatusPicker
        open={openKind === 'status'}
        onClose={closePicker}
        trigger={pickerTrigger}
        value={editingRow?.status}
        onSelect={(status) => {
          const row = editingRow;
          closePicker();
          // Choosing what is already set is a no-op, not an update: the server would take
          // it, and every reader of `updatedAt` would see the customer as freshly changed.
          if (row === null || status === row.status) return;
          save(row.id, { status }, 'That status could not be saved.');
        }}
      />
      <CustomerTierPicker
        open={openKind === 'tier'}
        onClose={closePicker}
        trigger={pickerTrigger}
        value={editingRow?.tier ?? null}
        onSelect={(tier) => {
          const row = editingRow;
          closePicker();
          if (row === null || tier === row.tier) return;
          save(row.id, { tier }, 'That tier could not be saved.');
        }}
      />
      <UserPicker
        open={openKind === 'owner'}
        onClose={closePicker}
        trigger={pickerTrigger}
        label="Owner"
        noneLabel="No owner"
        filterPlaceholder="Set owner…"
        value={editingRow?.ownerId ?? null}
        onSelect={(ownerId) => {
          const row = editingRow;
          closePicker();
          if (row === null || ownerId === (row.ownerId ?? null)) return;
          save(row.id, { ownerId }, 'That owner could not be saved.');
        }}
      />

      <ConfirmDialog
        open={confirming !== null}
        title={confirming === null ? 'Archive this customer?' : `Archive ${confirming.name}?`}
        consequence="It leaves this list. Requests already attached to issues stay there. There is no archives page for customers yet, so bringing it back is an API call."
        confirmLabel="Archive"
        destructive
        busy={archiving}
        error={confirming === null ? undefined : (failure ?? undefined)}
        onConfirm={confirmArchive}
        onClose={() => {
          if (archiving) return;
          setConfirming(null);
          setFailure(null);
        }}
      />
    </div>
  );
}

/**
 * A property in a row, drawn as the value itself.
 *
 * `PropertyTrigger` is the component for this everywhere a property is a *glyph* — a status
 * circle, a priority bar, an avatar — and it is an `IconButton`, which is square by
 * construction and hides its contents from the accessibility tree. Every property in this
 * row is a word: "Prospect", "Enterprise", somebody's name. Squashing those into a 22px box
 * would throw away the column they are the point of, so this is the trade the issue row's
 * own `MetaPill` already makes for its due date and estimate — the value stays legible and
 * the button is drawn around it.
 *
 * What it keeps from `PropertyTrigger` is the part that is easy to leave out. The click is
 * stopped before the row's `<Link>` sees it. And it stays out of the tab order, because
 * these rows are `role="option"` in a listbox that navigates by `aria-activedescendant`,
 * where a tab stop inside an option breaks the roving model — the cost being that this is a
 * pointer affordance, and the keyboard reaches the same property through the row menu on
 * `.` instead.
 */
function CellTrigger({
  name,
  action,
  open,
  muted = false,
  onOpen,
  children,
}: {
  /** The value, which is the control's accessible name. Not the property — that is `action`. */
  readonly name: string;
  /** The verb, in the tooltip: "Change status". Never the same words as `name`. */
  readonly action: string;
  readonly open: boolean;
  /** Dimmed, for a property holding nothing: "No tier", "No owner". */
  readonly muted?: boolean | undefined;
  readonly onOpen: (element: HTMLElement) => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={[styles.cellTrigger, muted ? styles.cellTriggerMuted : null]
        .filter(Boolean)
        .join(' ')}
      aria-label={name}
      title={action}
      aria-haspopup="menu"
      aria-expanded={open}
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(event.currentTarget);
      }}
    >
      {children}
    </button>
  );
}

function listCustomers(store: Store): CustomerRow[] {
  const rows: CustomerRow[] = [];
  for (const customer of store.customers.values()) {
    if (customer.archivedAt !== undefined || customer.deletedAt !== undefined) continue;
    let requestCount = 0;
    for (const requestId of store.customerRequestIdsForCustomer(customer.id)) {
      if (store.customerRequests.has(requestId)) requestCount += 1;
    }
    const owner =
      customer.ownerId === undefined ? null : (store.users.get(customer.ownerId)?.name ?? null);
    rows.push({
      id: customer.id,
      name: customer.name,
      domains: customer.domains,
      status: customer.status,
      tier: customer.tier === undefined || customer.tier === '' ? null : customer.tier,
      ownerName: owner,
      ownerId: customer.ownerId,
      requestCount,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}
