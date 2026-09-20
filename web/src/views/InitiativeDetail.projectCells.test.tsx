/**
 * The contributing-projects list on an initiative: three cells that were facts and are now
 * controls.
 *
 * They write to the *project*, not to the initiative around them — a lead is the project's
 * lead wherever it is drawn, and this screen only adds a second place to reach it. That is
 * the claim worth pinning, because the obvious mistake is to write the id of the initiative
 * whose page the row happens to be on.
 *
 * Health is the exception that shows the rule: there is no health field to write, so the
 * cell opens the project's own update composer and what lands is an update.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { InitiativeDetail } from './InitiativeDetail';

const W = 'w1';
const VIEWER = 'u1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, workspaceId: W, role: 'admin', displayName: 'Ada' }),
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

function renderOverview() {
  const store = new Store(W);
  store.applyChanges([
    upsert(1, 'user', {
      id: 'u2',
      workspaceId: W,
      email: 'grace@example.com',
      name: 'Grace',
      displayName: 'Grace Hopper',
      role: 'member',
      status: 'active',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(2, 'projectStatus', {
      id: 'ps1',
      workspaceId: W,
      name: 'In progress',
      color: '#5e6ad2',
      category: 'started',
      position: 'a',
      isDefault: false,
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(3, 'project', {
      id: 'p1',
      workspaceId: W,
      name: 'Alpha',
      description: '',
      color: '#5e6ad2',
      statusId: 'ps1',
      priority: 0,
      sortOrder: 'a',
      updateSchedule: 'default',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(4, 'initiative', {
      id: 'parent',
      workspaceId: W,
      name: 'Company goals',
      description: '',
      status: 'planned',
      priority: 0,
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
    upsert(5, 'initiativeProject', {
      id: 'ip1',
      workspaceId: W,
      initiativeId: 'parent',
      projectId: 'p1',
      sortOrder: 'a',
      createdAt: AT,
    } as Entity),
  ]);

  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={['/initiative/parent']}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/initiative/:initiativeId" element={<InitiativeDetail />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

/** The row the contributing project is drawn on. */
function projectRow(): HTMLElement {
  const row = screen.getByRole('link', { name: 'Alpha' }).closest('li');
  if (row === null) throw new Error('the project row is not in the document');
  return row;
}

/** The `input` of the last mutation the engine was handed. */
function lastInput(mutate: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const calls = mutate.mock.calls;
  const call = calls[calls.length - 1]![0] as { variables: { input: Record<string, unknown> } };
  return call.variables.input;
}

afterEach(cleanup);

describe('a contributing project’s lead', () => {
  it('opens the person picker from the row and writes it to the project', async () => {
    const { mutate, user } = renderOverview();

    await user.click(within(projectRow()).getByRole('button', { name: 'Unassigned' }));
    expect(await screen.findByRole('menu', { name: 'Lead' })).toBeTruthy();

    await user.click(screen.getByRole('menuitem', { name: /Grace/ }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const input = lastInput(mutate);
    // The project, not the initiative whose page the row is on.
    expect(input.id).toBe('p1');
    expect(input.leadId).toBe('u2');
  });
});

describe('a contributing project’s target date', () => {
  it('opens the date panel from the row and writes the day to the project', async () => {
    const { mutate, user } = renderOverview();

    await user.click(within(projectRow()).getByRole('button', { name: 'No target date' }));
    const panel = await screen.findByRole('dialog', { name: 'Target date' });
    await user.click(within(panel).getByRole('button', { name: 'Today' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const input = lastInput(mutate);
    expect(input.id).toBe('p1');
    expect(typeof input.targetDate).toBe('string');
  });
});

describe('a contributing project’s health', () => {
  it('opens the project’s update composer rather than a menu of healths', async () => {
    const { user } = renderOverview();

    await user.click(within(projectRow()).getByRole('button', { name: 'No health' }));

    expect(await screen.findByRole('dialog', { name: 'Project update' })).toBeTruthy();
  });

  it('files the update against the project the row belongs to', async () => {
    const { mutate, user } = renderOverview();

    await user.click(within(projectRow()).getByRole('button', { name: 'No health' }));
    const panel = await screen.findByRole('dialog', { name: 'Project update' });
    await user.type(within(panel).getByRole('textbox', { name: 'Update' }), 'Slipping a week.');
    await user.click(within(panel).getByRole('button', { name: 'Post update' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const input = lastInput(mutate);
    expect(input.projectId).toBe('p1');
    expect(input.body).toBe('Slipping a week.');
  });
});
