/**
 * The properties on an initiative row are the way to change them, and they are not the way
 * to open the row.
 *
 * Same bargain the icon already makes — a button inside a link, click stopped before the
 * anchor sees it — and the two claims worth pinning are the two halves of it: the click
 * reaches the picker and never the link, and a choice in the picker writes to the
 * initiative the button belongs to rather than to whichever row happened to be first.
 *
 * Health is the one that is not a property at all. It is the newest update's word, so the
 * cell opens the composer rather than a menu of three healths, and what is pinned there is
 * that the update lands against the right initiative.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { Initiatives } from './Initiatives';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, workspaceId: WORKSPACE, role: 'admin', displayName: 'Ada' }),
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

function initiative(id: string, name: string, extra: Record<string, unknown> = {}): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    description: '',
    status: 'planned',
    priority: 0,
    sortOrder: id,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  } as Entity;
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'user', {
      id: 'u2',
      workspaceId: WORKSPACE,
      email: 'grace@example.com',
      name: 'Grace',
      displayName: 'Grace Hopper',
      role: 'member',
      status: 'active',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(2, 'initiative', initiative('i1', 'Company goals')),
    upsert(3, 'initiative', initiative('i2', 'Mobile launch', { status: 'active' })),
    upsert(4, 'initiativeLabel', {
      id: 'il1',
      workspaceId: WORKSPACE,
      name: 'Platform',
      color: '#5e6ad2',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
  ]);
  return store;
}

function mount(url = '/initiatives') {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store: seeded(), mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[url]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/initiatives" element={<Initiatives />} />
            <Route path="/initiative/:initiativeId" element={<Opened />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

/** Where a navigation would land, so a test can say that none happened. */
function Opened() {
  const { initiativeId } = useParams<{ initiativeId: string }>();
  return <p>opened {initiativeId}</p>;
}

/** The link a row is, which is what a reader has to aim at as well. */
function row(name: string): HTMLElement {
  return screen.getByRole('link', { name: new RegExp(name) });
}

/** The `input` of the last mutation the engine was handed. */
function lastInput(mutate: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const calls = mutate.mock.calls;
  const call = calls[calls.length - 1]![0] as { variables: { input: Record<string, unknown> } };
  return call.variables.input;
}

afterEach(cleanup);

describe('an initiative row’s status', () => {
  it('opens the picker from the row without opening the initiative', async () => {
    const { user } = mount();

    await user.click(within(row('Company goals')).getByRole('button', { name: 'Planned' }));

    expect(await screen.findByRole('menu', { name: 'Status' })).toBeTruthy();
    expect(screen.queryByText('opened i1')).toBeNull();
    expect(screen.getByRole('link', { name: /Company goals/ })).toBeTruthy();
  });

  it('writes the chosen status to the initiative the button belongs to', async () => {
    const { mutate, user } = mount();

    await user.click(within(row('Mobile launch')).getByRole('button', { name: 'Active' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Completed' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const input = lastInput(mutate);
    expect(input.id).toBe('i2');
    expect(input.status).toBe('COMPLETED');
  });

  it('offers the same picker from the row menu, and writes from there', async () => {
    const { mutate, user } = mount();

    await user.pointer({ target: row('Company goals'), keys: '[MouseRight]' });
    await user.click(await screen.findByRole('menuitem', { name: /^Status…/ }));

    expect(await screen.findByRole('menu', { name: 'Status' })).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: 'Active' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const input = lastInput(mutate);
    expect(input.id).toBe('i1');
    expect(input.status).toBe('ACTIVE');
  });
});

describe('an initiative row’s owner', () => {
  it('opens the person picker rather than the initiative, and writes the choice', async () => {
    const { mutate, user } = mount();

    await user.click(within(row('Company goals')).getByRole('button', { name: 'Unassigned' }));

    expect(await screen.findByRole('menu', { name: 'Owner' })).toBeTruthy();
    expect(screen.queryByText('opened i1')).toBeNull();

    await user.click(screen.getByRole('menuitem', { name: /Grace/ }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const input = lastInput(mutate);
    expect(input.id).toBe('i1');
    expect(input.ownerId).toBe('u2');
  });

  it('reaches the same picker from the row menu', async () => {
    const { user } = mount();

    await user.pointer({ target: row('Mobile launch'), keys: '[MouseRight]' });
    await user.click(await screen.findByRole('menuitem', { name: /^Owner…/ }));

    expect(await screen.findByRole('menu', { name: 'Owner' })).toBeTruthy();
  });
});

describe('an initiative row’s target date', () => {
  it('opens the date panel from the cell and writes the day it was given', async () => {
    const { mutate, user } = mount();

    await user.click(within(row('Company goals')).getByRole('button', { name: 'No target date' }));

    const panel = await screen.findByRole('dialog', { name: 'Target date' });
    expect(screen.queryByText('opened i1')).toBeNull();

    await user.click(within(panel).getByRole('button', { name: 'Today' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const input = lastInput(mutate);
    expect(input.id).toBe('i1');
    expect(typeof input.targetDate).toBe('string');
  });
});

describe('an initiative row’s labels', () => {
  it('applies a label from the row without opening the initiative', async () => {
    const { mutate, user } = mount();

    await user.click(within(row('Company goals')).getByRole('button', { name: 'No labels' }));

    expect(await screen.findByRole('menu', { name: 'Initiative labels' })).toBeTruthy();
    expect(screen.queryByText('opened i1')).toBeNull();

    await user.click(screen.getByRole('menuitem', { name: 'Platform' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const call = mutate.mock.calls[0]![0] as {
      variables: Record<string, unknown>;
    };
    expect(call.variables.initiativeId).toBe('i1');
    expect(call.variables.labelId).toBe('il1');
  });
});

describe('an initiative row’s health', () => {
  it('opens the update composer rather than a menu of healths', async () => {
    const { user } = mount();

    await user.click(within(row('Company goals')).getByRole('button', { name: 'No health' }));

    expect(await screen.findByRole('dialog', { name: 'Initiative update' })).toBeTruthy();
    expect(screen.queryByText('opened i1')).toBeNull();
  });

  it('files the update against the initiative the cell belongs to', async () => {
    const { mutate, user } = mount();

    await user.click(within(row('Mobile launch')).getByRole('button', { name: 'No health' }));
    const panel = await screen.findByRole('dialog', { name: 'Initiative update' });
    await user.type(within(panel).getByRole('textbox', { name: 'Update' }), 'Kickoff went fine.');
    await user.click(within(panel).getByRole('button', { name: 'Post update' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const input = lastInput(mutate);
    expect(input.initiativeId).toBe('i2');
    expect(input.body).toBe('Kickoff went fine.');
  });
});
