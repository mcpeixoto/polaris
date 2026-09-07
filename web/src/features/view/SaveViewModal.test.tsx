/**
 * Saving a filter as a named view has to send `private` and `teamId` the way the sidebar
 * visibility rule reads them. A private view without an owner id appears in everybody's
 * sidebar for one round trip; a shared team view without a team id is a workspace view
 * members cannot create.
 *
 * Two more since the dialog absorbed the project tab row's copy of itself: the filter is
 * shown rather than only named, and `projectId` produces the tab-row wording the attached
 * views spec drives it by.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { EMPTY_FILTER, type FilterNode } from '~/filter';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { SaveViewModal } from './SaveViewModal';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const VIEWER = '01900000-0000-7000-8000-000000000002';
const TEAM = '01900000-0000-7000-8000-000000000003';
const PROJECT = '01900000-0000-7000-8000-000000000004';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, role: 'member' }),
}));

function renderModal(
  teamId?: string,
  extra: { filter?: FilterNode; projectId?: string; onCreated?: (id: string) => void } = {},
) {
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
            filter={extra.filter ?? EMPTY_FILTER}
            display={{}}
            teamId={teamId}
            projectId={extra.projectId}
            onCreated={extra.onCreated}
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
    // A switch, not a tick box: it decides what the view *is* rather than adding a value.
    expect(screen.getByRole('switch', { name: 'Only visible to me' })).toHaveProperty(
      'ariaChecked',
      'true',
    );
    await user.type(screen.getByLabelText('Name'), 'Mine');
    await user.click(screen.getByRole('button', { name: 'Save view' }));

    const input = mutate.mock.calls[0]?.[0].variables.input as { private?: boolean };
    expect(input.private).toBe(true);
  });

  it('shows the filter it is about to save rather than only asking for a name', async () => {
    const filter: FilterNode = { nodes: [{ field: 'priority', op: 'eq', values: ['1'] }] };
    renderModal(TEAM, { filter });

    const summary = await screen.findByRole('group', { name: 'Filter being saved' });
    expect(summary.textContent).toContain('Priority');
    expect(summary.textContent).toContain('Urgent');
  });

  it('says so when there is nothing narrowing the list', () => {
    renderModal(TEAM);
    expect(screen.getByText('No filters — every issue in this list')).toBeTruthy();
  });

  it('is the project tab row’s dialog too, with its wording and no privacy switch', async () => {
    const onCreated = vi.fn();
    const { mutate, user } = renderModal(undefined, { projectId: PROJECT, onCreated });

    expect(screen.getByRole('dialog', { name: 'New view' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Only visible to me' })).toBeNull();

    await user.type(screen.getByLabelText('Name'), 'Alpha');
    await user.click(screen.getByRole('button', { name: 'Create view' }));

    expect(mutate).toHaveBeenCalled();
    const input = mutate.mock.calls[0]?.[0].variables.input as {
      projectId?: string;
      private?: boolean;
    };
    expect(input.projectId).toBe(PROJECT);
    // A tab everyone on the project can see is the only kind of tab there is.
    expect(input.private).toBe(false);
    expect(onCreated).toHaveBeenCalledWith('view-1');
  });
});
