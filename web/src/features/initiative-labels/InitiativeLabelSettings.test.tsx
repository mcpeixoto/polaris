/**
 * Initiative labels settings — create a group and a label inside it.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { InitiativeLabelSettings } from '~/features/initiative-labels/InitiativeLabelSettings';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
const AT = '2026-01-01T00:00:00.000Z';

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

describe('Initiative label settings', () => {
  it('has a heading and creates a group', async () => {
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
    ]);
    const mutate = vi.fn().mockResolvedValue({
      createInitiativeLabel: {
        initiativeLabel: {
          id: 'ilg',
          workspaceId: WORKSPACE,
          name: 'Team',
          color: '#6b7280',
          isGroup: true,
          position: 'a0',
          createdAt: AT,
          updatedAt: AT,
        },
      },
    });
    const engine = { store, mutate } as unknown as SyncEngine;
    const user = userEvent.setup();
    render(
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <InitiativeLabelSettings />
      </EngineProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Initiative labels' })).toBeTruthy();
    await user.type(screen.getByLabelText('Name'), 'Team');
    await user.click(screen.getByRole('checkbox', { name: 'A group of labels' }));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(mutate).toHaveBeenCalled();
    const input = mutate.mock.calls[0]![0] as {
      variables: { input: { name?: string; isGroup?: boolean } };
    };
    expect(input.variables.input.name).toBe('Team');
    expect(input.variables.input.isGroup).toBe(true);
  });
});
