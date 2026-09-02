/**
 * Workspace customers — organisations whose feedback attaches to issues and projects.
 */

import { Link, Navigate } from 'react-router';

import { useKeymap } from '~/app/keymap';
import { Avatar, Button, EmptyState } from '~/components';
import { formatCustomerStatus } from '~/features/customers/mutations';
import { EntityLoading, useStoreSettled } from '~/features/entity-gate/EntityGate';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewerRole } from '~/hooks/useViewer';
import type { CustomerStatus, Store, UUID } from '~/store';
import styles from './Customers.module.css';

interface CustomerRow {
  readonly id: UUID;
  readonly name: string;
  readonly domains: readonly string[];
  readonly status: CustomerStatus;
  readonly ownerName: string | null;
  readonly ownerId: UUID | undefined;
  readonly requestCount: number;
}

export function Customers() {
  const { registry, context } = useKeymap();
  const viewerRole = useViewerRole();
  // An empty replica and an empty workspace look identical from here, and only one of them
  // should be told "No customers yet" with a button to make the first one.
  const settled = useStoreSettled();
  const create = () => registry.invoke('customer.create', { source: 'menu', context });

  const workspace = useLiveQuery(
    (store) => store.workspaces.get(store.workspaceId) ?? null,
    ['workspace'],
  );

  const rows = useLiveQuery(
    (store) => listCustomers(store),
    ['customer', 'customerRequest', 'user'],
  );

  // A guest sees nothing customer-shaped, the sidebar link included — so the URL typed in
  // by hand has to say so too. The role comes from the session because a guest's replica
  // holds no `user` rows to read a profile out of.
  if (viewerRole === 'guest') {
    return <Navigate to="/" replace />;
  }

  if (workspace !== null && !workspace.customerRequestsEnabled) {
    return (
      <div className={styles.screen}>
        <header className={styles.header}>
          <h1 className={styles.title}>Customers</h1>
        </header>
        <EmptyState
          title="Customer requests are off"
          description="An admin can turn them back on in Settings → Customer requests. Existing customers stay in the replica."
        />
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Customers</h1>
        <Button variant="primary" onClick={create}>
          New customer
        </Button>
      </header>

      {rows.length === 0 && !settled ? (
        <EntityLoading label="Loading customers…" lines={4} />
      ) : rows.length === 0 ? (
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
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id}>
              <Link to={`/customer/${row.id}`} className={styles.row}>
                <span className={styles.body}>
                  <span className={styles.name}>{row.name}</span>
                  {row.domains.length > 0 && (
                    <span className={styles.summary}>{row.domains.join(', ')}</span>
                  )}
                </span>
                <span className={styles.status}>{formatCustomerStatus(row.status)}</span>
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
            </li>
          ))}
        </ul>
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
      ownerName: owner,
      ownerId: customer.ownerId,
      requestCount,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}
