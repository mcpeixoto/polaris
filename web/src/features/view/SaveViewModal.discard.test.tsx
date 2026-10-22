/**
 * Escape, over a view dialog with a name in it.
 *
 * The filter being saved belongs to the list and survives a close; the name does not, so it
 * is the only thing worth a question. The last case is the one that makes the question worth
 * asking at all: "Keep editing" has to leave the name where it was.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { EMPTY_FILTER } from '~/filter';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { SaveViewModal } from './SaveViewModal';

const WORKSPACE = '01900000-0000-7000-8000-000000000001';
const VIEWER = '01900000-0000-7000-8000-000000000002';

vi.mock('~/hooks/useViewer', () => ({
  useViewerId: () => VIEWER,
  useViewer: () => ({ id: VIEWER, role: 'member' }),
}));

function renderDialog() {
  const engine = { store: new Store(WORKSPACE), mutate: vi.fn() } as unknown as SyncEngine;
  const onClose = vi.fn();

  render(
    <MemoryRouter>
      <KeymapProvider>
        <EngineProvider engine={engine} status={{ phase: 'idle' }}>
          <SaveViewModal filter={EMPTY_FILTER} display={{}} onClose={onClose} />
        </EngineProvider>
      </KeymapProvider>
    </MemoryRouter>,
  );

  return { user: userEvent.setup(), onClose };
}

afterEach(cleanup);

describe('discarding a view being saved', () => {
  it('closes on Escape when nothing has been typed', async () => {
    const { user, onClose } = renderDialog();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Discard this view?' })).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before throwing away a named view', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'My bugs');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: 'Discard this view?' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on discard', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'My bugs');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this view?' });
    await user.click(within(question).getByRole('button', { name: 'Discard' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog, and the name in it, on keep editing', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), 'My bugs');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: 'Discard this view?' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Discard this view?' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('My bugs');
  });
});
