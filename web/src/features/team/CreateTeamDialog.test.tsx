/**
 * The team dialog, from the outside. It had no test at all, which is a strange gap for the
 * one create in the product that cannot be optimistic and cannot easily be undone: a key is
 * stamped into every identifier the team will ever mint.
 *
 * The cases are the three things that reach the wire and are easy to drop on the way — the
 * key the field suggested, the privacy switch, and the icon that until now had no control
 * anywhere — plus the two-⌘⏎ window, which here would create two teams and burn two keys.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CreateTeamDialog } from './CreateTeamDialog';
import { createTeam } from './create';

vi.mock('./create', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./create')>();
  return { ...actual, createTeam: vi.fn() };
});

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const TEAM = '01900000-0000-7000-8000-000000000002';
const AT = '2026-01-01T00:00:00.000Z';

const filed = vi.mocked(createTeam);

function madeTeam() {
  return { id: TEAM, workspaceId: WORKSPACE, key: 'DS', name: 'Design systems', createdAt: AT };
}

function renderDialog() {
  const engine = { store: new Store(WORKSPACE), mutate: vi.fn() } as unknown as SyncEngine;
  const onClose = vi.fn();
  const onCreated = vi.fn();

  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <CreateTeamDialog onClose={onClose} onCreated={onCreated} />
      </EngineProvider>
    </KeymapProvider>,
  );

  return { user: userEvent.setup(), onClose, onCreated };
}

beforeEach(() => {
  filed.mockClear();
  filed.mockResolvedValue(madeTeam() as never);
});
afterEach(cleanup);

describe('CreateTeamDialog', () => {
  it('sends the suggested key, the privacy switch and the chosen icon', async () => {
    const { user, onCreated } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Design systems');
    await user.click(screen.getByRole('switch', { name: 'Private team' }));

    await user.click(screen.getByRole('button', { name: 'No icon' }));
    await user.click(await screen.findByRole('button', { name: '🚀' }));
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Create team' }));

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed.mock.calls[0]?.[1]).toMatchObject({
      name: 'Design systems',
      key: 'DS',
      private: true,
      icon: '🚀',
    });
    expect(onCreated).toHaveBeenCalled();
  });

  it('explains the private switch on the control rather than beside it', async () => {
    renderDialog();
    const control = screen.getByRole('switch', { name: 'Private team' });
    const describedBy = control.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')?.textContent).toContain(
      'invisible to anyone who is not a member',
    );
  });

  it('creates exactly one team when the chord is pressed twice in one tick', async () => {
    const { user } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Design systems');

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(filed).toHaveBeenCalledTimes(1));
    expect(filed).toHaveBeenCalledTimes(1);
  });
});
