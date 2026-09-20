/**
 * Posting an update from wherever health is drawn.
 *
 * Health is not a project field — it is the newest update's word — so the only honest way
 * to make a health cell editable is to let the reader post the update from there. The
 * claims worth pinning are the ones the overview's composer already makes and a second
 * copy would be free to lose: a blank body is refused rather than filed as an empty entry,
 * and the health chosen is the health written.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProjectUpdateForm } from './ProjectUpdateComposer';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const PROJECT = 'p1';
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

function mount() {
  const store = new Store(WORKSPACE);
  store.applyChanges([
    upsert(1, 'project', {
      id: PROJECT,
      workspaceId: WORKSPACE,
      name: 'Casa Nova',
      priority: 0,
      createdAt: AT,
      updatedAt: AT,
    } as Entity),
  ]);

  const mutate = vi.fn().mockResolvedValue({
    createProjectUpdate: {
      projectUpdate: {
        id: 'pu1',
        workspaceId: WORKSPACE,
        projectId: PROJECT,
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
    <EngineProvider engine={engine} status={{ phase: 'idle' }}>
      <KeymapProvider>
        <ProjectUpdateForm projectId={PROJECT} onPosted={() => {}} />
      </KeymapProvider>
    </EngineProvider>,
  );

  return { mutate };
}

afterEach(cleanup);

describe('ProjectUpdateForm', () => {
  it('refuses a blank body rather than filing an empty update', async () => {
    const user = userEvent.setup();
    const { mutate } = mount();

    await user.click(screen.getByRole('button', { name: 'Post update' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'An update needs something to say.',
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it('posts the health that was chosen, with the words written', async () => {
    const user = userEvent.setup();
    const { mutate } = mount();

    await user.click(screen.getByRole('button', { name: /Health/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'At risk' }));
    await user.type(screen.getByRole('textbox', { name: 'Update' }), 'Slipping a week.');
    await user.click(screen.getByRole('button', { name: 'Post update' }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const call = mutate.mock.calls[0]?.[0] as { variables: { input: Record<string, unknown> } };
    expect(call.variables.input).toMatchObject({
      projectId: PROJECT,
      health: 'AT_RISK',
      body: 'Slipping a week.',
    });
  });
});
