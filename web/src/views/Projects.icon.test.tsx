/**
 * The icon in a project row is the way to change it, and it is not the way to open the row.
 *
 * A button inside a link is a trade the list makes on purpose — see `ProjectIconButton` in
 * `Projects.tsx` — and the two claims worth pinning are the two halves of that trade: the
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
    upsert(3, 'project', project('p2', 'Migrate', { icon: '🚀', color: '#16a34a' })),
  ]);
  return store;
}

/** What `updateProject` puts on the wire, as far as this file reads it. */
interface Written {
  variables: { input: { id: string; icon?: string; color?: string } };
  optimistic: readonly { type: string; id: string; after: { icon?: string; color: string } }[];
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

/** The picker opens on whichever tab holds the current value; the tests want the emoji one. */
async function showEmojis(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  const tab = within(dialog).queryByRole('tab', { name: 'Emojis' });
  if (tab !== null && tab.getAttribute('aria-selected') !== 'true') await user.click(tab);
}

afterEach(cleanup);

describe('Projects row icon', () => {
  it('opens the icon picker from the row without opening the project', async () => {
    const { user } = mount();

    await user.click(screen.getByRole('button', { name: 'Change icon for Launch' }));

    expect(await screen.findByRole('dialog', { name: 'Project icon' })).toBeTruthy();
    expect(screen.queryByText('opened')).toBeNull();
    // The row is still a link, and still here: the click did not become a selection either.
    expect(screen.getByRole('link', { name: /Launch/ })).toBeTruthy();
  });

  it('writes the chosen emoji to the project the button belongs to', async () => {
    const { mutate, user } = mount();

    await user.click(screen.getByRole('button', { name: 'Change icon for Launch' }));
    const dialog = await screen.findByRole('dialog', { name: 'Project icon' });
    await showEmojis(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: '🎯' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = mutate.mock.calls[0]?.[0] as Written;
    expect(written.variables.input.id).toBe('p1');
    expect(written.variables.input.icon).toBe('🎯');
    // The colour did not move, so it is not on the wire.
    expect(written.variables.input.color).toBeUndefined();
    expect(written.optimistic[0]?.type).toBe('project');
    expect(written.optimistic[0]?.id).toBe('p1');
    expect(written.optimistic[0]?.after.icon).toBe('🎯');
  });

  it('writes the chosen colour, and only the colour, to that project', async () => {
    const { mutate, user } = mount();

    await user.click(screen.getByRole('button', { name: 'Change icon for Migrate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Project icon' });
    // Through the full palette, whose swatches are named by their hex.
    await user.click(within(dialog).getByRole('button', { name: 'Project icon colour' }));
    await user.click(screen.getByRole('button', { name: '#3b82f6' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = mutate.mock.calls[0]?.[0] as Written;
    expect(written.variables.input.id).toBe('p2');
    expect(written.variables.input.color).toBe('#3b82f6');
    expect(written.variables.input.icon).toBeUndefined();
    expect(written.optimistic[0]?.after.color).toBe('#3b82f6');
    expect(written.optimistic[0]?.after.icon).toBe('🚀');
  });

  it('opens the picker from a board card too', async () => {
    const { user } = mount({ url: '/projects?layout=board' });

    await user.click(screen.getByRole('button', { name: 'Change icon for Launch' }));

    expect(await screen.findByRole('dialog', { name: 'Project icon' })).toBeTruthy();
    expect(screen.queryByText('opened')).toBeNull();
  });
});
