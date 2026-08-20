/**
 * Customer requests attached to one issue.
 */

import { useState } from 'react';
import { Link } from 'react-router';

import { useEngine } from '~/app/context';
import { Button } from '~/components';
import { CreateCustomerRequestModal } from '~/features/customers/CreateCustomerRequestModal';
import { toggleCustomerRequestImportant } from '~/features/customers/mutations';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import type { Store, UUID } from '~/store';
import styles from './IssueCustomers.module.css';

export function IssueCustomers({
  issueId,
  projectId,
}: {
  issueId?: UUID | undefined;
  projectId?: UUID | undefined;
}) {
  const engine = useEngine();
  const viewer = useViewer();
  const [open, setOpen] = useState(false);
  const rows = useLiveQuery(
    (store) =>
      issueId !== undefined
        ? listForIssue(store, issueId)
        : projectId !== undefined
          ? listForProject(store, projectId)
          : [],
    ['customerRequest', 'customer'],
    [issueId ?? '', projectId ?? ''],
  );

  if (viewer === null || viewer.role === 'guest') return null;

  return (
    <section className={styles.section} aria-label="Customers">
      <div className={styles.head}>
        <h2 className={styles.title}>Customers</h2>
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Add request
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className={styles.muted}>
          {projectId !== undefined && issueId === undefined
            ? 'No customer requests on this project.'
            : 'No customer requests on this issue.'}
        </p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <button
                type="button"
                className={row.important ? styles.importantOn : styles.important}
                aria-pressed={row.important}
                aria-label={row.important ? 'Marked important' : 'Mark important'}
                onClick={() => void toggleCustomerRequestImportant(engine, row.id, !row.important)}
              >
                ▲
              </button>
              <span className={styles.body}>
                {row.customerHref === null ? (
                  <span className={styles.name}>{row.customerName}</span>
                ) : (
                  <Link to={row.customerHref} className={styles.name}>
                    {row.customerName}
                  </Link>
                )}
                {row.body !== '' && <span className={styles.text}>{row.body}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <CreateCustomerRequestModal
          issueId={issueId}
          projectId={projectId}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

function listForIssue(store: Store, issueId: UUID) {
  const rows: Array<{
    readonly id: UUID;
    readonly body: string;
    readonly important: boolean;
    readonly customerName: string;
    readonly customerHref: string | null;
  }> = [];
  for (const requestId of store.customerRequestIdsForIssue(issueId)) {
    const request = store.customerRequests.get(requestId);
    if (request === undefined) continue;
    const customer =
      request.customerId === undefined ? undefined : store.customers.get(request.customerId);
    rows.push({
      id: request.id,
      body: request.body,
      important: request.important,
      customerName: customer?.name ?? 'No customer',
      customerHref: customer === undefined ? null : `/customer/${customer.id}`,
    });
  }
  rows.sort((a, b) => Number(b.important) - Number(a.important));
  return rows;
}

function listForProject(store: Store, projectId: UUID) {
  const rows: Array<{
    readonly id: UUID;
    readonly body: string;
    readonly important: boolean;
    readonly customerName: string;
    readonly customerHref: string | null;
  }> = [];
  for (const requestId of store.customerRequestIdsForProject(projectId)) {
    const request = store.customerRequests.get(requestId);
    if (request === undefined) continue;
    const customer =
      request.customerId === undefined ? undefined : store.customers.get(request.customerId);
    rows.push({
      id: request.id,
      body: request.body,
      important: request.important,
      customerName: customer?.name ?? 'No customer',
      customerHref: customer === undefined ? null : `/customer/${customer.id}`,
    });
  }
  rows.sort((a, b) => Number(b.important) - Number(a.important));
  return rows;
}
