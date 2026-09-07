/**
 * The edit dialog, from the outside: what a date picker shows, what a save sends, and what
 * happens when the window is impossible or the server says no.
 *
 * The dates moved from two raw `<input type="date">` to two `DatePicker`s, so the cases that
 * used to type into a field open a panel and set a day in it. The assertions did not move:
 * the day shown is still the team's rather than UTC's, and the instant sent still keeps the
 * time of day the window ends at.
 *
 * The last two are what the dialog had none of — it was the only create-or-edit dialog in
 * the product with no keymap registration at all, so ⌘⏎ did nothing and `j` fell through to
 * the list behind it.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KeymapProvider, useActions, useKeyContext } from '~/app/keymap';
import type { Cycle } from '~/store';
import { ApiError } from '~/sync/api';

import { CycleEditModal } from './CycleEditModal';

const AT = '2026-01-01T00:00:00.000Z';

/** 2026-01-05 00:00 to 2026-01-18 23:59:59.999, in Tokyo. */
const TOKYO_CYCLE: Cycle = {
  id: 'cy1',
  workspaceId: 'w',
  teamId: 't1',
  number: 1,
  name: 'Cycle 1',
  startsAt: '2026-01-04T15:00:00.000Z',
  endsAt: '2026-01-18T14:59:59.999Z',
  createdAt: AT,
  updatedAt: AT,
};

function mount(onSave: (edit: unknown) => void | Promise<void>) {
  render(
    <KeymapProvider>
      <CycleEditModal
        open
        cycle={TOKYO_CYCLE}
        phase="Upcoming"
        timezone="Asia/Tokyo"
        onClose={() => {}}
        onSave={onSave as never}
      />
    </KeymapProvider>,
  );
  return userEvent.setup();
}

/** The pill for one end of the window, found by the property it is described by. */
function datePill(property: 'Starts' | 'Ends'): HTMLElement {
  return screen.getByRole('button', { description: property });
}

/** Opens one end's panel and sets a day in it, the way somebody with a keyboard would. */
async function setDay(
  user: ReturnType<typeof userEvent.setup>,
  property: 'Starts' | 'Ends',
  day: string,
) {
  await user.click(datePill(property));
  const panel = await screen.findByRole('dialog', { name: property });
  fireEvent.change(within(panel).getByLabelText('Or a date'), { target: { value: day } });
  await user.click(within(panel).getByRole('button', { name: 'Set' }));
}

function save(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole('button', { name: 'Save' }));
}

afterEach(cleanup);

describe('CycleEditModal dates', () => {
  it('shows the day the team is on, not the UTC one', async () => {
    const user = mount(vi.fn());

    await user.click(datePill('Starts'));
    const starts = await screen.findByRole('dialog', { name: 'Starts' });
    expect((within(starts).getByLabelText('Or a date') as HTMLInputElement).value).toBe(
      '2026-01-05',
    );
    await user.keyboard('{Escape}');

    await user.click(datePill('Ends'));
    const ends = await screen.findByRole('dialog', { name: 'Ends' });
    expect((within(ends).getByLabelText('Or a date') as HTMLInputElement).value).toBe('2026-01-18');
  });

  it('sends no dates when nothing was changed', async () => {
    const onSave = vi.fn();
    const user = mount(onSave);

    await save(user);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const edit = onSave.mock.calls[0]![0] as Record<string, unknown>;
    expect(edit.startsAt).toBeUndefined();
    expect(edit.endsAt).toBeUndefined();
  });

  it('keeps the time of day the team’s window ends at', async () => {
    const onSave = vi.fn();
    const user = mount(onSave);

    await setDay(user, 'Ends', '2026-01-20');
    await save(user);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const edit = onSave.mock.calls[0]![0] as Record<string, unknown>;
    // 2026-01-20 23:59:59.999 in Tokyo.
    expect(edit.endsAt).toBe('2026-01-20T14:59:59.999Z');
  });

  it('refuses an end that is not after the start, and says so on the field', async () => {
    const onSave = vi.fn();
    const user = mount(onSave);

    await setDay(user, 'Ends', '2026-01-02');
    await save(user);

    expect(await screen.findByText('The end has to come after the start.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('CycleEditModal when the write is refused', () => {
  it('stays open and shows the reason', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockRejectedValue(new ApiError('VALIDATION', 'Past dates are fixed.'));
    render(
      <KeymapProvider>
        <CycleEditModal
          open
          cycle={TOKYO_CYCLE}
          phase="Upcoming"
          timezone="Asia/Tokyo"
          onClose={onClose}
          onSave={onSave}
        />
      </KeymapProvider>,
    );
    const user = userEvent.setup();

    await save(user);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Past dates are fixed.');
    expect(onClose).not.toHaveBeenCalled();
  });
});

/** A stand-in for the list under the dialog: it claims `j` in the `list` context. */
function ListBehind({ onDown }: { onDown: () => void }) {
  useKeyContext('list');
  useActions(
    [
      {
        id: 'test.moveDown',
        title: 'Move down',
        keys: ['j'],
        when: 'list',
        group: 'Test',
        run: onDown,
      },
    ],
    [onDown],
  );
  return null;
}

describe('CycleEditModal and the keyboard', () => {
  it('saves on the submit chord, which it used to ignore entirely', async () => {
    const onSave = vi.fn();
    mount(onSave);

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('saves once when the chord is pressed twice in one tick', async () => {
    const onSave = vi.fn(() => new Promise<void>(() => {}));
    mount(onSave);

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does not leak j to the list behind it', () => {
    const onDown = vi.fn();
    render(
      <KeymapProvider>
        <ListBehind onDown={onDown} />
        <CycleEditModal
          open
          cycle={TOKYO_CYCLE}
          phase="Upcoming"
          timezone="Asia/Tokyo"
          onClose={() => {}}
          onSave={vi.fn()}
        />
      </KeymapProvider>,
    );

    fireEvent.keyDown(window, { key: 'j' });

    expect(onDown).not.toHaveBeenCalled();
  });
});
