/**
 * Initiative overview: properties, archive, and posting a status update.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { InitiativeActivity } from './InitiativeActivity';
import { InitiativeDetail } from './InitiativeDetail';
import { InitiativeShell } from './InitiativeShell';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const TEAM = 't1';
const INITIATIVE = 'i1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({
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
    upsert(4, 'initiative', {
      id: 'i2',
      workspaceId: WORKSPACE,
      name: 'Mobile launch',
      description: '',
      status: 'planned',
      priority: 0,
      sortOrder: 'b',
      createdAt: AT,
      updatedAt: AT,
    }),
    upsert(5, 'initiativeLabel', {
      id: 'il1',
      workspaceId: WORKSPACE,
      name: 'Platform',
      color: '#5e6ad2',
      isGroup: false,
      position: 'a0',
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  return store;
}

function renderDetail() {
  const store = seeded();
  const mutate = vi
    .fn()
    .mockImplementation(async (request: { variables: Record<string, unknown> }) => {
      const input = request.variables.input as { health?: string; body?: string } | undefined;
      if (input?.health !== undefined) {
        return {
          createInitiativeUpdate: {
            initiativeUpdate: {
              id: 'iu1',
              workspaceId: WORKSPACE,
              initiativeId: INITIATIVE,
              health: input.health,
              body: input.body ?? '',
              authorId: VIEWER,
              createdAt: AT,
              updatedAt: AT,
            },
          },
        };
      }
      const parentInitiativeId = request.variables.parentInitiativeId as string | undefined;
      const childInitiativeId = request.variables.childInitiativeId as string | undefined;
      if (parentInitiativeId !== undefined && childInitiativeId !== undefined) {
        return {
          addInitiativeRelation: {
            initiativeRelation: {
              id: 'ir1',
              workspaceId: WORKSPACE,
              parentInitiativeId,
              childInitiativeId,
              sortOrder: 'z',
              createdAt: AT,
            },
          },
        };
      }
      return {};
    });
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/initiative/${INITIATIVE}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/initiative/:initiativeId" element={<InitiativeShell />}>
              <Route index element={<InitiativeDetail />} />
              <Route path="activity" element={<InitiativeActivity />} />
            </Route>
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

  it('posts an update from Overview', async () => {
    const { mutate, user } = renderDetail();
    await user.selectOptions(screen.getByLabelText('Health'), 'at_risk');
    await user.type(screen.getByPlaceholderText('What changed since the last update?'), 'Slip');
    await user.click(screen.getByRole('button', { name: 'Post update' }));
    expect(mutate).toHaveBeenCalled();
    const input = mutate.mock.calls[0]![0] as {
      variables: { input: { health?: string; body?: string } };
    };
    expect(input.variables.input.health).toBe('AT_RISK');
    expect(input.variables.input.body).toBe('Slip');
  });

  it('opens the initiative label picker with l', async () => {
    const { user } = renderDetail();
    await user.keyboard('l');
    expect(screen.getByRole('menu', { name: 'Initiative labels' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Platform' })).toBeTruthy();
  });

  it('nests an existing initiative from Overview', async () => {
    const { mutate, user } = renderDetail();
    await user.selectOptions(screen.getByLabelText('Initiative to nest'), 'i2');
    await user.click(screen.getByRole('button', { name: 'Nest' }));
    expect(mutate).toHaveBeenCalled();
    const call = mutate.mock.calls[0]![0] as {
      variables: { parentInitiativeId?: string; childInitiativeId?: string };
    };
    expect(call.variables.parentInitiativeId).toBe(INITIATIVE);
    expect(call.variables.childInitiativeId).toBe('i2');
  });
});
