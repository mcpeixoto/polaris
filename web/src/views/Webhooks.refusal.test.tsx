/**
 * What this screen does when the server says no.
 *
 * Both paths used to say nothing at all. Deleting attached `.finally` with no `.catch`, so a
 * refused delete was a silent no-op plus an unhandled rejection; toggling was
 * `void setWebhookEnabled(...).then(reload)`, and the screen's own header comment points out
 * that it deliberately holds no optimistic patch — which makes the missing failure path the
 * only signal there was, and it was absent.
 *
 * A separate file from `Webhooks.test.tsx` so nothing in that one had to move.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import type { WebhookSummary } from '~/features/webhooks/mutations';
import { Store } from '~/store';
import { ApiError, gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Webhooks } from './Webhooks';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const sent = vi.mocked(gql);

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

/** The one refusal these tests care about, spelled the way the server spells one. */
function refusal(message: string): ApiError {
  return new ApiError('FORBIDDEN', message);
}

let refuse: { on: string; error: ApiError } | null = null;

beforeEach(() => {
  refuse = null;
  sent.mockReset();
  sent.mockImplementation(async (query: string) => {
    if (refuse !== null && String(query).includes(refuse.on)) throw refuse.error;
    if (String(query).includes('query Webhooks')) return { webhooks: [hook('wh-1')] } as never;
    return {} as never;
  });
});

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
  return userEvent.setup();
}

describe('Webhooks refusals', () => {
  it('keeps the delete dialog open and shows the reason inside it', async () => {
    refuse = { on: 'mutation DeleteWebhook', error: refusal('this key may not delete webhooks') };
    const user = renderScreen();

    await user.click(
      await screen.findByRole('button', {
        name: 'Delete the webhook for https://hooks.example.com/polaris',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Delete webhook' }));

    // Inside the dialog — the page banner renders underneath an open modal, where a refusal
    // reads as a dialog that quietly did nothing.
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.textContent).toContain('this key may not delete webhooks');
    });
    expect(screen.getByRole('button', { name: 'Delete webhook' })).toBeTruthy();
  });

  it('says so on the row when enabling is refused', async () => {
    refuse = { on: 'mutation UpdateWebhook', error: refusal('that webhook is locked') };
    const user = renderScreen();

    await user.click(
      await screen.findByRole('button', {
        name: 'Disable the webhook for https://hooks.example.com/polaris',
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('that webhook is locked');
    });
  });

  it('names the webhook each row action acts on', async () => {
    renderScreen();
    // Twelve rows must not produce twelve buttons all called "Delete".
    expect(
      await screen.findByRole('button', {
        name: 'Delete the webhook for https://hooks.example.com/polaris',
      }),
    ).toBeTruthy();
  });
});
