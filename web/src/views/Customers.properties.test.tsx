/**
 * The status, tier and owner columns are the way to change those things, and they are not
 * the way to open the customer.
 *
 * Same trade the project row's priority glyph makes — a button inside a link, the click
 * stopped before the anchor sees it — so the two claims worth pinning are the two halves of
 * it: the press reaches the picker and never the link, and what is chosen is written to the
 * customer whose cell was pressed rather than to whichever row the cursor happened to be on.
 *
 * The third is about the tier column specifically. A tier is free text with an optional
 * workspace list behind it, so a workspace that has named none has nothing to pick from,
 * and the column has to stay a plain cell rather than become a menu that can only clear.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Customers } from './Customers';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewerRole: () => 'admin',
}));

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return {
    v,
    type,
    id: entity.id,
    op: 'upsert',
    actor: { type: 'user', id: VIEWER },
    payload: entity,
  };
}

function workspace(tiers: readonly string[]): Entity {
  return {
    id: WORKSPACE,
    name: 'Acme Inc',
    urlKey: 'acme',
    plan: 'free',
    projectUpdateReminderIntervalDays: 7,
    projectUpdateReminderWeekday: 3,
    projectUpdateReminderHour: 9,
    pulseEnabled: true,
    pulseDigestCadence: 'off',
    customerRequestsEnabled: true,
    customerRevenueUnit: '',
    customerTiers: [...tiers],
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function person(id: string, displayName: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name: displayName.toLowerCase().replace(' ', '-'),
    displayName,
    timezone: 'UTC',
    role: 'admin',
    status: 'active',
    kind: 'human',
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function customer(id: string, name: string, extra: Record<string, unknown> = {}): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    domains: [],
    status: 'active',
    logoUrl: '',
    sortOrder: 'V',
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  } as Entity;
}

function seeded(tiers: readonly string[] = ['Enterprise', 'Starter']): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'workspace', workspace(tiers)),
    upsert(2, 'user', person(VIEWER, 'Ada Lovelace')),
    upsert(3, 'user', person('u2', 'Grace Hopper')),
    upsert(4, 'customer', customer('c-acme', 'Acme', { tier: 'Enterprise', ownerId: VIEWER })),
    upsert(5, 'customer', customer('c-blue', 'Bluebird', { status: 'prospect' })),
  ]);
  return store;
}

/** What `updateCustomer` puts on the wire, as far as this file reads it. */
interface Written {
  variables: {
    input: { id: string; status?: string; tier?: string; ownerId?: string; clearTier?: boolean };
  };
  optimistic: readonly { type: string; id: string }[];
}

