/**
 * The priority glyph in a project row is the way to change it, and it is not the way to
 * open the row.
 *
 * Same trade the icon already makes — a button inside a link, click stopped before the
 * anchor sees it — and the two claims worth pinning are the two halves of that trade: the
 * click reaches the picker and never the link, and a choice in the picker writes to the
 * project the button belongs to.
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

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'projectStatus', status('ps-started', 'In progress', 'started', 'a')),
    upsert(2, 'project', project('p1', 'Launch')),
    upsert(3, 'project', project('p2', 'Migrate', { priority: 2 })),
  ]);
  return store;
}

/** What `updateProject` puts on the wire, as far as this file reads it. */
interface Written {
  variables: { input: { id: string; priority?: number } };
  optimistic: readonly { type: string; id: string; after: { priority?: number } }[];
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
  return { mutate, user: userEvent.setup() };
}

function row(name: string): HTMLElement {
  return screen.getByRole('link', { name: new RegExp(name) });
}

afterEach(cleanup);

describe('Projects row priority', () => {
  it('opens the priority picker from the row without opening the project', async () => {
    const { user } = mount();

    await user.click(within(row('Launch')).getByRole('button', { name: 'No priority' }));

    expect(await screen.findByRole('menu', { name: 'Priority' })).toBeTruthy();
    expect(screen.queryByText('opened')).toBeNull();
    expect(screen.getByRole('link', { name: /Launch/ })).toBeTruthy();
  });

  it('writes the chosen level to the project the button belongs to', async () => {
    const { mutate, user } = mount();

    await user.click(within(row('Launch')).getByRole('button', { name: 'No priority' }));
    await user.click(screen.getByRole('menuitem', { name: 'High' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = mutate.mock.calls[0]?.[0] as Written;
    expect(written.variables.input.id).toBe('p1');
    expect(written.variables.input.priority).toBe(2);
    expect(written.optimistic[0]?.type).toBe('project');
    expect(written.optimistic[0]?.id).toBe('p1');
    expect(written.optimistic[0]?.after.priority).toBe(2);
  });

  it('writes the row it was pressed on and nothing else', async () => {
    const { mutate, user } = mount();

    await user.click(within(row('Migrate')).getByRole('button', { name: 'High' }));
    await user.click(screen.getByRole('menuitem', { name: 'Urgent' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = mutate.mock.calls[0]?.[0] as Written;
    expect(written.variables.input.id).toBe('p2');
    expect(written.variables.input.priority).toBe(1);
  });

  it('opens the picker from a board card too', async () => {
    const { user } = mount({ url: '/projects?layout=board' });

    await user.click(within(row('Launch')).getByRole('button', { name: 'No priority' }));

    expect(await screen.findByRole('menu', { name: 'Priority' })).toBeTruthy();
    expect(screen.queryByText('opened')).toBeNull();
  });

  it('opens the same picker from the row menu, and writes from there', async () => {
    const { mutate, user } = mount({ url: '/projects?group=none&order=name' });

    await user.keyboard('.');
    expect(await screen.findByRole('menu', { name: 'Options for Launch' })).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: /^Priority…/ }));

    expect(await screen.findByRole('menu', { name: 'Priority' })).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: 'Low' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = mutate.mock.calls[0]?.[0] as Written;
    expect(written.variables.input.id).toBe('p1');
    expect(written.variables.input.priority).toBe(4);
  });
});
