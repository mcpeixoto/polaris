/**
 * The sessions screen on the settings frame: the h1 the frame draws, the count beside the
 * section heading, and "Revoke other sessions" as the page's action — present only when
 * there is another session to revoke.
 *
 * A separate file from `Sessions.test.tsx` so nothing in that one had to move.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import type { AccountSessionSummary } from '~/features/sessions/mutations';
import { Store } from '~/store';
import { gql } from '~/sync/api';
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

let listing: AccountSessionSummary[] = [];

function session(id: string, label: string, current: boolean): AccountSessionSummary {
  return {
    id,
    label,
    userAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
    ip: '203.0.113.10',
    country: 'PT',
    current,
    lastSeenAt: '2026-01-02T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-02-01T00:00:00Z',
  };
}

beforeEach(() => {
  listing = [];
  sent.mockReset();
  sent.mockImplementation(<T,>() => Promise.resolve({ accountSessions: listing } as T));
});

function renderScreen() {
  const store = new Store('workspace-1');
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  return render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Sessions />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('Sessions rows', () => {
  it('sets the page as one h1 and the listing under one h2, with the count beside it', async () => {
    listing = [
      session('laptop', 'Chrome on macOS', true),
      session('phone', 'Safari on iOS', false),
    ];
    renderScreen();

    expect(screen.getByRole('heading', { level: 1, name: 'Sessions' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Where you are signed in' })).toBeTruthy();
    expect(await screen.findByText('2 sessions')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke other sessions' })).toBeTruthy();
  });

  // With nothing else to revoke, the page offers no way to revoke nothing.
  it('offers no "Revoke other sessions" when this browser is the only session', async () => {
    listing = [session('laptop', 'Chrome on macOS', true)];
    renderScreen();

    expect(await screen.findByText('1 session')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revoke other sessions' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out this browser' })).toBeTruthy();
  });

  it('says so inside the card when there are no live sessions', async () => {
    renderScreen();
    expect(await screen.findByText('No live sessions')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
