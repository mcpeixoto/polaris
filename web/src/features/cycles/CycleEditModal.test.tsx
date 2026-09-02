/**
 * The edit dialog, from the outside: what a date input shows, what a save sends, and what
 * happens when the window is impossible or the server says no.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    <CycleEditModal
      open
      cycle={TOKYO_CYCLE}
      phase="Upcoming"
      timezone="Asia/Tokyo"
      onClose={() => {}}
      onSave={onSave as never}
    />,
  );
  return userEvent.setup();
}

function save(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole('button', { name: 'Save' }));
}

afterEach(cleanup);

describe('CycleEditModal dates', () => {
  it('shows the day the team is on, not the UTC one', () => {
    mount(vi.fn());
    expect((screen.getByLabelText('Starts') as HTMLInputElement).value).toBe('2026-01-05');
    expect((screen.getByLabelText('Ends') as HTMLInputElement).value).toBe('2026-01-18');
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

    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-01-20' } });
    await save(user);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const edit = onSave.mock.calls[0]![0] as Record<string, unknown>;
    // 2026-01-20 23:59:59.999 in Tokyo.
    expect(edit.endsAt).toBe('2026-01-20T14:59:59.999Z');
  });

  it('refuses an end that is not after the start, and says so on the field', async () => {
    const onSave = vi.fn();
    const user = mount(onSave);

    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-01-02' } });
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
      <CycleEditModal
        open
        cycle={TOKYO_CYCLE}
        phase="Upcoming"
        timezone="Asia/Tokyo"
        onClose={onClose}
        onSave={onSave}
      />,
    );
    const user = userEvent.setup();

    await save(user);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Past dates are fixed.');
    expect(onClose).not.toHaveBeenCalled();
  });
});
