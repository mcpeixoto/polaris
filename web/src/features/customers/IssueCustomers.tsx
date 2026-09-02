/**
 * Customer requests attached to one issue or project.
 *
 * Drawn only where the workspace has customer requests switched on. Everywhere else the
 * admin toggle already decides — the sidebar entry, the command palette's two actions and
 * the customer list all disappear with it — and this section was the one that stayed, so
 * turning the feature off still offered an "Add request" button whose dialogue the server
 * answers with "customer requests are turned off" after the feedback has been typed out.
 * Existing requests are not deleted by the toggle; they come back with it.
 */

import { useState } from 'react';
import { Link } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, IconButton } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { CreateCustomerRequestModal } from '~/features/customers/CreateCustomerRequestModal';
import { CustomerRequestEditor } from '~/features/customers/CustomerRequestEditor';
import {
  deleteCustomerRequest,
  toggleCustomerRequestImportant,
} from '~/features/customers/mutations';
import { report } from '~/features/issue/mutations';
import { PencilGlyph, TrashGlyph } from '~/features/project-updates/glyphs';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import type { Store, UUID } from '~/store';
import { ApiError } from '~/sync/api';
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
  // `undefined` while the replica is still opening: matching the shell's own reading of
  // this flag keeps the section from blinking out of an issue on every cold load.
  const enabled = useLiveQuery(
    (store) => store.workspaces.get(store.workspaceId)?.customerRequestsEnabled ?? true,
    ['workspace'],
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UUID | null>(null);
  const [removing, setRemoving] = useState<UUID | null>(null);
  // Both writes below used to end at `report`, which reaches the console. A request that
  // silently refuses to be marked or removed looks to the reader like a click that missed.
  const [writeError, setWriteError] = useState<string | null>(null);
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

  if (viewer === null || viewer.role === 'guest' || !enabled) return null;

  const fail = (message: string) => (failure: unknown) => {
    setWriteError(failure instanceof ApiError ? failure.message : message);
    report(failure);
  };

  return (
    <section className={styles.section} aria-label="Customers">
      <div className={styles.head}>
        <h2 className={styles.title}>Customers</h2>
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Add request
        </Button>
      </div>
      {writeError === null ? null : (
        <p className={styles.error} role="alert">
          {writeError}
        </p>
      )}
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
                onClick={() => {
                  setWriteError(null);
                  toggleCustomerRequestImportant(engine, row.id, !row.important).catch(
                    fail('That request could not be marked.'),
                  );
                }}
              >
                ▲
              </button>
              {editing === row.id ? (
                <CustomerRequestEditor
                  requestId={row.id}
                  body={row.body}
                  onDone={() => setEditing(null)}
                />
              ) : (
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
              )}
              {editing === row.id ? null : (
                <span className={styles.rowActions}>
                  <IconButton
                    size="sm"
                    icon={<PencilGlyph />}
                    aria-label={`Edit request from ${row.customerName}`}
                    tooltip="Edit request"
                    onClick={() => setEditing(row.id)}
                  />
                  <IconButton
                    size="sm"
                    icon={<TrashGlyph />}
                    aria-label={`Remove request from ${row.customerName}`}
                    tooltip="Remove request"
                    onClick={() => setRemoving(row.id)}
                  />
                </span>
              )}
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

      <ConfirmDialog
        open={removing !== null}
        title="Remove this request?"
        consequence="The feedback stops counting towards this customer's demand, and the issue loses it from every view that filters by customer. The issue itself stays."
        confirmLabel="Remove request"
        destructive
        onConfirm={() => {
          if (removing !== null) {
            if (editing === removing) setEditing(null);
            setWriteError(null);
            deleteCustomerRequest(engine, removing).catch(
              fail('That request could not be removed.'),
            );
          }
          setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
      />
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
