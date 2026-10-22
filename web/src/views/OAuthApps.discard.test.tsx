/**
 * Escape, over the two OAuth application dialogs.
 *
 * They answer the same question from opposite ends. The create dialog starts empty except
 * for the callback URL it pre-fills, so typing is what makes it worth asking about. The edit
 * dialog starts holding everything the application already is, so the question is whether a
 * field has been changed away from that — otherwise opening an application to read its
 * client id and pressing Escape would ask about work nobody did.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const APP: OauthClientSummary = {
  id: 'app-1',
  clientId: 'pol_app-1',
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
};

beforeEach(() => {
  sent.mockReset();
  sent.mockImplementation(async () => ({ oauthClients: [APP] }) as never);
});

afterEach(cleanup);

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
  return { user: userEvent.setup() };
}

async function openCreate() {
  const { user } = renderScreen();
  await user.click(await screen.findByRole('button', { name: 'New OAuth app' }));
  await screen.findByRole('dialog', { name: 'New OAuth application' });
  return { user };
}

async function openEdit() {
  const { user } = renderScreen();
  await user.click(await screen.findByRole('button', { name: 'Edit CI bot' }));
  await screen.findByRole('dialog', { name: 'Edit CI bot' });
  return { user };
}

describe('discarding an OAuth application being created', () => {
  it('closes on Escape when nothing has been typed', async () => {
    const { user } = await openCreate();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Discard this application?' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'New OAuth application' })).toBeNull();
  });

  it('asks before throwing away a named application', async () => {
    const { user } = await openCreate();

    await user.type(screen.getByLabelText('Name'), 'Deploy bot');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: 'Discard this application?' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'New OAuth application' })).toBeTruthy();
  });

  it('closes on discard', async () => {
    const { user } = await openCreate();

    await user.type(screen.getByLabelText('Name'), 'Deploy bot');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this application?' });
    await user.click(within(question).getByRole('button', { name: 'Discard' }));

    expect(screen.queryByRole('dialog', { name: 'New OAuth application' })).toBeNull();
  });

  it('keeps the dialog, and the name in it, on keep editing', async () => {
    const { user } = await openCreate();

    await user.type(screen.getByLabelText('Name'), 'Deploy bot');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this application?' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Discard this application?' })).toBeNull();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Deploy bot');
  });
});

describe('discarding edits to an OAuth application', () => {
  it('closes on Escape when the dialog still says what it opened with', async () => {
    const { user } = await openEdit();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Discard these changes?' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Edit CI bot' })).toBeNull();
  });

  it('asks once a field has been changed', async () => {
    const { user } = await openEdit();

    await user.type(screen.getByLabelText('Name'), ' two');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: 'Discard these changes?' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Edit CI bot' })).toBeTruthy();
  });

  it('closes on discard, and keeps the edit on keep editing', async () => {
    const { user } = await openEdit();

    await user.type(screen.getByLabelText('Name'), ' two');
    await user.keyboard('{Escape}');
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Discard these changes?' })).getByRole(
        'button',
        { name: 'Cancel' },
      ),
    );
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('CI bot two');

    await user.keyboard('{Escape}');
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Discard these changes?' })).getByRole(
        'button',
        { name: 'Discard' },
      ),
    );
    expect(screen.queryByRole('dialog', { name: 'Edit CI bot' })).toBeNull();
  });
});
