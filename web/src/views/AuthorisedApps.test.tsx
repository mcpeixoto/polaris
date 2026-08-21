import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import type { AuthorisedOauthAppSummary } from '~/features/authorisedOauth/mutations';
import { Store } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { AuthorisedApps } from './AuthorisedApps';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const sent = vi.mocked(gql);

const AT = '2026-01-01T00:00:00Z';
const SEEN = '2026-01-02T00:00:00Z';

let listing: AuthorisedOauthAppSummary[] = [];

function app(
  id: string,
  name: string,
  over: Partial<AuthorisedOauthAppSummary> = {},
): AuthorisedOauthAppSummary {
  return {
    id,
    name,
    clientId: `client-${id}`,
    imageUrl: null,
    developer: null,
    scopes: ['read'],
    lastUsedAt: SEEN,
    createdAt: AT,
    ...over,
  };
}

function answer(query: string, variables?: Record<string, unknown>): unknown {
  if (query.includes('query AuthorisedOauthApps')) {
    return { authorisedOauthApps: listing };
  }
  if (query.includes('mutation RevokeAuthorisedOauthApp')) {
    listing = listing.filter((row) => row.id !== variables?.id);
    return { revokeAuthorisedOauthApp: { version: 1, id: variables?.id } };
  }
  throw new Error(`unanswered document: ${query.slice(0, 60)}`);
}

beforeEach(() => {
  listing = [];
  sent.mockReset();
  sent.mockImplementation(<T,>(query: string, variables?: Record<string, unknown>) =>
    Promise.resolve(answer(query, variables) as T),
  );
});

function renderScreen() {
  const store = new Store('workspace-1');
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  return {
    user: userEvent.setup(),
    ...render(
      <MemoryRouter>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <AuthorisedApps />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    ),
  };
}

describe('AuthorisedApps', () => {
  it('lists grants and revokes one', async () => {
    listing = [app('notes', 'Notes', { scopes: ['read', 'write'] }), app('bot', 'Bot')];
    const { user } = renderScreen();
    expect(await screen.findByRole('heading', { name: 'Authorised apps' })).toBeTruthy();
    expect(screen.getByText('Notes')).toBeTruthy();
    expect(screen.getByText('read write')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Revoke Notes' }));
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(screen.queryByText('Notes')).toBeNull());
    expect(screen.getByText('Bot')).toBeTruthy();
  });

  it('shows an empty state when nothing is authorised', async () => {
    renderScreen();
    expect(await screen.findByText('No authorised apps')).toBeTruthy();
  });
});
