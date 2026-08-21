/**
 * Initiative overview leftovers: properties and archive were on the API and missing here.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { InitiativeDetail } from './InitiativeDetail';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const TEAM = 't1';
const INITIATIVE = 'i1';
const AT = '2026-01-01T00:00:00.000Z';

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

function seeded(): Store {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'user', {
      id: VIEWER,
      workspaceId: WORKSPACE,
      name: 'ada',
      displayName: 'Ada Lovelace',
      timezone: 'UTC',
      role: 'admin',
      status: 'active',
      kind: 'human',
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(2, 'team', {
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
    }),
    upsert(3, 'initiative', {
      id: INITIATIVE,
      workspaceId: WORKSPACE,
      name: 'Platform reliability',
      description: '',
      status: 'planned',
      priority: 0,
      ownerId: VIEWER,
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  return store;
}

function renderDetail() {
  const store = seeded();
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/initiative/${INITIATIVE}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/initiative/:initiativeId" element={<InitiativeDetail />} />
            <Route path="/initiatives" element={<h1>Initiatives</h1>} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

describe('Initiative overview leftovers', () => {
  it('has a heading', () => {
    renderDetail();
    expect(screen.getByRole('heading', { name: 'Platform reliability' })).toBeTruthy();
  });

  it('writes status through updateInitiative', async () => {
    const { mutate, user } = renderDetail();
    await user.selectOptions(screen.getByLabelText('Status'), 'active');
    expect(mutate).toHaveBeenCalled();
    const input = mutate.mock.calls[0]![0] as { variables: { input: { status?: string } } };
    expect(input.variables.input.status).toBe('ACTIVE');
  });

  it('archives and leaves the list', async () => {
    const { mutate, user } = renderDetail();
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByRole('heading', { name: 'Archive Platform reliability?' })).toBeTruthy();
    const confirms = screen.getAllByRole('button', { name: 'Archive' });
    await user.click(confirms[confirms.length - 1]!);
    expect(mutate).toHaveBeenCalled();
    const call = mutate.mock.calls[0]![0] as { variables: { archived?: boolean } };
    expect(call.variables.archived).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Initiatives' })).toBeTruthy();
  });
});
