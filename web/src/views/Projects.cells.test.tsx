/**
 * The rest of a project row is editable where it is drawn, on the same terms priority is.
 *
 * Four properties, three of which are ordinary fields and one of which is not: health is
 * the newest update's word, so its cell opens the composer rather than a picker. The claims
 * pinned here are the two halves of the trade the row makes — the click reaches the control
 * and never the link, and what is chosen is written to the project the cell belongs to —
 * plus the one thing the read-only cells could not do at all: a project with no target date
 * still offers somewhere to click.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { Projects } from './Projects';

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

function status(id: string, name: string, category: string, position: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    color: '#5e6ad2',
    category,
    position,
    isDefault: false,
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function project(id: string, name: string, extra: Record<string, unknown> = {}): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    name,
    description: '',
    color: '#5e6ad2',
    statusId: 'ps-started',
    priority: 0,
    sortOrder: id,
    updateSchedule: 'never',
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  } as Entity;
}

function user(id: string, displayName: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    displayName,
    email: `${id}@example.com`,
    role: 'member',
    status: 'active',
    createdAt: AT,
    updatedAt: AT,
  } as Entity;
}

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'projectStatus', status('ps-started', 'In progress', 'started', 'a')),
    upsert(2, 'projectStatus', status('ps-done', 'Completed', 'completed', 'b')),
    upsert(3, 'user', user(VIEWER, 'Ada Lovelace')),
    upsert(4, 'user', user('u2', 'Grace Hopper')),
    upsert(5, 'project', project('p1', 'Launch')),
    upsert(6, 'project', project('p2', 'Migrate', { leadId: 'u2', targetDate: '2026-03-01' })),
  ]);
  return store;
}

/** What `updateProject` puts on the wire, as far as this file reads it. */
interface Written {
  variables: {
    input: {
      id: string;
      leadId?: string | null;
      statusId?: string;
      targetDate?: string | null;
      projectId?: string;
      health?: string;
      body?: string;
    };
  };
}

function mount(options: { store?: Store; phase?: EngineStatus; url?: string } = {}) {
  const mutate = vi.fn().mockResolvedValue(undefined);
  const engine = { store: options.store ?? seeded(), mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[options.url ?? '/projects']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={options.phase ?? { phase: 'idle' }}>
          <Routes>
            <Route path="/projects" element={<Projects />} />
            <Route path="/project/:projectId" element={<p>opened</p>} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, ui: userEvent.setup() };
}

function row(name: string): HTMLElement {
  return screen.getByRole('link', { name: new RegExp(name) });
}

afterEach(cleanup);

describe('Projects row lead', () => {
  it('opens the lead picker from the row without opening the project', async () => {
    const { ui } = mount();

    await ui.click(within(row('Launch')).getByRole('button', { name: 'No lead' }));

    expect(await screen.findByRole('menu', { name: 'Lead' })).toBeTruthy();
    expect(screen.queryByText('opened')).toBeNull();
  });

  it('writes the chosen lead to the project the button belongs to', async () => {
    const { mutate, ui } = mount();

    await ui.click(within(row('Launch')).getByRole('button', { name: 'No lead' }));
    await ui.click(await screen.findByRole('menuitem', { name: /Grace Hopper/ }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = mutate.mock.calls[0]?.[0] as Written;
    expect(written.variables.input.id).toBe('p1');
    expect(written.variables.input.leadId).toBe('u2');
  });
});

describe('Projects row target date', () => {
  it('offers a control on a project that has no target date', async () => {
    const { ui } = mount();

    await ui.click(within(row('Launch')).getByRole('button', { name: 'No target date' }));

    expect(await screen.findByRole('dialog', { name: 'Target date' })).toBeTruthy();
    expect(screen.queryByText('opened')).toBeNull();
  });

  it('writes the chosen day to the project the cell belongs to', async () => {
    const { mutate, ui } = mount();

    await ui.click(within(row('Launch')).getByRole('button', { name: 'No target date' }));
    const panel = await screen.findByRole('dialog', { name: 'Target date' });
    await ui.type(within(panel).getByLabelText('Or a date'), '2026-05-01');
    await ui.click(within(panel).getByRole('button', { name: 'Set' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = mutate.mock.calls[0]?.[0] as Written;
    expect(written.variables.input.id).toBe('p1');
    expect(written.variables.input.targetDate).toBe('2026-05-01');
  });
});

describe('Projects row status', () => {
  it('opens the status picker from the progress ring and writes the choice', async () => {
    const { mutate, ui } = mount();

    await ui.click(within(row('Launch')).getByRole('button', { name: 'Change status for Launch' }));
    await ui.click(await screen.findByRole('menuitem', { name: /Completed/ }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = mutate.mock.calls[0]?.[0] as Written;
    expect(written.variables.input.id).toBe('p1');
    expect(written.variables.input.statusId).toBe('ps-done');
  });
});

describe('Projects row health', () => {
  it('opens the update composer rather than a picker, because health is not a field', async () => {
    const { ui } = mount();

    await ui.click(within(row('Launch')).getByRole('button', { name: 'No update posted' }));

    expect(await screen.findByRole('dialog', { name: 'Project update' })).toBeTruthy();
    expect(screen.queryByText('opened')).toBeNull();
  });

  it('posts the update against the project whose row was clicked', async () => {
    const { mutate, ui } = mount();

    await ui.click(within(row('Migrate')).getByRole('button', { name: 'No update posted' }));
    const panel = await screen.findByRole('dialog', { name: 'Project update' });
    await ui.type(within(panel).getByRole('textbox', { name: 'Update' }), 'Slipping a week.');
    await ui.click(within(panel).getByRole('button', { name: 'Post update' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = mutate.mock.calls[0]?.[0] as Written;
    expect(written.variables.input.projectId).toBe('p2');
    expect(written.variables.input.body).toBe('Slipping a week.');
  });
});
