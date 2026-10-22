/**
 * Escape, over the new-webhook dialog.
 *
 * The URL is the typing: the scope and the resource types open pre-selected, so a dialog
 * opened and immediately dismissed must not ask anything. The secret screen that follows a
 * successful create has its own rule — it answers Escape rather than obeying it — and is
 * covered in Webhooks.test.tsx; nothing here touches it.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import { gql } from '~/sync/api';
import type { SyncEngine } from '~/sync/engine';

import { Webhooks } from './Webhooks';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const sent = vi.mocked(gql);

beforeEach(() => {
  sent.mockReset();
  sent.mockImplementation(async () => ({ webhooks: [] }) as never);
});

afterEach(cleanup);

async function openDialog() {
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
  await screen.findByRole('dialog', { name: 'New webhook' });
  return { user };
}

describe('discarding a webhook being created', () => {
  it('closes on Escape when no URL has been typed', async () => {
    const { user } = await openDialog();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Discard this webhook?' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'New webhook' })).toBeNull();
  });

  it('asks before throwing away a typed URL', async () => {
    const { user } = await openDialog();

    await user.type(screen.getByLabelText('URL'), 'https://hooks.example.com/polaris');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: 'Discard this webhook?' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'New webhook' })).toBeTruthy();
  });

  it('closes on discard', async () => {
    const { user } = await openDialog();

    await user.type(screen.getByLabelText('URL'), 'https://hooks.example.com/polaris');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this webhook?' });
    await user.click(within(question).getByRole('button', { name: 'Discard' }));

    expect(screen.queryByRole('dialog', { name: 'New webhook' })).toBeNull();
  });

  it('keeps the dialog, and the URL in it, on keep editing', async () => {
    const { user } = await openDialog();

    await user.type(screen.getByLabelText('URL'), 'https://hooks.example.com/polaris');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this webhook?' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Discard this webhook?' })).toBeNull();
    expect((screen.getByLabelText('URL') as HTMLInputElement).value).toBe(
      'https://hooks.example.com/polaris',
    );
  });
});
