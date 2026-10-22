/**
 * Escape, over a customer dialog somebody has started filling in.
 *
 * The owner pill is pre-filled with the viewer, so a dialog that was only opened has
 * nothing to lose and closes on the first press; a name, a domain, or an owner handed to
 * somebody else is a decision, and gets the question.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CreateCustomerModal } from './CreateCustomerModal';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const ADA = '01900000-0000-7000-8000-000000000002';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => ADA,
  useViewer: () => ({ id: ADA, role: 'admin' }),
}));

function renderDialog() {
  const engine = { store: new Store(WORKSPACE), mutate: vi.fn() } as unknown as SyncEngine;
  const onClose = vi.fn();

  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <CreateCustomerModal onClose={onClose} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { user: userEvent.setup(), onClose };
}

afterEach(cleanup);

describe('discarding a new customer', () => {
  it('closes on Escape when nothing has been typed', async () => {
    const { user, onClose } = renderDialog();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Discard this customer?' })).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before throwing away a named customer', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Acme');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: 'Discard this customer?' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on discard', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Acme');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this customer?' });
    await user.click(within(question).getByRole('button', { name: 'Discard' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog, and the name in it, on keep editing', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Acme');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this customer?' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Discard this customer?' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Acme');
  });
});
