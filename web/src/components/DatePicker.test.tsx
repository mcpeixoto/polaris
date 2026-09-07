import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { KeymapProvider } from '~/app/keymap';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';

import { DatePicker } from './DatePicker';

/**
 * The two facts this picker is worth having: the relatives resolve in the zone it was given
 * rather than the runner's, and two of these coexist on one screen.
 *
 * The second is not a detail. A project has a start date and a target date side by side, and
 * the panel this was extracted from claimed Escape under a hard-coded action id — which the
 * registry refuses on a second mount. So the id is a prop, and this file is what stops it
 * quietly becoming a constant again.
 */

// A Wednesday in Lisbon.
const NOW = Date.parse('2026-09-02T09:00:00Z');

function Harness({
  actionId,
  label,
  value = null,
  onSelect = vi.fn(),
}: {
  actionId: string;
  label: string;
  value?: string | null;
  onSelect?: (day: string | null) => void;
}) {
  const trigger = useMenuTrigger('dialog');
  return (
    <>
      <button {...trigger.props}>{`Open ${label}`}</button>
      <DatePicker
        open={trigger.open}
        onClose={trigger.hide}
        trigger={trigger.ref}
        value={value}
        timezone="Europe/Lisbon"
        now={NOW}
        onSelect={onSelect}
        actionId={actionId}
        label={label}
        clearLabel={`No ${label.toLowerCase()}`}
      />
    </>
  );
}

describe('DatePicker', () => {
  it('offers the four relatives and writes the day they resolve to', async () => {
    const onSelect = vi.fn();
    render(
      <KeymapProvider>
        <Harness actionId="test.closeDate" label="Target date" onSelect={onSelect} />
      </KeymapProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open Target date' }));

    expect(screen.getByRole('dialog', { name: 'Target date' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'End of week' }));

    // Wednesday 2 September 2026 → Friday the 4th, and the date rather than a token that
    // would move itself to next Friday every Friday.
    expect(onSelect).toHaveBeenCalledWith('2026-09-04');
  });

  it('takes a typed date, and refuses a half-typed one', async () => {
    const onSelect = vi.fn();
    render(
      <KeymapProvider>
        <Harness actionId="test.closeDate" label="Target date" onSelect={onSelect} />
      </KeymapProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open Target date' }));

    fireEvent.change(screen.getByLabelText('Or a date'), { target: { value: '2026-1' } });
    expect((screen.getByRole('button', { name: 'Set' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Or a date'), { target: { value: '2026-12-24' } });
    await user.click(screen.getByRole('button', { name: 'Set' }));
    expect(onSelect).toHaveBeenCalledWith('2026-12-24');
  });

  it('clears with null, and offers nothing to clear when there is no date', async () => {
    const onSelect = vi.fn();
    const view = render(
      <KeymapProvider>
        <Harness actionId="test.closeDate" label="Target date" onSelect={onSelect} />
      </KeymapProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open Target date' }));

    expect(
      (screen.getByRole('button', { name: 'No target date' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    view.rerender(
      <KeymapProvider>
        <Harness
          actionId="test.closeDate"
          label="Target date"
          value="2026-09-10"
          onSelect={onSelect}
        />
      </KeymapProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'No target date' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  /**
   * The whole reason `actionId` is a required prop rather than a constant inside the file.
   */
  it('mounts two pickers on one screen, each closing only while it is the open one', async () => {
    render(
      <KeymapProvider>
        <Harness actionId="project.closeStartDate" label="Start date" />
        <Harness actionId="project.closeTargetDate" label="Target date" />
      </KeymapProvider>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Open Start date' }));
    expect(screen.getByRole('dialog', { name: 'Start date' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Target date' })).toBeNull();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Start date' })).toBeNull();

    // The other one still works, which is what a shared Escape would have broken: the first
    // panel's binding stays registered while it is shut, and is only unbound in effect.
    await user.click(screen.getByRole('button', { name: 'Open Target date' }));
    expect(screen.getByRole('dialog', { name: 'Target date' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Target date' })).toBeNull();
  });

  it('seeds the box on opening rather than while it is being typed in', async () => {
    const view = render(
      <KeymapProvider>
        <Harness actionId="test.closeDate" label="Target date" value="2026-09-10" />
      </KeymapProvider>,
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Open Target date' });
    await user.click(trigger);

    expect((screen.getByLabelText('Or a date') as HTMLInputElement).value).toBe('2026-09-10');
    fireEvent.change(screen.getByLabelText('Or a date'), { target: { value: '2026-12-24' } });

    // Somebody else moves the date while this one is open and mid-edit.
    view.rerender(
      <KeymapProvider>
        <Harness actionId="test.closeDate" label="Target date" value="2026-09-20" />
      </KeymapProvider>,
    );
    expect((screen.getByLabelText('Or a date') as HTMLInputElement).value).toBe('2026-12-24');

    // Closed and reopened, it shows what the thing actually has — not reseeding at all would
    // be the other half of the same bug.
    await user.click(trigger);
    await user.click(trigger);
    expect((screen.getByLabelText('Or a date') as HTMLInputElement).value).toBe('2026-09-20');
  });
});
