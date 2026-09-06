/**
 * OAuth apps on the settings frame: the count and the create button beside the title, the
 * explanation under one section heading, and the table on that section's card.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
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

function renderScreen() {
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
}

beforeEach(() => {
  listing = [app('app-1')];
  sent.mockReset();
  sent.mockImplementation(
    async (query: string) =>
      (query.includes('query OauthClients') ? { oauthClients: listing } : {}) as never,
  );
});

describe('OAuthApps rows', () => {
  it('puts the count and the create button beside the title, and the table under the heading', async () => {
    renderScreen();

    expect(await screen.findByRole('heading', { level: 1, name: 'OAuth apps' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New OAuth app' })).toBeTruthy();
    expect(await screen.findByText('1 app')).toBeTruthy();

    const section = screen
      .getByRole('heading', { level: 2, name: 'Third-party access' })
      .closest('section') as HTMLElement;
    expect(section.textContent).toContain('The client secret is shown once');
    await waitFor(() => {
      expect(within(section).getByRole('table')).toBeTruthy();
    });
    expect(within(section).getByRole('button', { name: 'Edit CI bot' })).toBeTruthy();
  });

  it('keeps the empty state on the card', async () => {
    listing = [];
    renderScreen();
    const section = (
      await screen.findByRole('heading', { level: 2, name: 'Third-party access' })
    ).closest('section') as HTMLElement;
    expect(await within(section).findByText('No OAuth applications yet')).toBeTruthy();
  });
});
