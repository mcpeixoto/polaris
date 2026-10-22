/**
 * Archiving a label offers the way back.
 *
 * The offer is read out of the undo stack rather than off the screen, because the toast is
 * mounted once in the shell and this screen does not render it. What matters here is that the
 * offer names the label the user pressed, and that running it sends `archived: false` for that
 * label's id — the archive and its inverse, with nothing in between.
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

import { LabelSettings } from './LabelSettings';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const AT = '2026-01-01T00:00:00.000Z';

function label(id: string, name: string): Entity {
  return {
    id,
    workspaceId: WORKSPACE,
    teamId: undefined,
    name,
    color: '#3b82f6',
    isGroup: false,
    position: 'a',
    createdAt: AT,
    updatedAt: AT,
  } as unknown as Entity;
}

function renderScreen() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    {
      v: 1,
      type: 'workspace',
      id: WORKSPACE,
      op: 'upsert',
      actor: { type: 'system' },
      payload: {
        id: WORKSPACE,
        name: 'Acme',
        urlKey: 'acme',
        plan: 'free',
        createdAt: AT,
        updatedAt: AT,
      },
    },
    {
      v: 2,
      type: 'label',
      id: 'l-design',
      op: 'upsert',
      actor: { type: 'system' },
      payload: label('l-design', 'Needs design'),
    },
  ] as Change[]);

  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <LabelSettings />
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

describe('archiving a label', () => {
  it('offers an undo naming the label, which sends the inverse', async () => {
    const { mutate, user } = renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Archive Needs design' }));
    await user.click(await screen.findByRole('button', { name: 'Archive' }));

    await waitFor(() => {
      expect(mutate.mock.calls[0]![0]).toMatchObject({
        variables: { id: 'l-design', archived: true },
      });
    });

    // The offer arrives only once the archive has resolved: the server refuses it while any
    // issue still carries the label, and an offer made before the answer would be a lie.
    await waitFor(() => {
      expect(latest(snapshot())?.label).toBe('Archived Needs design');
    });

    await latest(snapshot())!.undo();
    expect(mutate.mock.calls.at(-1)![0]).toMatchObject({
      variables: { id: 'l-design', archived: false },
    });
  });
});
