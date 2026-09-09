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

import { useMemo, useRef, useState } from 'react';
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
  archiveCustomer,
  formatCustomerStatus,
  updateCustomer,
} from '~/features/customers/mutations';
import { EntityLoading, useStoreSettled } from '~/features/entity-gate/EntityGate';
import { copyText } from '~/features/github/copy';
import { DotsGlyph } from '~/features/issue/glyphs';
import { report } from '~/features/issue/mutations';
import { useContextMenu } from '~/hooks/useContextMenu';
import { listRowDomId, useListCursor } from '~/hooks/useListCursor';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerRole } from '~/hooks/useViewer';
import { ApiError } from '~/sync/api';
import type { CustomerStatus, Store, UUID } from '~/store';
import styles from './Customers.module.css';

/** The status filter, which is the statuses plus "all of them". */
type StatusFilter = 'all' | CustomerStatus;

const STATUS_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'churned', label: 'Churned' },
];

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

  const closeMenus = () => {
    setRowMenuOpen(false);
    setRowMenuId(null);
    contextMenu.close();
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
            items: STATUS_OPTIONS.filter((option) => option.value !== 'all').map((option) => ({
              id: `status-${option.value}`,
              label: option.label,
              selected: option.value === row.status,
              onSelect: () => {
                closeMenus();
                if (option.value === row.status) return;
                setFailure(null);
                updateCustomer(engine, row.id, {
                  status: option.value as CustomerStatus,
                }).catch((error: unknown) => {
                  setFailure(
                    error instanceof ApiError && error.message !== ''
                      ? error.message
                      : 'That status could not be saved.',
                  );
                  report(error);
                });
              },
            })),
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
                    <span className={styles.status}>{formatCustomerStatus(row.status)}</span>
                    <span className={styles.tier}>{row.tier ?? 'No tier'}</span>
                    {row.ownerName === null ? (
                      <span className={styles.ownerMuted}>No owner</span>
                    ) : (
                      <span className={styles.owner}>
                        <Avatar name={row.ownerName} size="xs" colorKey={row.ownerId} decorative />
                        {row.ownerName}
                      </span>
                    )}
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
