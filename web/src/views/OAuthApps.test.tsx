import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import type { OauthClientSummary } from '~/features/oauth/mutations';
import { Store } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { OAuthApps } from './OAuthApps';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const sent = vi.mocked(gql);

let listing: OauthClientSummary[] = [];

function app(id: string, over: Partial<OauthClientSummary> = {}): OauthClientSummary {
  return {
    id,
    clientId: `pol_${id}`,
    name: 'CI bot',
    description: null,
    developer: null,
    developerUrl: null,
    redirectUris: ['https://example.com/callback'],
    allowedScopes: ['read', 'write'],
    publicEnabled: false,
    clientCredentialsEnabled: false,
    webhookUrl: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function answer(query: string): unknown {
  if (query.includes('query OauthClients')) return { oauthClients: listing };
  return {};
}

beforeEach(() => {
  listing = [app('app-1')];
  sent.mockReset();
  sent.mockImplementation(async (query: string) => answer(query) as never);
});

describe('OAuthApps', () => {
  it('lists an application from the query, not a spinner', async () => {
    const engine = { store: new Store('w1'), mutate: vi.fn() } as unknown as SyncEngine;
    render(
      <MemoryRouter>
        <KeymapProvider>
          <EngineProvider engine={engine} status={{ phase: 'idle' }}>
            <OAuthApps />
          </EngineProvider>
        </KeymapProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'OAuth apps' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('CI bot')).toBeTruthy();
      expect(screen.getByText('pol_app-1')).toBeTruthy();
    });
  });
});
