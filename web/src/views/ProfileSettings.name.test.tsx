/**
 * The blur-save bargain: no Save button, so the screen owes both halves of the answer.
 *
 * `updateProfile` drops an empty name and then no-ops, and the screen used to agree in
 * silence — the field stayed blank, the store kept the old value, and somebody walked away
 * from a rename that never happened. A successful save was equally silent, which on screen
 * is the same thing as having done nothing.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store, type Change, type Entity } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { ProfileSettings } from './ProfileSettings';

const WORKSPACE = 'w1';
const VIEWER = 'u1';
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

function renderProfile() {
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
  const mutate = vi.fn().mockResolvedValue({});
  const engine = { store, mutate } as unknown as SyncEngine;
  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <ProfileSettings />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );
  return { mutate, user: userEvent.setup() };
}

describe('Profile names', () => {
  it('refuses an emptied username and puts the value back', async () => {
    const { mutate, user } = renderProfile();
    const field = screen.getByLabelText('Username') as HTMLInputElement;

    await user.clear(field);
    await user.tab();

    const message = await screen.findByRole('alert');
    expect(message.textContent).toMatch(/cannot be empty/i);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toContain(message.id);
    // The input shows what the product holds, rather than a value nothing has.
    expect(field.value).toBe('ada');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('takes the refusal away as soon as the field is typed in again', async () => {
    const { user } = renderProfile();
    const field = screen.getByLabelText('Username');

    await user.clear(field);
    await user.tab();
    await screen.findByRole('alert');

    await user.type(field, 'x');
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('says a save happened', async () => {
    const { mutate, user } = renderProfile();
    const field = screen.getByLabelText('Display name');

    await user.clear(field);
    await user.type(field, 'Ada');
    await user.tab();

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const status = await screen.findByRole('status');
    await waitFor(() => {
      expect(status.textContent).toBe('Saved');
    });
  });
});
