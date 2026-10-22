/**
 * Escape out of the customer-request dialog.
 *
 * The case worth a test is the seeded one: this dialog is normally opened from an issue or a
 * customer page and arrives with those ids already in it, so a `dirty` that compared against
 * empty would ask "are you sure" every time somebody opened it and changed their mind.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity, type UUID } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CreateCustomerRequestModal } from './CreateCustomerRequestModal';
import { createCustomerRequest } from './mutations';

vi.mock('./mutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mutations')>();
  return { ...actual, createCustomerRequest: vi.fn(() => Promise.resolve('request-1')) };
});

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => ADA,
  useViewer: () => ({ id: ADA, role: 'admin' }),
}));

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const ADA = '01900000-0000-7000-8000-000000000002';
const TEAM = '01900000-0000-7000-8000-000000000003';
const CUSTOMER = '01900000-0000-7000-8000-000000000004';
const ISSUE = '01900000-0000-7000-8000-000000000005';

const AT = '2026-01-01T00:00:00.000Z';

const filed = vi.mocked(createCustomerRequest);

function rows(): [string, Entity][] {
  return [
    [
      'team',
      {
        id: TEAM,
        workspaceId: WORKSPACE,
        key: 'ENG',
        name: 'Engineering',
        timezone: 'UTC',
        private: false,
        estimateScale: 'none',
        estimateAllowZero: false,
        estimateExtended: false,
        cyclesEnabled: false,
        cycleDurationWeeks: 1,
        cycleCooldownWeeks: 0,
        cycleStartDay: 'monday',
        cycleUpcomingCount: 2,
        cycleAutoAddStarted: false,
        cycleAutoAddCompleted: false,
        triageEnabled: false,
        triageRequirePriority: false,
        autoCloseDays: 0,
        autoArchiveDays: 0,
        autoCloseParent: false,
        autoCloseChildren: false,
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
    [
      'customer',
      {
        id: CUSTOMER,
        workspaceId: WORKSPACE,
        name: 'Globex',
        domains: [],
        status: 'active',
        sortOrder: 'a',
        logoUrl: '',
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
    [
      'issue',
      {
        id: ISSUE,
        workspaceId: WORKSPACE,
        teamId: TEAM,
        number: 12,
        identifier: 'ENG-12',
        title: 'Single sign-on',
        stateId: '01900000-0000-7000-8000-000000000007',
        priority: 0,
        sortOrder: 'a',
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
  ];
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges(
    rows().map(([type, payload], index) => ({
      v: index + 1,
      type,
      id: (payload as { id: string }).id,
      op: 'upsert' as const,
      actor: { type: 'system' as const },
      payload,
    })) as Change[],
  );
  return store;
}

function renderDialog(props: { issueId?: UUID; customerId?: UUID } = {}) {
  const engine = { store: seeded(), mutate: vi.fn() } as unknown as SyncEngine;
  const onClose = vi.fn();

  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <CreateCustomerRequestModal onClose={onClose} {...props} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { user: userEvent.setup(), onClose };
}

const QUESTION = 'Discard this request?';

beforeEach(() => {
  filed.mockClear();
  filed.mockResolvedValue('request-1');
});
afterEach(cleanup);

describe('CreateCustomerRequestModal discard guard', () => {
  it('closes on Escape when nothing has been written', async () => {
    const { user, onClose } = renderDialog();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: QUESTION })).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape when it was opened on an issue and a customer and left alone', async () => {
    const { user, onClose } = renderDialog({ issueId: ISSUE, customerId: CUSTOMER });

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: QUESTION })).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks instead of closing when there is a request written', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Request'), 'SSO with Okta please.');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: QUESTION })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on discard', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Request'), 'SSO with Okta please.');
    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Discard' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog, and what was written in it, on keep editing', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Request'), 'SSO with Okta please.');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: QUESTION });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: QUESTION })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Request') as HTMLTextAreaElement).value).toBe(
      'SSO with Okta please.',
    );
  });
});
