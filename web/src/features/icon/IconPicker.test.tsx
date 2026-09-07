import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { KeymapProvider } from '~/app/keymap';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';

import { IconPicker, type IconValue } from './IconPicker';

/**
 * One change per act, and never a pair when only one half moved.
 *
 * That is the whole contract worth pinning: this panel writes to a project, and a control
 * that emitted its value on every keystroke of the free-text field — or on every frame of a
 * drag on the native colour input — would put a mutation, a version and a change row on the
 * wire per character. `ColorPicker` already solved its half; this file is what stops the
 * emoji half regressing.
 */

function Harness({
  onChange,
  initial = { icon: '🚀', color: '#3b82f6' },
}: {
  onChange: (value: IconValue) => void;
  initial?: IconValue;
}) {
  const trigger = useMenuTrigger('dialog');
  const [value, setValue] = useState<IconValue>(initial);
  return (
    <KeymapProvider>
      <button {...trigger.props}>Open</button>
      <IconPicker
        open={trigger.open}
        onClose={trigger.hide}
        trigger={trigger.ref}
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        actionId="project.closeIconPicker"
        label="Project icon"
      />
    </KeymapProvider>
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open' }));
}

describe('IconPicker', () => {
  it('commits one change for one emoji, keeping the colour it was given', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const user = userEvent.setup();
    await open(user);

    await user.click(screen.getByRole('button', { name: '🎯' }));

    expect(onChange.mock.calls).toEqual([[{ icon: '🎯', color: '#3b82f6' }]]);
  });

  it('commits one change for one colour, keeping the emoji it was given', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const user = userEvent.setup();
    await open(user);

    // Through the swatches, which is where ColorPicker's own "one commit per discrete act"
    // lives; the panel below it is opened by its trigger.
    await user.click(screen.getByRole('button', { name: 'Project icon colour' }));
    await user.click(screen.getByRole('button', { name: '#16a34a' }));

    expect(onChange.mock.calls).toEqual([[{ icon: '🚀', color: '#16a34a' }]]);
  });

  it('takes an emoji this grid does not offer, on submit and not per keystroke', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const user = userEvent.setup();
    await open(user);

    const field = screen.getByLabelText('Or any emoji');
    fireEvent.change(field, { target: { value: '🦆' } });
    // Nothing yet: typing is not choosing, and a change per character is a mutation per
    // character on the wire.
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.submit(field);
    expect(onChange.mock.calls).toEqual([[{ icon: '🦆', color: '#3b82f6' }]]);
  });

  it('takes one glyph from a paste of several, rather than a sentence in the sidebar', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const user = userEvent.setup();
    await open(user);

    const field = screen.getByLabelText('Or any emoji');
    fireEvent.change(field, { target: { value: '🦆🐣' } });
    fireEvent.submit(field);

    expect(onChange.mock.calls).toEqual([[{ icon: '🦆', color: '#3b82f6' }]]);
  });

  it('marks the current emoji, so the panel says what is already chosen', async () => {
    render(<Harness onChange={vi.fn()} />);
    const user = userEvent.setup();
    await open(user);

    expect(screen.getByRole('button', { name: '🚀' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '🎯' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('closes on Escape and gives the trigger its focus back', async () => {
    render(<Harness onChange={vi.fn()} />);
    const user = userEvent.setup();
    await open(user);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Project icon' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
  });
});
