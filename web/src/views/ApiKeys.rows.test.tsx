/**
 * The API keys screen on the settings frame: the h1 the frame draws, "New key" as the
 * page's action, the count beside the section heading, and the listing — or its empty
 * state with its own way out — inside the card.
 *
 * A separate file from `ApiKeys.test.tsx` so nothing in that one had to move.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import type { ApiKeySummary } from '~/features/apikeys/mutations';
import { Store } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { ApiKeys } from './ApiKeys';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const sent = vi.mocked(gql);

let listing: ApiKeySummary[] = [];

function key(id: string, name: string): ApiKeySummary {
  return {
    id,
    userId: 'user-ada',
    name,
    prefix: `plk_${id}`,
    scopes: [],
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  listing = [];
  sent.mockReset();
  sent.mockImplementation(<T,>() => Promise.resolve({ apiKeys: listing } as T));
});

function renderScreen() {
  const store = new Store('workspace-1');
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <ApiKeys />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('ApiKeys rows', () => {
  it('sets the page as one h1 with "New key" beside it, and the listing under one h2', async () => {
    listing = [key('key-1', 'CI deploy bot'), key('key-2', 'Importer')];
    renderScreen();

    expect(screen.getByRole('heading', { level: 1, name: 'API keys' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New key' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'What a key can do' })).toBeTruthy();
    expect(await screen.findByText('2 keys')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
  });

  // The empty state keeps its own button: somebody with no keys is the person most likely
  // to be here to make one, and the page action is a title's height away.
  it('offers a key from the empty state, and the shortcut still opens the dialog', async () => {
    const user = renderScreen();

    expect(await screen.findByText('No API keys yet')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create a key' }));
    expect(screen.getByRole('dialog', { name: 'New API key' })).toBeTruthy();
  });
});
