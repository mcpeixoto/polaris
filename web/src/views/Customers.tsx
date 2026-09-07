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

import { useKeyContext, useKeymap } from '~/app/keymap';
import { Avatar, Button, EmptyState, Input, SegmentedControl } from '~/components';
import { formatCustomerStatus } from '~/features/customers/mutations';
import { EntityLoading, useStoreSettled } from '~/features/entity-gate/EntityGate';
import { listRowDomId, useListCursor } from '~/hooks/useListCursor';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerRole } from '~/hooks/useViewer';
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
  const { registry, context } = useKeymap();
  const viewerRole = useViewerRole();
  // An empty replica and an empty workspace look identical from here, and only one of them
  // should be told "No customers yet" with a button to make the first one.
  const settled = useStoreSettled();
  const create = () => registry.invoke('customer.create', { source: 'menu', context });

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<Sort>('name');
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

  // A guest sees nothing customer-shaped, the sidebar link included — so the URL typed in
  // by hand has to say so too. The role comes from the session because a guest's replica
  // holds no `user` rows to read a profile out of.
  if (viewerRole === 'guest') {
    return <Navigate to="/" replace />;
  }

  const disabled = workspace !== null && !workspace.customerRequestsEnabled;

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
                  className={row.id === cursor.cursorId ? styles.cursorItem : undefined}
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
                </div>
              ))}
            </div>
          )}
        </>
      )}
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
