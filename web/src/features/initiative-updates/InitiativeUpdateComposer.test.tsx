/**
 * Posting an initiative update from wherever health is drawn.
 *
 * Health is not a field on an initiative — it is the newest update's word — so the only
 * honest way to make a health cell editable is to let the reader post the update from
 * there. The form moved out of the overview so that the list and the page share one copy,
 * and the claims worth pinning are the ones a second copy would be free to lose: a blank
 * body is refused rather than filed as an empty entry, and the health chosen is the health
 * written.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { EngineStatus, SyncEngine } from '~/sync/engine';

import { InitiativeUpdateForm } from './InitiativeUpdateComposer';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const INITIATIVE = 'i1';
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

function mount(initialHealth?: 'on_track' | 'at_risk' | 'off_track') {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'initiative', {
      id: INITIATIVE,
      workspaceId: WORKSPACE,
      name: 'Company goals',
      description: '',
      status: 'planned',
      priority: 0,
      sortOrder: 'a',
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
  ]);

  const mutate = vi.fn().mockResolvedValue({
    createInitiativeUpdate: {
      initiativeUpdate: {
        id: 'iu1',
        workspaceId: WORKSPACE,
        initiativeId: INITIATIVE,
        health: 'AT_RISK',
        body: 'Slipping a week.',
        authorId: VIEWER,
        createdAt: AT,
        updatedAt: AT,
      },
    },
  });
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <EngineProvider engine={engine} status={{ phase: 'idle' } as EngineStatus}>
      <KeymapProvider>
        <InitiativeUpdateForm
          initiativeId={INITIATIVE}
          initialHealth={initialHealth}
          onPosted={() => {}}
        />
      </KeymapProvider>
    </EngineProvider>,
  );

  return { mutate, user: userEvent.setup() };
}

afterEach(cleanup);

describe('InitiativeUpdateForm', () => {
  it('refuses a blank body rather than filing an empty update', async () => {
    const { mutate, user } = mount();

    await user.click(screen.getByRole('button', { name: 'Post update' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'An update needs something to say.',
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it('posts the health that was chosen, with the words written', async () => {
    const { mutate, user } = mount();

    await user.selectOptions(screen.getByLabelText('Health'), 'at_risk');
    await user.type(screen.getByRole('textbox', { name: 'Update' }), 'Slipping a week.');
    await user.click(screen.getByRole('button', { name: 'Post update' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const call = mutate.mock.calls[0]![0] as { variables: { input: Record<string, unknown> } };
    expect(call.variables.input.initiativeId).toBe(INITIATIVE);
    expect(call.variables.input.health).toBe('AT_RISK');
    expect(call.variables.input.body).toBe('Slipping a week.');
  });

  it('opens on the health it was given, so posting again confirms it', async () => {
    const { mutate, user } = mount('off_track');

    await user.type(screen.getByRole('textbox', { name: 'Update' }), 'Vendor pulled out.');
    await user.click(screen.getByRole('button', { name: 'Post update' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const call = mutate.mock.calls[0]![0] as { variables: { input: Record<string, unknown> } };
    expect(call.variables.input.health).toBe('OFF_TRACK');
  });
});
