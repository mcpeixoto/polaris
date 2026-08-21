/**
 * One customer — attributes and the requests attributed to them.
 *
 * Create asked for a name and domains. Status, owner, tier, revenue, size, logo, and
 * archive already existed on the mutation and this page never offered them, so a customer
 * stayed Active with whatever was typed at create for the rest of its life.
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { useEngine } from '~/app/context';
import { Button, EmptyState, Input, Select } from '~/components';
import { ConfirmDialog } from '~/components/ConfirmDialog';
import { CreateCustomerRequestModal } from '~/features/customers/CreateCustomerRequestModal';
import {
  archiveCustomer,
  formatCustomerStatus,
  mergeCustomers,
  toggleCustomerRequestImportant,
  updateCustomer,
} from '~/features/customers/mutations';
import { report } from '~/features/issue/mutations';
import { setCustomerSubscription } from '~/features/subscriptions/mutations';
import { SubscribeBell } from '~/features/subscriptions/SubscribeBell';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import { useViewer } from '~/hooks/useViewer';
import type { CustomerStatus, Store, UUID } from '~/store';
import { ApiError } from '~/sync/api';
import styles from './CustomerDetail.module.css';

interface RequestRow {
  readonly id: UUID;
  readonly body: string;
  readonly important: boolean;
  readonly target: string;
  readonly href: string;
}

const STATUSES: readonly CustomerStatus[] = ['active', 'prospect', 'churned'];

export function CustomerDetail() {
  const navigate = useNavigate();
  const engine = useEngine();
  const { customerId = '' } = useParams<{ customerId: string }>();
  const viewer = useViewer();
  const [requestOpen, setRequestOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [mergeIntoId, setMergeIntoId] = useState('');
  const [merging, setMerging] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const customer = useLiveQuery(
    (store) => store.customers.get(customerId) ?? null,
    ['customer'],
    [customerId],
  );

  const watch = useLiveQuery(
    (store) => {
      if (viewer === null) return null;
      const id = store.customerSubscriptionIdFor(viewer.id, customerId);
      return id === undefined ? null : (store.get('customerSubscription', id) ?? null);
    },
    ['customerSubscription'],
    [customerId, viewer?.id],
  );

  const people = useLiveQuery(
    (store) =>
      [...store.users.values()]
        .filter((user) => user.archivedAt === undefined && user.status === 'active')
        .map((user) => ({ id: user.id, name: user.displayName }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['user'],
  );

  const workspace = useLiveQuery(
    (store) => store.workspaces.get(store.workspaceId) ?? null,
    ['workspace'],
  );

  const others = useLiveQuery(
    (store) =>
      [...store.customers.values()]
        .filter(
          (row) =>
            row.id !== customerId && row.archivedAt === undefined && row.deletedAt === undefined,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    ['customer'],
    [customerId],
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

  const save = (fields: Parameters<typeof updateCustomer>[2]) => {
    updateCustomer(engine, customer.id, fields).catch(report);
  };

  const confirmArchive = () => {
    setArchiveBusy(true);
    setArchiveError(null);
    archiveCustomer(engine, customer.id)
      .then(() => {
        setArchiveBusy(false);
        setArchiving(false);
        void navigate('/customers');
      })
      .catch((failure: unknown) => {
        setArchiveBusy(false);
        setArchiveError(
          failure instanceof ApiError ? failure.message : 'That customer could not be archived.',
        );
      });
  };

  const mergeTarget = others.find((row) => row.id === mergeIntoId) ?? null;

  const confirmMerge = () => {
    if (mergeTarget === null) return;
    setMergeBusy(true);
    setMergeError(null);
    mergeCustomers(engine, customer.id, mergeTarget.id)
      .then(() => {
        setMergeBusy(false);
        setMerging(false);
        void navigate(`/customer/${mergeTarget.id}`);
      })
      .catch((failure: unknown) => {
        setMergeBusy(false);
        setMergeError(
          failure instanceof ApiError ? failure.message : 'Those customers could not be merged.',
        );
      });
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{customer.name}</h1>
          <span className={styles.status}>{formatCustomerStatus(customer.status)}</span>
          {viewer !== null && viewer.role !== 'guest' ? (
            <SubscribeBell
              menuLabel="Customer notifications"
              flags={[
                { id: 'requestAdded', label: 'A request is added', on: watch?.requestAdded === true },
                {
                  id: 'requestImportant',
                  label: 'A request is marked important',
                  on: watch?.requestImportant === true,
                },
                {
                  id: 'requestCompleted',
                  label: 'A request is completed',
                  on: watch?.requestCompleted === true,
                },
              ]}
              onToggle={(id) => {
                setCustomerSubscription(engine, {
                  customerId: customer.id,
                  userId: viewer.id,
                  requestAdded:
                    id === 'requestAdded'
                      ? watch?.requestAdded !== true
                      : watch?.requestAdded === true,
                  requestImportant:
                    id === 'requestImportant'
                      ? watch?.requestImportant !== true
                      : watch?.requestImportant === true,
                  requestCompleted:
                    id === 'requestCompleted'
                      ? watch?.requestCompleted !== true
                      : watch?.requestCompleted === true,
                }).catch(report);
              }}
            />
          ) : null}
          <Button variant="ghost" onClick={() => setArchiving(true)}>
            Archive
          </Button>
          {others.length === 0 ? null : (
            <>
              <Select
                label="Merge into"
                hideLabel
                value={mergeIntoId}
                onChange={(event) => setMergeIntoId(event.target.value)}
              >
                <option value="">Merge with…</option>
                {others.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                disabled={mergeIntoId === ''}
                onClick={() => setMerging(true)}
              >
                Merge
              </Button>
            </>
          )}
        </div>
      </header>

      <section className={styles.section} aria-labelledby="properties-heading">
        <h2 className={styles.sectionTitle} id="properties-heading">
          Properties
        </h2>
        <p className={styles.muted}>
          Writes land as you leave a field. Status and owner are independent of the name.
        </p>
        <div className={styles.properties}>
          <Input
            label="Name"
            defaultValue={customer.name}
            key={`name:${customer.name}`}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name === '' || name === customer.name) return;
              save({ name });
            }}
          />
          <Input
            label="Domains"
            hint="Comma-separated, unique in this workspace."
            defaultValue={customer.domains.join(', ')}
            key={`domains:${customer.domains.join(',')}`}
            onBlur={(event) => {
              const domains = event.target.value
                .split(/[\s,]+/)
                .map((item) => item.trim())
                .filter((item) => item !== '');
              if (domains.join('\0') === customer.domains.join('\0')) return;
              save({ domains });
            }}
          />
          <Select
            label="Status"
            value={customer.status}
            onChange={(event) => save({ status: event.target.value as CustomerStatus })}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {formatCustomerStatus(status)}
              </option>
            ))}
          </Select>
          <Select
            label="Owner"
            value={customer.ownerId ?? ''}
            onChange={(event) =>
              save({ ownerId: event.target.value === '' ? null : event.target.value })
            }
          >
            <option value="">No owner</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
          {workspace !== null && workspace.customerTiers.length > 0 ? (
            <Select
              label="Tier"
              value={customer.tier ?? ''}
              onChange={(event) =>
                save({ tier: event.target.value === '' ? null : event.target.value })
              }
            >
              <option value="">No tier</option>
              {workspace.customerTiers.map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              label="Tier"
              hint="A label you choose — Enterprise, Pro, self-serve."
              defaultValue={customer.tier ?? ''}
              key={`tier:${customer.tier ?? ''}`}
              onBlur={(event) => {
                const tier = event.target.value.trim();
                const previous = customer.tier ?? '';
                if (tier === previous) return;
                save({ tier: tier === '' ? null : tier });
              }}
            />
          )}
          <Input
            label="Revenue"
            type="number"
            min={0}
            hint={
              workspace !== null && workspace.customerRevenueUnit !== ''
                ? `Whole ${workspace.customerRevenueUnit}. Blank clears it.`
                : 'Whole units. Blank clears it.'
            }
            defaultValue={customer.revenue === undefined ? '' : String(customer.revenue)}
            key={`revenue:${customer.revenue === undefined ? '' : String(customer.revenue)}`}
            onBlur={(event) => {
              const raw = event.target.value.trim();
              if (raw === '') {
                if (customer.revenue === undefined) return;
                save({ revenue: null });
                return;
              }
              const revenue = Number(raw);
              if (!Number.isFinite(revenue) || revenue === customer.revenue) return;
              save({ revenue });
            }}
          />
          <Input
            label="Size"
            type="number"
            min={0}
            hint="People at the organisation. Blank clears it."
            defaultValue={customer.size === undefined ? '' : String(customer.size)}
            key={`size:${customer.size === undefined ? '' : String(customer.size)}`}
            onBlur={(event) => {
              const raw = event.target.value.trim();
              if (raw === '') {
                if (customer.size === undefined) return;
                save({ size: null });
                return;
              }
              const size = Number(raw);
              if (!Number.isFinite(size) || size === customer.size) return;
              save({ size });
            }}
          />
          <Input
            label="Logo URL"
            hint="A public image. Blank keeps the letter mark."
            defaultValue={customer.logoUrl}
            key={`logo:${customer.logoUrl}`}
            onBlur={(event) => {
              const logoUrl = event.target.value.trim();
              if (logoUrl === customer.logoUrl) return;
              save({ logoUrl });
            }}
          />
        </div>
      </section>

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

      <ConfirmDialog
        open={archiving}
        title={`Archive ${customer.name}?`}
        consequence="It leaves the Customers list. Requests already attached to issues stay there. There is no archives page for customers yet, so bringing it back is an API call."
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

      <ConfirmDialog
        open={merging && mergeTarget !== null}
        title={mergeTarget === null ? 'Merge?' : `Merge ${customer.name} into ${mergeTarget.name}?`}
        consequence="Domains and requests move onto the surviving customer. Empty attributes fill in from this one. This customer is archived."
        confirmLabel="Merge"
        destructive
        busy={mergeBusy}
        error={mergeError ?? undefined}
        onConfirm={confirmMerge}
        onClose={() => {
          if (mergeBusy) return;
          setMerging(false);
          setMergeError(null);
        }}
      />
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
