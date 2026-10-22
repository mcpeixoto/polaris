/**
 * Escape, over a dashboard dialog with a name in it.
 *
 * Escape is the fastest key on the keyboard, and the name typed here exists nowhere else
 * until the dashboard is filed — so a clean dialog still closes on it and a named one asks
 * first. The third case is the one that matters: "Keep editing" has to leave the name where
 * it was, or the question is only a slower way of losing it.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CreateDashboardModal } from './CreateDashboardModal';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const VIEWER = '01900000-0000-7000-8000-000000000002';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, role: 'admin' }),
}));

function renderDialog() {
  const engine = { store: new Store(WORKSPACE), mutate: vi.fn() } as unknown as SyncEngine;
  const onClose = vi.fn();

  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <CreateDashboardModal onClose={onClose} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { user: userEvent.setup(), onClose };
}

afterEach(cleanup);

describe('discarding a new dashboard', () => {
  it('closes on Escape when nothing has been typed', async () => {
    const { user, onClose } = renderDialog();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Discard this dashboard?' })).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before throwing away a named dashboard', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Delivery');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: 'Discard this dashboard?' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on discard', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Delivery');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this dashboard?' });
    await user.click(within(question).getByRole('button', { name: 'Discard' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog, and the name in it, on keep editing', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Delivery');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this dashboard?' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Discard this dashboard?' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Delivery');
  });

  // The switch on its own, with nothing typed. It is a decision somebody made rather than
  // where this dialog opened it, which is the same line CreateTeamDialog draws around its
  // private toggle — and two sibling dialogs answering that question differently is how a
  // product ends up with two of everything.
  it('asks when only the personal switch was moved', async () => {
    const { user, onClose } = renderDialog();

    await user.click(screen.getByRole('switch'));
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: 'Discard this dashboard?' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
