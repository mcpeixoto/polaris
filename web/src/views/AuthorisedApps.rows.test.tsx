/**
 * The authorised-apps screen on the settings frame: the h1 the frame draws, the count
 * beside the section heading, and the listing — or its empty state — inside the card.
 *
 * A separate file from `AuthorisedApps.test.tsx` so nothing in that one had to move.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import type { AuthorisedOauthAppSummary } from '~/features/authorisedOauth/mutations';
import { Store } from '~/store';
import { ApiError, gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { AuthorisedApps } from './AuthorisedApps';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const sent = vi.mocked(gql);

let listing: AuthorisedOauthAppSummary[] = [];

function app(id: string, name: string): AuthorisedOauthAppSummary {
  return {
    id,
    name,
    clientId: `client-${id}`,
    imageUrl: null,
    developer: null,
    scopes: ['read'],
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  listing = [];
  sent.mockReset();
  sent.mockImplementation(<T,>() => Promise.resolve({ authorisedOauthApps: listing } as T));
});

function renderScreen() {
  const store = new Store('workspace-1');
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  return render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <AuthorisedApps />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

describe('AuthorisedApps rows', () => {
  it('sets the page as one h1 and the listing under one h2, with the count beside it', async () => {
    listing = [app('notes', 'Notes'), app('bot', 'Bot')];
    renderScreen();

    expect(screen.getByRole('heading', { level: 1, name: 'Authorised apps' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Apps you have allowed' })).toBeTruthy();
    expect(await screen.findByText('2 apps')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('says the page has one app when it has one', async () => {
    listing = [app('notes', 'Notes')];
    renderScreen();
    expect(await screen.findByText('1 app')).toBeTruthy();
  });

  // The failure keeps its way out beside it: the alert and the retry are one row, not a
  // banner in one place and a button somewhere else.
  it('keeps the fetch failure and its retry together', async () => {
    sent.mockImplementationOnce(() => Promise.reject(new ApiError('INTERNAL', 'nope')));
    renderScreen();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not be fetched');
    expect(alert.contains(screen.getByRole('button', { name: 'Try again' }))).toBe(true);
  });
});
