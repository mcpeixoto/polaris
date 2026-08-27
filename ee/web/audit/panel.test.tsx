/**
 * The commercial audit log panel. COMMERCIALLY LICENSED — see ../../LICENSE.
 *
 * Runs only under POLARIS_EDITION=ee (`pnpm -C web test:ee`), because that is the only
 * configuration in which this code is part of the bundle at all. web/vitest.config.ts adds
 * this tree to the include list for that edition and leaves it out otherwise — a core run
 * would resolve `@ee` to the stub and these tests would pass while proving nothing about
 * the file they are named after.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, gql } from '~/sync/api';

import { AuditLogPanel } from './index';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const sent = vi.mocked(gql);

interface Wire {
  id: string;
  actorUserId: string | null;
  actorType: string;
  actorLabel: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

function entry(id: string, over: Partial<Wire> = {}): Wire {
  return {
    id,
    actorUserId: 'user-1',
    actorType: 'user',
    actorLabel: 'Ada Lovelace',
    action: 'member.role_changed',
    targetType: 'user',
    targetId: 'user-2',
    targetLabel: 'Grace Hopper',
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0',
    createdAt: '2026-08-20T10:00:00Z',
    ...over,
  };
}

/** What the server holds, page by page, keyed by the cursor that asks for it. */
let pages: Record<string, Wire[]> = {};
let failure: unknown = null;

function answer(query: string, variables?: Record<string, unknown>): unknown {
  if (failure !== null) throw failure;
  if (query.includes('query EnterpriseAuditLog')) {
    const after = (variables?.after as string | undefined) ?? '';
    return { auditLog: pages[after] ?? [] };
  }
  throw new Error(`the panel sent a document these tests do not answer: ${query.slice(0, 60)}`);
}

function callsTo(operation: string): (Record<string, unknown> | undefined)[] {
  return sent.mock.calls
    .filter(([query]) => query.includes(operation))
    .map(([, variables]) => variables);
}

function rowFor(label: string): HTMLElement {
  const cell = screen.getByText(label);
  const row = cell.closest('tr');
  if (row === null) throw new Error(`no row containing ${label}`);
  return row;
}

describe('AuditLogPanel', () => {
  beforeEach(() => {
    pages = {};
    failure = null;
    sent.mockReset();
    // async, so that a refusal from `answer` becomes a REJECTED promise rather than a
    // synchronous throw. `gql` rejects; a stand-in that throws instead would sail straight
    // past the panel's `.catch` and fail the test from outside the component, which reads
    // like a broken component rather than a broken fixture.
    sent.mockImplementation(
      async <T,>(query: string, variables?: Record<string, unknown>) =>
        answer(query, variables) as T,
    );
  });

  it('renders an entry as a row naming who, what and from where', async () => {
    pages[''] = [entry('e1')];
    render(<AuditLogPanel pageSize={2} />);

    await screen.findByRole('table');
    const row = rowFor('member.role_changed');

    expect(within(row).getByText('Ada Lovelace')).toBeTruthy();
    expect(within(row).getByText('Grace Hopper')).toBeTruthy();
    expect(within(row).getByText('203.0.113.7')).toBeTruthy();
  });

  it('reads an em dash for the facts a sign-in genuinely does not have', async () => {
    // A sign-in has no target. The cell must not be blank: an empty cell is
    // indistinguishable from a column that failed to load, and on this screen the reader
    // is deciding whether something is missing or whether nothing happened.
    pages[''] = [
      entry('e1', {
        action: 'auth.signed_in',
        targetType: null,
        targetId: null,
        targetLabel: null,
      }),
    ];
    render(<AuditLogPanel pageSize={2} />);

    await screen.findByRole('table');
    expect(within(rowFor('auth.signed_in')).getByText('—')).toBeTruthy();
  });

  it('pages with the last row id and appends rather than replacing', async () => {
    pages[''] = [entry('e1', { action: 'auth.signed_in' }), entry('e2', { action: 'invite.sent' })];
    pages['e2'] = [entry('e3', { action: 'api_key.created' })];

    render(<AuditLogPanel pageSize={2} />);
    const user = userEvent.setup();

    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Load older entries' }));

    // The cursor is the id of the last row already held — keyset, not offset. An offset
    // would repeat and skip rows as entries are appended underneath the reader.
    await waitFor(() => expect(callsTo('query EnterpriseAuditLog')).toHaveLength(2));
    expect(callsTo('query EnterpriseAuditLog')[1]).toEqual({ first: 2, after: 'e2' });

    // All three, not just the newest page. Somebody scanning for a sequence of events must
    // be able to compare two that straddle a page boundary.
    expect(screen.getByText('auth.signed_in')).toBeTruthy();
    expect(screen.getByText('api_key.created')).toBeTruthy();
  });

  it('stops offering more once a short page comes back', async () => {
    pages[''] = [entry('e1')];
    render(<AuditLogPanel pageSize={2} />);

    await screen.findByRole('table');
    // One row against a page size of two means the server has nothing further. Offering
    // "load more" anyway trains people to click it and be told nothing.
    expect(screen.queryByRole('button', { name: 'Load older entries' })).toBeNull();
  });

  it('shows the server’s own sentence when the plan does not include the feature', async () => {
    // PLAN_LIMIT carries a message built from the entitlement matrix — which plan would
    // permit it, or whether billing lapsed. Paraphrasing it here would send a paying
    // customer whose card expired to an upgrade page they do not need.
    failure = new ApiError('PLAN_LIMIT', 'The audit log requires the Enterprise plan.');
    render(<AuditLogPanel />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The audit log requires the Enterprise plan.');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows nothing rather than a stale page when the refresh fails', async () => {
    failure = new ApiError('INTERNAL', 'something broke');
    render(<AuditLogPanel />);

    await screen.findByRole('alert');
    // A partial answer beside "could not be refreshed" is how somebody draws a wrong
    // conclusion from a real-looking table.
    expect(screen.queryByRole('table')).toBeNull();
  });
});
