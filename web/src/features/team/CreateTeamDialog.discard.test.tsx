/**
 * Escape, over a team dialog somebody has started filling in.
 *
 * A team is the one create here that cannot be undone cheaply — the key is stamped into
 * every identifier it will mint — so the dialog is usually open for a while, which is
 * exactly how long Escape has to be wrong for. The suggested key is not work: a dialog
 * opened and dismissed without a word typed still closes on the first press.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { CreateTeamDialog } from './CreateTeamDialog';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';

function renderDialog() {
  const engine = { store: new Store(WORKSPACE), mutate: vi.fn() } as unknown as SyncEngine;
  const onClose = vi.fn();

  render(
    <KeymapProvider>
      <EngineProvider engine={engine} status={{ phase: 'idle' }}>
        <CreateTeamDialog onClose={onClose} />
      </EngineProvider>
    </KeymapProvider>,
  );

  return { user: userEvent.setup(), onClose };
}

afterEach(cleanup);

describe('discarding a new team', () => {
  it('closes on Escape when nothing has been typed', async () => {
    const { user, onClose } = renderDialog();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Discard this team?' })).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before throwing away a named team', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Design systems');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: 'Discard this team?' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks over a key that was typed rather than suggested', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Key'), 'DS');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: 'Discard this team?' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on discard', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Design systems');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this team?' });
    await user.click(within(question).getByRole('button', { name: 'Discard' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog, and the name in it, on keep editing', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Design systems');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this team?' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Discard this team?' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Design systems');
  });
});
