/**
 * The customer dialog, from the outside.
 *
 * The owner is the case worth a test of its own: it used to be whoever opened the dialog,
 * with no control and nothing on screen saying so, which put every request for that account
 * on the desk of the person doing the data entry. It is now a pill, and a pill that shows a
 * person it does not send is the same bug wearing a better hat.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CreateCustomerModal } from './CreateCustomerModal';
import { createCustomer } from './mutations';

vi.mock('./mutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mutations')>();
  return { ...actual, createCustomer: vi.fn(() => Promise.resolve('customer-1')) };
});

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => ADA,
  useViewer: () => ({ id: ADA, role: 'admin' }),
}));

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const ADA = '01900000-0000-7000-8000-000000000002';
const GRACE = '01900000-0000-7000-8000-000000000003';

const AT = '2026-01-01T00:00:00.000Z';

const filed = vi.mocked(createCustomer);

function person(id: string, displayName: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    email: `${displayName.split(' ')[0]?.toLowerCase() ?? 'x'}@example.com`,
    displayName,
    timezone: 'UTC',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    [person(ADA, 'Ada Lovelace'), person(GRACE, 'Grace Hopper')].map((payload, index) => ({
      v: index + 1,
      type: 'user',
      id: (payload as { id: string }).id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload,
    })) as Change[],
  );
  return store;
}

function renderDialog() {
  const engine = { store: seeded(), mutate: vi.fn() } as unknown as SyncEngine;
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

beforeEach(() => {
  filed.mockClear();
  filed.mockResolvedValue('customer-1');
});
afterEach(cleanup);

describe('CreateCustomerModal', () => {
  it('offers the viewer as the owner and sends whoever the pill ends on', async () => {
    const { user } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Ada Lovelace' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Grace Hopper' }));
    await user.click(screen.getByRole('button', { name: 'Create customer' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed.mock.calls[0]?.[1]).toMatchObject({ name: 'Acme', ownerId: GRACE });
  });

  it('offers Cancel as a ghost, so the footer has one primary', () => {
    renderDialog();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel.className).toContain('ghost');
  });

  it('files exactly once when the chord is pressed twice in one tick', async () => {
    const { user } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Acme');

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed).toHaveBeenCalledTimes(1);
  });
});
