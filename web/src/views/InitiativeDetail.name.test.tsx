/**
 * Renaming an initiative in place: an empty name is never written, and an unchanged one is
 * not written back either.
 *
 * The rename moved from a "Name" field in the overview's property form to the shared
 * `TitleField` in `InitiativeShell`, which is what the issue and project screens rename
 * with — so these render the shell and open the box with `e`. The rule this file has always
 * checked survives the move: clearing the name and leaving the field must not leave the
 * screen showing a name that was never saved. `TitleField` answers it by reverting to the
 * stored name rather than by raising "An initiative needs a name" beneath a form field
 * there no longer is; the assertion below checks the revert as well as the silence.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { InitiativeShell } from './InitiativeShell';

const W = 'w1';
const VIEWER = 'u1';
const INITIATIVE = 'i1';
const AT = '2026-01-01T00:00:00.000Z';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => null,
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

function renderShell() {
  const store = new Store(W);
  store.applyChanges([
    upsert(1, 'initiative', {
      id: INITIATIVE,
      workspaceId: W,
      name: 'Platform reliability',
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
            <Route path="/initiative/:initiativeId" element={<InitiativeShell />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

describe('Initiative rename', () => {
  it('opens the name for editing with e, focused', async () => {
    const { user } = renderShell();
    await user.keyboard('e');
    const field = screen.getByLabelText('Name');
    expect(field).toBe(document.activeElement);
    expect((field as HTMLTextAreaElement).value).toBe('Platform reliability');
  });

  it('refuses an empty name and puts the stored one back rather than saving nothing', async () => {
    const { mutate, user } = renderShell();
    await user.keyboard('e');
    await user.clear(screen.getByLabelText('Name'));
    await user.tab();
    expect(mutate).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Name') as HTMLTextAreaElement).value).toBe(
      'Platform reliability',
    );
    expect(screen.getByRole('heading', { name: 'Platform reliability' })).toBeTruthy();
  });

  it('saves a name typed in its place', async () => {
    const { mutate, user } = renderShell();
    await user.keyboard('e');
    const field = screen.getByLabelText('Name');
    await user.clear(field);
    await user.type(field, 'Reliability');
    await user.tab();
    expect(mutate).toHaveBeenCalled();
    const call = mutate.mock.calls[0]![0] as { variables: { input: { name?: string } } };
    expect(call.variables.input.name).toBe('Reliability');
  });

  it('does not write when the name is unchanged', async () => {
    const { mutate, user } = renderShell();
    await user.keyboard('e');
    await user.tab();
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Platform reliability' })).toBeTruthy();
  });
});
