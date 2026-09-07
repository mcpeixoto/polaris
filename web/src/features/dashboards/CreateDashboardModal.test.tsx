/**
 * The dashboard dialog, from the outside.
 *
 * Two things that fail silently and cost a row each: a toggle that is on screen and not on
 * the wire, and a second ⌘⏎ in the tick before `saving` has re-rendered. The first makes a
 * private dashboard everybody can see; the second makes two dashboards with one name.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CreateDashboardModal } from './CreateDashboardModal';
import { createDashboard } from './mutations';

vi.mock('./mutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mutations')>();
  return { ...actual, createDashboard: vi.fn(() => Promise.resolve('dashboard-1')) };
});

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, role: 'admin' }),
}));

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const VIEWER = '01900000-0000-7000-8000-000000000002';

const filed = vi.mocked(createDashboard);

function renderDialog() {
  const store = new Store(WORKSPACE);
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
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

beforeEach(() => {
  filed.mockClear();
  filed.mockResolvedValue('dashboard-1');
});
afterEach(cleanup);

describe('CreateDashboardModal', () => {
  it('sends the personal switch as the dashboard’s privacy', async () => {
    const { user } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Delivery');
    await user.click(screen.getByRole('switch', { name: 'Personal — only visible to you' }));
    await user.click(screen.getByRole('button', { name: 'Create dashboard' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed.mock.calls[0]?.[1]).toMatchObject({
      name: 'Delivery',
      private: true,
      ownerId: VIEWER,
    });
  });

  it('files exactly once when the chord is pressed twice in one tick', async () => {
    const { user } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Delivery');

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open and says why when the create is refused', async () => {
    filed.mockRejectedValueOnce(new Error('nope'));
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Delivery');
    await user.click(screen.getByRole('button', { name: 'Create dashboard' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Could not create the dashboard');
    expect(onClose).not.toHaveBeenCalled();
  });
});
