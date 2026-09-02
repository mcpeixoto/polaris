/**
 * Clearing the name says so, rather than leaving the field and the header disagreeing.
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

function renderDetail() {
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
            <Route path="/initiative/:initiativeId" element={<InitiativeDetail />} />
          </Routes>
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

describe('Initiative name field', () => {
  it('refuses an empty name and says why instead of discarding it silently', async () => {
    const { mutate, user } = renderDetail();
    const field = screen.getByLabelText('Name');
    await user.clear(field);
    await user.tab();
    expect(screen.getByText('An initiative needs a name')).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('clears the error and saves once a name is typed back in', async () => {
    const { mutate, user } = renderDetail();
    const field = screen.getByLabelText('Name');
    await user.clear(field);
    await user.tab();
    await user.type(field, 'Reliability');
    await user.tab();
    expect(screen.queryByText('An initiative needs a name')).toBeNull();
    expect(mutate).toHaveBeenCalled();
    const call = mutate.mock.calls[0]![0] as { variables: { input: { name?: string } } };
    expect(call.variables.input.name).toBe('Reliability');
  });

  it('does not write when the name is unchanged', async () => {
    const { mutate, user } = renderDetail();
    await user.click(screen.getByLabelText('Name'));
    await user.tab();
    expect(mutate).not.toHaveBeenCalled();
  });
});
