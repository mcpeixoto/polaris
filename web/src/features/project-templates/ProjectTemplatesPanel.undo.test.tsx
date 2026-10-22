/**
 * Archiving a project template offers the way back.
 *
 * Read out of the undo stack rather than off the screen: the toast is mounted once in the
 * shell and this panel does not render it.
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

import { ProjectTemplatesPanel } from './ProjectTemplatesPanel';

const WORKSPACE = 'w1';
const AT = '2026-01-01T00:00:00.000Z';

function renderPanel() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    {
      v: 1,
      type: 'projectTemplate',
      id: 'pt-launch',
      op: 'upsert',
      actor: { type: 'system' },
      payload: {
        id: 'pt-launch',
        workspaceId: WORKSPACE,
        name: 'Launch plan',
        description: '',
        summary: '',
        body: '',
        properties: {},
        position: 'a',
        createdAt: AT,
        updatedAt: AT,
      } as unknown as Entity,
    },
  ] as Change[]);

  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <ProjectTemplatesPanel />
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

describe('archiving a project template', () => {
  it('offers an undo naming the template, which sends the inverse', async () => {
    const { mutate, user } = renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    await user.click(await screen.findByRole('button', { name: 'Archive it' }));

    await waitFor(() => {
      expect(latest(snapshot())?.label).toBe('Archived Launch plan');
    });

    await latest(snapshot())!.undo();
    expect(mutate.mock.calls.at(-1)![0]).toMatchObject({
      variables: { id: 'pt-launch', archived: false },
    });
  });
});
