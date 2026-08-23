import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function answer(query: string): unknown {
  if (query.includes('query Webhooks')) return { webhooks: listing };
  if (query.includes('mutation CreateWebhook')) {
    return {
      createWebhook: { version: 1, created: { secret: 'whsec_test', webhook: hook('wh-2') } },
    };
  }
  return {};
}

beforeEach(() => {
  listing = [hook('wh-1')];
  sent.mockReset();
  sent.mockImplementation(async (query: string) => answer(query) as never);
});

describe('Webhooks', () => {
  it('creates when the footer button is clicked, not only when Enter is pressed', async () => {
    // The footer button lives outside the <form> and reaches it through `form=`, which the
    // browser only honours on a submit button — and this Button defaults to type="button".
    // Without the explicit type the primary action of the dialogue silently does nothing:
    // no mutation, no error, no closed modal.
    listing = [];
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
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New webhook' }));
    await user.type(await screen.findByLabelText('URL'), 'https://hooks.example.com/polaris');
    await user.click(screen.getByRole('button', { name: 'Create webhook' }));

    await waitFor(() => {
      expect(
        sent.mock.calls.some(([query]) => String(query).includes('mutation CreateWebhook')),
      ).toBe(true);
    });
    // And the secret lands on screen, which is the only time it exists.
    expect(await screen.findByDisplayValue('whsec_test')).toBeTruthy();
  });

  it('lists a webhook from the query, not a spinner', async () => {
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
    expect(await screen.findByRole('heading', { name: 'Webhooks' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('https://hooks.example.com/polaris')).toBeTruthy();
    });
  });
});
