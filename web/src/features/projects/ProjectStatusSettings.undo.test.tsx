/**
 * Retiring a project status offers the way back.
 *
 * Read out of the undo stack rather than off the screen: the toast is mounted once in the
 * shell and this screen does not render it.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { snapshot } from '~/features/undo/offers';
import { latest } from '~/features/undo/undo';
import { clearUndoOffers } from '~/features/undo/UndoToast';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectStatusSettings } from './ProjectStatusSettings';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';

function upsert(v: number, type: Change['type'], entity: Entity): Change {
  return { v, type, id: entity.id, op: 'upsert', actor: { type: 'system' }, payload: entity };
}

function renderPage() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'projectStatus', {
      id: 'ps-backlog',
      workspaceId: WORKSPACE,
      name: 'Backlog',
      color: '#6b7280',
      category: 'backlog',
      position: 'a',
      isDefault: true,
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity),
    upsert(2, 'projectStatus', {
      id: 'ps-started',
      workspaceId: WORKSPACE,
      name: 'In progress',
      color: '#5e6ad2',
      category: 'started',
      position: 'b',
      isDefault: false,
      createdAt: AT,
      updatedAt: AT,
    } as unknown as Entity),
  ]);

  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <ProjectStatusSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearUndoOffers();
});

describe('archiving a project status', () => {
  it('offers an undo naming the status, which sends the inverse', async () => {
    const { mutate, user } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Retire In progress' }));

    // Only after the write resolves: the server refuses the workspace default, and an offer
    // made before the answer would sit beside the refusal.
    await waitFor(() => {
      expect(latest(snapshot())?.label).toBe('Archived In progress');
    });

    await latest(snapshot())!.undo();
    expect(mutate.mock.calls.at(-1)![0]).toMatchObject({
      variables: { id: 'ps-started', archived: false },
    });
  });
});
