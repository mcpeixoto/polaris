/**
 * Escape, over the Pulse feed dialog.
 *
 * One component serves both a new feed and an existing one, so "dirty" is the same sentence
 * read twice: the name differs from the name the dialog opened with. For a new feed that is
 * an empty string; for an edit it is the feed's own name, which is why re-opening a feed and
 * pressing Escape has to be silent.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Pulse } from './Pulse';

const AT = '2026-08-20T12:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => 'u1',
  useViewerRole: () => 'member',
  useViewer: () => ({
    id: 'u1',
    workspaceId: 'w1',
    name: 'Ada',
    displayName: 'Ada',
    timezone: 'UTC',
    role: 'member',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  }),
}));

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: 'u1' },
    payload: entity,
  };
}

function renderPulse(extra: readonly Change[] = []) {
  const store = new Store('w1');
  store.applyChanges([
    upsert(1, 'workspace', {
      id: 'w1',
      name: 'Acme',
      urlKey: 'acme',
      plan: 'free',
      projectUpdateReminderIntervalDays: 7,
      projectUpdateReminderWeekday: 3,
      projectUpdateReminderHour: 9,
      pulseEnabled: true,
      customerRequestsEnabled: true,
      customerRevenueUnit: '',
      customerTiers: [],
      pulseDigestCadence: 'daily',
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(2, 'user', {
      id: 'u1',
      workspaceId: 'w1',
      name: 'Ada',
      displayName: 'Ada',
      timezone: 'UTC',
      role: 'member',
      status: 'active',
      kind: 'human',
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(3, 'project', {
      id: 'p1',
      workspaceId: 'w1',
      name: 'Launch',
      description: '',
      color: '#000',
      statusId: 'st1',
      priority: 0,
      sortOrder: 'a0',
      updateSchedule: 'default',
      leadId: 'u1',
      createdAt: AT,
      updatedAt: AT,
    }),
    ...extra,
  ]);
  const engine = { store, mutate: vi.fn() } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Pulse />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { user: userEvent.setup() };
}

const FEED: Change = {
  v: 4,
  type: 'pulseFeed',
  id: 'f1',
  op: 'upsert',
  actor: { type: 'user', id: 'u1' },
  payload: {
    id: 'f1',
    workspaceId: 'w1',
    userId: 'u1',
    name: 'Shipping',
    projectIds: ['p1'],
    createdAt: AT,
    updatedAt: AT,
  },
};

async function openNew() {
  const { user } = renderPulse();
  await user.click(await screen.findByRole('button', { name: 'New feed' }));
  await screen.findByRole('dialog', { name: 'New feed' });
  return { user };
}

async function openEdit() {
  const { user } = renderPulse([FEED]);
  await user.click(await screen.findByRole('tab', { name: 'Shipping' }));
  await user.click(screen.getByRole('button', { name: 'Edit feed' }));
  await screen.findByRole('dialog', { name: 'Edit feed' });
  return { user };
}

afterEach(cleanup);

describe('discarding a Pulse feed being created', () => {
  it('closes on Escape when nothing has been typed', async () => {
    const { user } = await openNew();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Discard this feed?' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'New feed' })).toBeNull();
  });

  it('asks before throwing away a named feed', async () => {
    const { user } = await openNew();

    await user.type(screen.getByLabelText('Name'), 'Shipping');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: 'Discard this feed?' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'New feed' })).toBeTruthy();
  });

  it('closes on discard', async () => {
    const { user } = await openNew();

    await user.type(screen.getByLabelText('Name'), 'Shipping');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this feed?' });
    await user.click(within(question).getByRole('button', { name: 'Discard' }));

    expect(screen.queryByRole('dialog', { name: 'New feed' })).toBeNull();
  });

  it('keeps the dialog, and the name in it, on keep editing', async () => {
    const { user } = await openNew();

    await user.type(screen.getByLabelText('Name'), 'Shipping');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this feed?' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Discard this feed?' })).toBeNull();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Shipping');
  });
});

describe('discarding edits to a Pulse feed', () => {
  it('closes on Escape when the name is still the one it opened with', async () => {
    const { user } = await openEdit();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Discard these changes?' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Edit feed' })).toBeNull();
  });

  it('asks once the name has been changed', async () => {
    const { user } = await openEdit();

    await user.type(screen.getByLabelText('Name'), ' soon');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: 'Discard these changes?' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Edit feed' })).toBeTruthy();
  });
});
