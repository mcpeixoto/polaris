/**
 * The status on a timeline sidebar row is the way to change it, and it is not the way to
 * open the project.
 *
 * Same trade the project list's row glyphs make — a button inside a link, the click stopped
 * before the anchor sees it — and the two claims worth pinning are the two halves of it: the
 * press reaches the picker and never the link, and a status chosen there writes the project
 * whose row the button belongs to. Both kinds of row are covered, because a project with no
 * dates is drawn by a different branch under "Unscheduled" and has had its own share of
 * fixes that reached one list and not the other.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { DEFAULT_PROJECT_DISPLAY } from './display';
import { ProjectTimeline } from './ProjectTimeline';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';
const DAY_MS = 86_400_000;

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

function day(offset: number): string {
  return new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
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
  } as unknown as Entity;
}

/**
 * Two projects on two different statuses: one dated, so it draws a bar, and one without
 * dates, so it lands under Unscheduled. Different statuses because the status name is the
 * trigger's accessible name, and two rows sharing one would make every query here ambiguous.
 */
function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'projectStatus', status('ps-started', 'In progress', 'started', 'a')),
    upsert(2, 'projectStatus', status('ps-planned', 'Planned', 'planned', 'b')),
    upsert(3, 'projectStatus', status('ps-done', 'Shipped', 'completed', 'c')),
    upsert(4, 'project', {
      id: 'p1',
      workspaceId: WORKSPACE,
      name: 'Polaris',
      description: '',
      color: '#5e6ad2',
      statusId: 'ps-started',
      priority: 0,
      sortOrder: 'a',
      updateSchedule: 'never',
      startDate: day(-5),
      targetDate: day(20),
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity),
    upsert(5, 'project', {
      id: 'p2',
      workspaceId: WORKSPACE,
      name: 'Atlas',
      description: '',
      color: '#5e6ad2',
      statusId: 'ps-planned',
      priority: 0,
      sortOrder: 'b',
      updateSchedule: 'never',
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity),
  ]);
  return store;
}

/** What `updateProject` puts on the wire, as far as this file reads it. */
interface Written {
  variables: { input: { id: string; statusId?: string } };
  optimistic: readonly { type: string; id: string; after: { statusId?: string } }[];
}

function mount() {
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store: seeded(), mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/timeline']}>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <Routes>
          <Route
            path="/timeline"
            element={
              <ProjectTimeline
                teamId={undefined}
                depFilter="all"
                display={DEFAULT_PROJECT_DISPLAY}
              />
            }
          />
          <Route path="/project/:projectId" element={<p>opened</p>} />
        </Routes>
      </EngineProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

afterEach(cleanup);

describe('ProjectTimeline sidebar status', () => {
  it('opens the picker from a bar row without opening the project', async () => {
    const { user } = mount();

    await user.click(screen.getByRole('button', { name: 'In progress' }));

    expect(await screen.findByRole('menu', { name: 'Project status' })).toBeTruthy();
    expect(screen.queryByText('opened')).toBeNull();
  });

  it('writes the chosen status to the project the button belongs to', async () => {
    const { mutate, user } = mount();

    await user.click(screen.getByRole('button', { name: 'In progress' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Shipped' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = mutate.mock.calls[0]?.[0] as Written;
    expect(written.variables.input.id).toBe('p1');
    expect(written.variables.input.statusId).toBe('ps-done');
    expect(written.optimistic[0]?.type).toBe('project');
    expect(written.optimistic[0]?.id).toBe('p1');
    expect(written.optimistic[0]?.after.statusId).toBe('ps-done');
  });

  it('does the same from an unscheduled row, and writes that project', async () => {
    const { mutate, user } = mount();

    await user.click(screen.getByRole('button', { name: 'Planned' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Shipped' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const written = mutate.mock.calls[0]?.[0] as Written;
    expect(written.variables.input.id).toBe('p2');
    expect(written.variables.input.statusId).toBe('ps-done');
    expect(screen.queryByText('opened')).toBeNull();
  });

  it('still draws the status name beside the control', () => {
    mount();

    // The word is `aria-hidden` — the button beside it is already named by it — so this is a
    // claim about what is on screen, which `getByRole` deliberately cannot make. It is worth
    // making: a coloured dot where the word used to be would be a fact removed from a column
    // whose only status is that word.
    const row = screen.getByRole('button', { name: 'In progress' }).closest('a');
    expect(row?.textContent).toContain('Polaris');
    expect(row?.textContent).toContain('In progress');
  });
});
