/**
 * The customer-request dialog, from the outside.
 *
 * It carried three stacked native `<select>`s, one of them over two hundred issues, and the
 * thing that breaks in the conversion to menus is the wiring: a picker that shows the right
 * name and hands the mutation the wrong id — or nothing at all — looks identical on screen.
 * So the first case drives all three pickers and asserts the whole argument.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
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
const PROJECT = '01900000-0000-7000-8000-000000000006';
const STATE = '01900000-0000-7000-8000-000000000007';

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
        stateId: STATE,
        priority: 0,
        sortOrder: 'a',
        createdAt: AT,
        updatedAt: AT,
      } as Entity,
    ],
    [
      'project',
      {
        id: PROJECT,
        workspaceId: WORKSPACE,
        name: 'Rollout',
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

function renderDialog() {
  const engine = { store: seeded(), mutate: vi.fn() } as unknown as SyncEngine;
  const onClose = vi.fn();

  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <CreateCustomerRequestModal onClose={onClose} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { user: userEvent.setup(), onClose };
}

beforeEach(() => {
  filed.mockClear();
  filed.mockResolvedValue('request-1');
});
afterEach(cleanup);

describe('CreateCustomerRequestModal', () => {
  it('sends the customer, the issue and the importance the pickers were left on', async () => {
    const { user } = renderDialog();

    await user.type(screen.getByLabelText('Request'), 'SSO with Okta please.');

    await user.click(screen.getByRole('button', { name: 'No customer' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Globex' }));

    await user.click(screen.getByRole('button', { name: 'No issue' }));
    await user.click(await screen.findByRole('menuitem', { name: /Single sign-on/ }));

    await user.click(screen.getByRole('switch', { name: 'Mark as important' }));
    await user.click(screen.getByRole('button', { name: 'Add request' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed.mock.calls[0]?.[1]).toMatchObject({
      body: 'SSO with Okta please.',
      customerId: CUSTOMER,
      issueId: ISSUE,
      important: true,
    });
  });

  it('attaches to a project when that is the picker that was used', async () => {
    const { user } = renderDialog();

    await user.type(screen.getByLabelText('Request'), 'They want a rollout plan.');
    await user.click(screen.getByRole('button', { name: 'No project' }));
    await user.click(await screen.findByRole('menuitem', { name: /Rollout/ }));
    await user.click(screen.getByRole('button', { name: 'Add request' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed.mock.calls[0]?.[1]).toMatchObject({ projectId: PROJECT });
  });

  it('says what is missing rather than filing a request attached to nothing', async () => {
    const { user } = renderDialog();

    await user.type(screen.getByLabelText('Request'), 'Floating.');
    await user.click(screen.getByRole('button', { name: 'Add request' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Attach this request to an issue or a project');
    expect(filed).not.toHaveBeenCalled();
  });

  it('files exactly once when the chord is pressed twice in one tick', async () => {
    const { user } = renderDialog();

    await user.type(screen.getByLabelText('Request'), 'Twice.');
    await user.click(screen.getByRole('button', { name: 'No issue' }));
    await user.click(await screen.findByRole('menuitem', { name: /Single sign-on/ }));

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed).toHaveBeenCalledTimes(1);
  });
});
