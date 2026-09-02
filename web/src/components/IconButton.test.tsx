import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from './IconButton';

const GLYPH = (
  <svg viewBox="0 0 16 16" fill="none">
    <path d="M4 8h8" stroke="currentColor" />
  </svg>
);

/**
 * The one control that most needs explaining is a greyed-out one, and it used to be the only
 * control that explained nothing: a `disabled` button fires neither `mouseenter` nor `focus`,
 * so the tooltip hung off an element that could never deliver it.
 */
describe('IconButton when unavailable', () => {
  it('stays focusable and still says why', async () => {
    const user = userEvent.setup();
    render(
      <IconButton
        aria-label="Archive"
        tooltip="Only the issue's team can archive it"
        icon={GLYPH}
        disabled
      />,
    );

    const button = screen.getByRole('button', { name: 'Archive' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);

    await user.tab();
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole('tooltip').textContent).toBe("Only the issue's team can archive it");
  });

  it('does not run its command', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton aria-label="Archive" icon={GLYPH} disabled onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: 'Archive' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('runs it when it is available', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton aria-label="Archive" icon={GLYPH} onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: 'Archive' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
