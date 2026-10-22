/**
 * Escape, over the dialog that is about to mint a key.
 *
 * The name is the only thing in here nobody else has a copy of, and it is also the field the
 * dialog refuses to create a key without — so Escape on a named-but-unsaved key is the one
 * keystroke in this screen that loses work. The scopes and the expiry are deliberately not
 * part of the question; see the `dirty` note in ApiKeys.tsx.
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

import { ApiKeys } from './ApiKeys';

vi.mock('~/sync/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/sync/api')>();
  return { ...actual, gql: vi.fn() };
});

const sent = vi.mocked(gql);

beforeEach(() => {
  sent.mockReset();
  sent.mockImplementation(async () => ({ apiKeys: [] }) as never);
});

afterEach(cleanup);

async function openDialog() {
  const engine = { store: new Store('w1'), mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <ApiKeys />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'New key' }));
  await screen.findByRole('dialog', { name: 'New API key' });
  return { user };
}

describe('discarding an API key being created', () => {
  it('closes on Escape when nothing has been typed', async () => {
    const { user } = await openDialog();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Discard this key?' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'New API key' })).toBeNull();
  });

  it('asks before throwing away a named key', async () => {
    const { user } = await openDialog();

    await user.type(screen.getByLabelText('Name'), 'CI deploy bot');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: 'Discard this key?' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'New API key' })).toBeTruthy();
  });

  it('closes on discard', async () => {
    const { user } = await openDialog();

    await user.type(screen.getByLabelText('Name'), 'CI deploy bot');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this key?' });
    await user.click(within(question).getByRole('button', { name: 'Discard' }));

    expect(screen.queryByRole('dialog', { name: 'New API key' })).toBeNull();
  });

  it('keeps the dialog, and the name in it, on keep editing', async () => {
    const { user } = await openDialog();

    await user.type(screen.getByLabelText('Name'), 'CI deploy bot');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this key?' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Discard this key?' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'New API key' })).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('CI deploy bot');
  });
});
