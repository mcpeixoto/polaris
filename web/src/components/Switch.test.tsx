import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './Switch';

function Host({ disabled = false }: { disabled?: boolean }) {
  const [on, setOn] = useState(false);
  return <Switch label="Create more" checked={on} onChange={setOn} disabled={disabled} />;
}

/**
 * A switch is named by its label, announces on and off rather than checked and unchecked,
 * and flips from the keyboard — the three things that separate it from a styled checkbox.
 */
describe('Switch', () => {
  it('is a named switch that reports its state', () => {
    render(<Host />);
    const control = screen.getByRole('switch', { name: 'Create more' });
    expect(control.getAttribute('aria-checked')).toBe('false');
  });

  it('flips on click, on a click on its label, and on Space', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const control = screen.getByRole('switch', { name: 'Create more' });

    await user.click(control);
    expect(control.getAttribute('aria-checked')).toBe('true');

    await user.click(screen.getByText('Create more'));
    expect(control.getAttribute('aria-checked')).toBe('false');

    control.focus();
    await user.keyboard(' ');
    expect(control.getAttribute('aria-checked')).toBe('true');
  });

  it('stays focusable while unavailable, and does not flip', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch label="Create more" checked={false} onChange={onChange} disabled />);
    const control = screen.getByRole('switch', { name: 'Create more' });

    await user.tab();
    expect(document.activeElement).toBe(control);
    await user.click(control);
    expect(onChange).not.toHaveBeenCalled();
    expect(control.hasAttribute('disabled')).toBe(false);
  });
});