function mount(store: Store = seeded()) {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/customers']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/customers" element={<Customers />} />
            <Route path="/customer/:customerId" element={<p>opened</p>} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

function row(name: string): HTMLElement {
  return screen.getByRole('link', { name: new RegExp(name) });
}

/** The first thing the engine was asked to write. */
function firstWrite(mutate: ReturnType<typeof vi.fn>): Written {
  return mutate.mock.calls[0]?.[0] as Written;
}

afterEach(cleanup);

describe('Customers row properties', () => {
  it('opens the status picker from the row without opening the customer', async () => {
    const { user } = mount();

    await user.click(within(row('Acme')).getByRole('button', { name: 'Active' }));

    expect(await screen.findByRole('menu', { name: 'Customer status' })).toBeTruthy();
    expect(screen.queryByText('opened')).toBeNull();
    expect(screen.getByRole('link', { name: /Acme/ })).toBeTruthy();
  });

  it('writes the chosen status to the customer the cell belongs to', async () => {
    const { mutate, user } = mount();

    await user.click(within(row('Acme')).getByRole('button', { name: 'Active' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Churned' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = firstWrite(mutate);
    expect(written.variables.input.id).toBe('c-acme');
    expect(written.variables.input.status).toBe('CHURNED');
    expect(written.optimistic[0]?.type).toBe('customer');
    expect(written.optimistic[0]?.id).toBe('c-acme');
  });

  it('writes the row the cell was pressed on and nothing else', async () => {
    const { mutate, user } = mount();

    await user.click(within(row('Bluebird')).getByRole('button', { name: 'Prospect' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Active' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(firstWrite(mutate).variables.input.id).toBe('c-blue');
  });

  it('does not write when the status chosen is the one already held', async () => {
    const { mutate, user } = mount();

    await user.click(within(row('Acme')).getByRole('button', { name: 'Active' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Active' }));

    expect(mutate).not.toHaveBeenCalled();
  });

  it('sets the owner from the row, without opening the customer', async () => {
    const { mutate, user } = mount();

    await user.click(within(row('Bluebird')).getByRole('button', { name: 'No owner' }));
    expect(await screen.findByRole('menu', { name: 'Owner' })).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: 'Grace Hopper' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = firstWrite(mutate);
    expect(written.variables.input.id).toBe('c-blue');
    expect(written.variables.input.ownerId).toBe('u2');
    expect(screen.queryByText('opened')).toBeNull();
  });

  it('sets the tier from the row', async () => {
    const { mutate, user } = mount();

    await user.click(within(row('Acme')).getByRole('button', { name: 'Enterprise' }));
    expect(await screen.findByRole('menu', { name: 'Customer tier' })).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: 'Starter' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = firstWrite(mutate);
    expect(written.variables.input.id).toBe('c-acme');
    expect(written.variables.input.tier).toBe('Starter');
  });

  it('clears the tier through the row that says there is none', async () => {
    const { mutate, user } = mount();

    await user.click(within(row('Acme')).getByRole('button', { name: 'Enterprise' }));
    await user.click(await screen.findByRole('menuitem', { name: 'No tier' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(firstWrite(mutate).variables.input.clearTier).toBe(true);
  });

  it('leaves the tier as a plain cell where the workspace has named no tiers', async () => {
    mount(seeded([]));

    // Still shown — a blank cell reads as missing data — but not a control, because there
    // is nothing behind it to choose from.
    const cell = within(row('Bluebird')).getByText('No tier');
    expect(cell.textContent).toBe('No tier');
    expect(within(row('Bluebird')).queryByRole('button', { name: 'No tier' })).toBeNull();
    // The other two columns are unaffected by the tier list being empty.
    expect(within(row('Bluebird')).getByRole('button', { name: 'Prospect' })).toBeTruthy();
  });

  it('offers one list of statuses: the cell picker and the filter above the rows agree', async () => {
    const { user } = mount();

    await user.click(within(row('Acme')).getByRole('button', { name: 'Active' }));
    const offered = within(await screen.findByRole('menu', { name: 'Customer status' }))
      .getAllByRole('menuitem')
      .map((item) => item.textContent ?? '');

    expect(offered).toEqual(['Active', 'Prospect', 'Churned']);
    const filter = within(screen.getByRole('group', { name: 'Which customers' }))
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');
    expect(filter).toEqual(['All', ...offered]);
  });

  it('reaches the tier and the owner from the row menu, which is the keyboard route', async () => {
    const { mutate, user } = mount();

    await user.click(screen.getByRole('button', { name: 'Options for Acme' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Tier…' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Starter' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(firstWrite(mutate).variables.input).toMatchObject({ id: 'c-acme', tier: 'Starter' });
  });

  it('sets the owner from the right-click menu, which has a pointer and no control', async () => {
    const { mutate, user } = mount();

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('option', { name: /Bluebird/ }),
    });
    await user.click(await screen.findByRole('menuitem', { name: 'Owner…' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Grace Hopper' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(firstWrite(mutate).variables.input).toMatchObject({ id: 'c-blue', ownerId: 'u2' });
  });

  it('offers no tier row in the menu where the workspace has named no tiers', async () => {
    const { user } = mount(seeded([]));

    await user.click(screen.getByRole('button', { name: 'Options for Acme' }));
    const menu = await screen.findByRole('menu', { name: 'Options for Acme' });

    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent ?? ''),
    ).toEqual(['Open customer', 'Copy link', 'Status', 'Owner…', 'Archive customer']);
  });

  it('keeps the row menu on the same list, one submenu away', async () => {
    const { mutate, user } = mount();

    await user.click(screen.getByRole('button', { name: 'Options for Acme' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Status' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Prospect' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = firstWrite(mutate);
    expect(written.variables.input.id).toBe('c-acme');
    expect(written.variables.input.status).toBe('PROSPECT');
  });
});
