/**
 * One customer — attributes and the requests attributed to them.
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, EmptyState } from '~/components';
import { CreateCustomerRequestModal } from '~/features/customers/CreateCustomerRequestModal';
import {
  formatCustomerStatus,
  toggleCustomerRequestImportant,
} from '~/features/customers/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store, UUID } from '~/store';
import styles from './CustomerDetail.module.css';

interface RequestRow {
  readonly id: UUID;
  readonly body: string;
  readonly important: boolean;
  readonly target: string;
  readonly href: string;
}

export function CustomerDetail() {
  const navigate = useNavigate();
  const engine = useEngine();
  const { customerId = '' } = useParams<{ customerId: string }>();
  const [requestOpen, setRequestOpen] = useState(false);

  const customer = useLiveQuery(
    (store) => store.customers.get(customerId) ?? null,
    ['customer'],
    [customerId],
  );

  const ownerName = useLiveQuery(
    (store) =>
      customer?.ownerId === undefined ? null : (store.users.get(customer.ownerId)?.name ?? null),
    ['user', 'customer'],
    [customerId, customer?.ownerId ?? ''],
  );

  const requests = useLiveQuery(
    (store) => (customer === null ? [] : listRequests(store, customer.id)),
    ['customerRequest', 'issue', 'project', 'team'],
    [customerId],
  );

  if (customer === null) {
    return (
      <EmptyState
        title="No such customer"
        description="It may have been archived or deleted."
        action={<Button onClick={() => navigate(-1)}>Go back</Button>}
      />
    );
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{customer.name}</h1>
          <span className={styles.status}>{formatCustomerStatus(customer.status)}</span>
        </div>
        <div className={styles.meta}>
          {customer.domains.length > 0 && <span>{customer.domains.join(', ')}</span>}
          {ownerName !== null && <span>Owner · {ownerName}</span>}
          {customer.tier !== undefined && <span>Tier · {customer.tier}</span>}
        </div>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Requests</h2>
          <Button variant="primary" onClick={() => setRequestOpen(true)}>
            Add request
          </Button>
        </div>
        {requests.length === 0 ? (
          <p className={styles.muted}>No requests yet. Capture feedback from this customer.</p>
        ) : (
          <ul className={styles.requestList}>
            {requests.map((row) => (
              <li key={row.id} className={styles.requestRow}>
                <button
                  type="button"
                  className={row.important ? styles.importantOn : styles.important}
                  aria-pressed={row.important}
                  aria-label={row.important ? 'Marked important' : 'Mark important'}
                  onClick={() =>
                    void toggleCustomerRequestImportant(engine, row.id, !row.important)
                  }
                >
                  ▲
                </button>
                <Link to={row.href} className={styles.requestBody}>
                  <span className={styles.requestTarget}>{row.target}</span>
                  {row.body !== '' && <span className={styles.requestText}>{row.body}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {requestOpen && (
        <CreateCustomerRequestModal
          customerId={customer.id}
          onClose={() => setRequestOpen(false)}
        />
      )}
    </div>
  );
}

function listRequests(store: Store, customerId: UUID): RequestRow[] {
  const rows: RequestRow[] = [];
  for (const requestId of store.customerRequestIdsForCustomer(customerId)) {
    const request = store.customerRequests.get(requestId);
    if (request === undefined) continue;
    let target = 'Request';
    let href = `/customers`;
    if (request.issueId !== undefined) {
      const issue = store.issues.get(request.issueId);
      if (issue !== undefined) {
        target = store.identifierOf(issue);
        href = `/issue/${target}`;
      }
    } else if (request.projectId !== undefined) {
      const project = store.projects.get(request.projectId);
      if (project !== undefined) {
        target = project.name;
        href = `/project/${project.id}`;
      }
    }
    rows.push({
      id: request.id,
      body: request.body,
      important: request.important,
      target,
      href,
    });
  }
  rows.sort((a, b) => Number(b.important) - Number(a.important));
  return rows;
}
