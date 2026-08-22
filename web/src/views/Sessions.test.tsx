import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import type { AccountSessionSummary } from '~/features/sessions/mutations';
import { Store } from '~/store';
import { ApiError, gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Sessions } from './Sessions';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return {
    ...actual,
    gql: vi.fn(),
    auth: { ...actual.auth, logout: vi.fn().mockResolvedValue(undefined) },
  };
});

const sent = vi.mocked(gql);

const WORKSPACE = 'workspace-1';
const AT = '2026-01-01T00:00:00Z';
const SEEN = '2026-01-02T00:00:00Z';

let listing: AccountSessionSummary[] = [];

function session(
  id: string,
  label: string,
  over: Partial<AccountSessionSummary> = {},
): AccountSessionSummary {
  return {
    id,
    label,
    userAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
    ip: '203.0.113.10',
    country: 'PT',
    current: false,
    lastSeenAt: SEEN,
    createdAt: AT,
    expiresAt: '2026-02-01T00:00:00Z',
    ...over,
  };
}

function answer(query: string, variables?: Record<string, unknown>): unknown {
  if (query.includes('query AccountSessions')) {
    return { accountSessions: listing };
  }
  if (query.includes('mutation RevokeAccountSession')) {
    listing = listing.filter((row) => row.id !== variables?.id);
    return { revokeAccountSession: { version: 1, id: variables?.id } };
  }
  if (query.includes('mutation RevokeOtherSessions')) {
    listing = listing.filter((row) => row.current);
    return { revokeOtherSessions: { version: 1, id: listing[0]?.id } };
  }
  throw new Error(`the screen sent a document these tests do not answer: ${query.slice(0, 60)}`);
}

function callsTo(operation: string): (Record<string, unknown> | undefined)[] {
  return sent.mock.calls
    .filter(([query]) => query.includes(operation))
    .map(([, variables]) => variables);
}

beforeEach(() => {
  listing = [];
  sent.mockReset();
  sent.mockImplementation(<T,>(query: string, variables?: Record<string, unknown>) =>
    Promise.resolve(answer(query, variables) as T),
  );
});

function renderScreen() {
  const store = new Store(WORKSPACE);
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  return {
    user: userEvent.setup(),
    ...render(
      <MemoryRouter>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <Sessions />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    ),
  };
}

describe('Sessions', () => {
  it('marks this browser Current and lists it first', async () => {
    listing = [
      session('phone', 'Safari on iOS', { lastSeenAt: '2026-01-03T00:00:00Z' }),
      session('laptop', 'Chrome on macOS', { current: true, lastSeenAt: '2026-01-01T12:00:00Z' }),
    ];
    renderScreen();

    await screen.findByRole('table');
    const [, first, second] = screen.getAllByRole('row');
    expect(first?.textContent).toContain('Chrome on macOS');
    expect(first?.textContent).toContain('Current');
    expect(second?.textContent).toContain('Safari on iOS');
    expect(screen.getByRole('button', { name: 'Sign out this browser' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke Safari on iOS' })).toBeTruthy();
  });

  it('asks before revoking another device and sends nothing until it is answered', async () => {
    listing = [
      session('laptop', 'Chrome on macOS', { current: true }),
      session('phone', 'Safari on iOS'),
    ];
    const { user } = renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Revoke Safari on iOS' }));

    const dialog = screen.getByRole('dialog', { name: 'Revoke Safari on iOS?' });
    expect(dialog.textContent).toContain('will have to sign in again');
    expect(callsTo('mutation RevokeAccountSession')).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Revoke this session' }));

    await waitFor(() =>
      expect(callsTo('mutation RevokeAccountSession')).toEqual([{ id: 'phone' }]),
    );
    expect(screen.queryByText('Safari on iOS')).toBeNull();
  });

  it('revokes every other session from the header, keeping this browser', async () => {
    listing = [
      session('laptop', 'Chrome on macOS', { current: true }),
      session('phone', 'Safari on iOS'),
      session('work', 'Firefox on Linux'),
    ];
    const { user } = renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Revoke other sessions' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke other sessions?' });
    expect(dialog.textContent).toContain('All 2 other signed-in devices');

    await user.click(within(dialog).getByRole('button', { name: 'Revoke other sessions' }));

    await waitFor(() => expect(callsTo('mutation RevokeOtherSessions')).toEqual([undefined]));
    expect(screen.getByText('Chrome on macOS')).toBeTruthy();
    expect(screen.queryByText('Safari on iOS')).toBeNull();
    expect(screen.queryByText('Firefox on Linux')).toBeNull();
  });

  it('says so when the sessions cannot be fetched, and asks again when told to', async () => {
    listing = [session('laptop', 'Chrome on macOS', { current: true })];
    sent.mockImplementationOnce(() => Promise.reject(new ApiError('INTERNAL', 'nope')));
    const { user } = renderScreen();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not be fetched');
    expect(screen.queryByRole('table')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
