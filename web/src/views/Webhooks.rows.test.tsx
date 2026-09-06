/**
 * Webhooks on the settings frame: the create button beside the title, the explanation under
 * one section heading, and the table on that section's card with both row actions named.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import type { WebhookSummary } from '~/features/webhooks/mutations';
import { Store } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Webhooks } from './Webhooks';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const sent = vi.mocked(gql);

let listing: WebhookSummary[] = [];

function hook(id: string, over: Partial<WebhookSummary> = {}): WebhookSummary {
  return {
    id,
    url: 'https://hooks.example.com/polaris',
    enabled: true,
    allPublicTeams: true,
    teamId: null,
    resourceTypes: ['Issue'],
    consecutiveFailures: 0,
    disabledAt: null,
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
          <Webhooks />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listing = [hook('wh-1'), hook('wh-2', { enabled: false, url: 'https://off.example.com/x' })];
  sent.mockReset();
  sent.mockImplementation(
    async (query: string) =>
      (query.includes('query Webhooks') ? { webhooks: listing } : {}) as never,
  );
});

describe('Webhooks rows', () => {
  it('puts the create button beside the title and the table under the heading', async () => {
    renderScreen();

    expect(await screen.findByRole('heading', { level: 1, name: 'Webhooks' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New webhook' })).toBeTruthy();

    const section = screen
      .getByRole('heading', { level: 2, name: 'Push, signed' })
      .closest('section') as HTMLElement;
    expect(section.textContent).toContain('signed with HMAC-SHA256');
    await waitFor(() => {
      expect(within(section).getByRole('table')).toBeTruthy();
    });
    expect(
      within(section).getByRole('button', {
        name: 'Disable the webhook for https://hooks.example.com/polaris',
      }),
    ).toBeTruthy();
    expect(
      within(section).getByRole('button', {
        name: 'Enable the webhook for https://off.example.com/x',
      }),
    ).toBeTruthy();
    expect(within(section).getByText('Disabled')).toBeTruthy();
  });
});
