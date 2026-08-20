/**
 * Saving a filter as a named view has to send `private` and `teamId` the way the sidebar
 * visibility rule reads them. A private view without an owner id appears in everybody's
 * sidebar for one round trip; a shared team view without a team id is a workspace view
 * members cannot create.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { EMPTY_FILTER } from '~/filter';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { SaveViewModal } from './SaveViewModal';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const VIEWER = '01900000-0000-7000-8000-000000000002';
const TEAM = '01900000-0000-7000-8000-000000000003';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, role: 'member' }),
}));

function renderModal(teamId?: string) {
  const store = new Store(WORKSPACE);
  const mutate = vi.fn().mockResolvedValue({
    createView: {
      view: {
        id: 'view-1',
        workspaceId: WORKSPACE,
        name: 'My bugs',
        filter: {},
        display: {},
        position: 'a0',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  });
  const engine = { store, mutate } as unknown as SyncEngine;

  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <SaveViewModal
            filter={EMPTY_FILTER}
            display={{}}
            teamId={teamId}
            onClose={() => undefined}
          />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { mutate, user: userEvent.setup() };
}

describe('SaveViewModal', () => {
  it('saves a team view as shared when Only visible to me is off', async () => {
    const { mutate, user } = renderModal(TEAM);
    await user.type(screen.getByLabelText('Name'), 'My bugs');
    await user.click(screen.getByRole('button', { name: 'Save view' }));

    expect(mutate).toHaveBeenCalled();
    const input = mutate.mock.calls[0]?.[0].variables.input as {
      name: string;
      teamId?: string;
      private?: boolean;
    };
    expect(input.name).toBe('My bugs');
    expect(input.teamId).toBe(TEAM);
    expect(input.private).toBe(false);
  });

  it('defaults a workspace save to private for a member', async () => {
    const { mutate, user } = renderModal();
    expect((screen.getByLabelText('Only visible to me') as HTMLInputElement).checked).toBe(true);
    await user.type(screen.getByLabelText('Name'), 'Mine');
    await user.click(screen.getByRole('button', { name: 'Save view' }));

    const input = mutate.mock.calls[0]?.[0].variables.input as { private?: boolean };
    expect(input.private).toBe(true);
  });
});
