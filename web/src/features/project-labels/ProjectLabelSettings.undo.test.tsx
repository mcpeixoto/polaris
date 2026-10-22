/**
 * Archiving a project label offers the way back.
 *
 * Read out of the undo stack rather than off the screen: the toast is mounted once in the
 * shell and this panel does not render it.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { snapshot } from '~/features/undo/offers';
import { latest } from '~/features/undo/undo';
import { clearUndoOffers } from '~/features/undo/UndoToast';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectLabelSettings } from './ProjectLabelSettings';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';

function renderPanel() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    {
      v: 1,
      type: 'projectLabel',
      id: 'pl-platform',
      op: 'upsert',
      actor: { type: 'system' },
      payload: {
        id: 'pl-platform',
        workspaceId: WORKSPACE,
        name: 'Platform',
        color: '#3b82f6',
        isGroup: false,
        position: 'a',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    },
  ] as Change[]);

  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <EngineProvider engine={engine} status={{ phase: 'idle' }}>
      <ProjectLabelSettings />
    </EngineProvider>,
  );
  return { mutate, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearUndoOffers();
});

describe('archiving a project label', () => {
  it('offers an undo naming the label, which sends the inverse', async () => {
    const { mutate, user } = renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Archive' }));

    await waitFor(() => {
      expect(latest(snapshot())?.label).toBe('Archived Platform');
    });

    await latest(snapshot())!.undo();
    expect(mutate.mock.calls.at(-1)![0]).toMatchObject({
      variables: { id: 'pl-platform', archived: false },
    });
  });
});
