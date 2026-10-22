/**
 * Archiving an initiative from its own shell, and the way back.
 *
 * Same shape as `CustomerDetail.undo.test.tsx`, and for the same reason: `confirmArchive`
 * leaves for the Initiatives list, so the offer has to be read from the undo module rather
 * than from a toast inside a tree that has already been replaced.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { snapshot } from '~/features/undo/offers';
import { clearUndoOffers } from '~/features/undo/UndoToast';
import { latest } from '~/features/undo/undo';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { InitiativeDetail } from './InitiativeDetail';
import { InitiativeShell } from './InitiativeShell';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const INITIATIVE = 'i1';
const NAME = 'Platform reliability';
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

/**
 * A `localStorage` of this file's own, for the reason `InitiativeShell.header.test.tsx`
 * gives: under Node 25 the runner shares one backing file across workers, so the rail state
 * this file writes would otherwise be read by another file's assertions.
 */
function privateStorage(): void {
  const held = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return held.size;
      },
      key: (index: number) => [...held.keys()][index] ?? null,
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => void held.set(key, String(value)),
      removeItem: (key: string) => void held.delete(key),
      clear: () => held.clear(),
    } satisfies Storage,
  });
}

function mount() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'initiative', {
      id: INITIATIVE,
      workspaceId: WORKSPACE,
      name: NAME,
      description: '',
      status: 'planned',
      priority: 0,
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    }),
  ]);
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter initialEntries={[`/initiative/${INITIATIVE}`]}>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <Routes>
            <Route path="/initiative/:initiativeId" element={<InitiativeShell />}>
              <Route index element={<InitiativeDetail />} />
            </Route>
            <Route path="/initiatives" element={<h1>Initiatives list</h1>} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

async function archive(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  await user.click(screen.getByRole('menuitem', { name: 'Archive initiative' }));
  await user.click(screen.getByRole('button', { name: 'Archive' }));
  expect(await screen.findByRole('heading', { name: 'Initiatives list' })).toBeTruthy();
}

beforeEach(privateStorage);
afterEach(() => clearUndoOffers());

describe('archiving an initiative', () => {
  it('offers an undo that names the initiative', async () => {
    const { user } = mount();
    await archive(user);

    expect(latest(snapshot())?.label).toBe(`Archived ${NAME}`);
  });

  it('un-archives that initiative when the undo is run', async () => {
    const { mutate, user } = mount();
    await archive(user);

    mutate.mockClear();
    await latest(snapshot())!.undo();

    const call = mutate.mock.calls[0]![0] as { variables: { id: string; archived: boolean } };
    expect(call.variables).toMatchObject({ id: INITIATIVE, archived: false });
  });
});
