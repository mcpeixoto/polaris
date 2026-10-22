/**
 * Escape out of the cycle edit dialog.
 *
 * This is the one guard in the product measured against loaded values rather than against
 * empty, and the first case is the one that would make it worthless: a cycle opened and not
 * touched must close in silence. The cycle is in Tokyo and its stored instants fall on
 * different UTC days from the team's, so a comparison done on instants rather than on the
 * day strings the inputs hold would call this dialog dirty the moment it opened.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KeymapProvider } from '~/app/keymap';
import type { Cycle } from '~/store';

import { CycleEditModal } from './CycleEditModal';

const AT = '2026-01-01T00:00:00.000Z';

/** 2026-01-05 00:00 to 2026-01-18 23:59:59.999, in Tokyo. */
const TOKYO_CYCLE: Cycle = {
  id: 'cy1',
  workspaceId: 'w',
  teamId: 't1',
  number: 1,
  name: 'Cycle 1',
  description: 'Ship the importer',
  startsAt: '2026-01-04T15:00:00.000Z',
  endsAt: '2026-01-18T14:59:59.999Z',
  createdAt: AT,
  updatedAt: AT,
};

const QUESTION = 'Discard these changes?';

function renderDialog() {
  const onClose = vi.fn();
  render(
    <KeymapProvider>
      <CycleEditModal
        open
        cycle={TOKYO_CYCLE}
        phase="Upcoming"
        timezone="Asia/Tokyo"
        onClose={onClose}
        onSave={vi.fn()}
      />
    </KeymapProvider>,
  );
  return { user: userEvent.setup(), onClose };
}

/** Opens one end's panel and sets a day in it, the way somebody with a keyboard would. */
async function setDay(
  user: ReturnType<typeof userEvent.setup>,
  property: 'Starts' | 'Ends',
  day: string,
) {
  await user.click(screen.getByRole('button', { description: property }));
  const panel = await screen.findByRole('dialog', { name: property });
  fireEvent.change(within(panel).getByLabelText('Or a date'), { target: { value: day } });
  await user.click(within(panel).getByRole('button', { name: 'Set' }));
}

afterEach(cleanup);

describe('CycleEditModal discard guard', () => {
  it('closes on Escape when the pre-filled cycle has not been touched', async () => {
    const { user, onClose } = renderDialog();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: QUESTION })).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks instead of closing when the name was edited', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), ' and a half');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: QUESTION })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks instead of closing when a date was moved', async () => {
    const { user, onClose } = renderDialog();

    await setDay(user, 'Ends', '2026-01-20');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('dialog', { name: QUESTION })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on discard', async () => {
    const { user, onClose } = renderDialog();

    await user.type(screen.getByLabelText('Name'), ' and a half');
    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Discard' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog, and the edit in it, on keep editing', async () => {
    const { user, onClose } = renderDialog();

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Importer sprint');
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: QUESTION });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: QUESTION })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Importer sprint');
  });
});
