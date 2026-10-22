import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IconButton } from './IconButton';

const GLYPH = (
  <svg viewBox="0 0 16 16" fill="none">
    <path d="M4 8h8" stroke="currentColor" />
  </svg>
);

/**
 * The tooltip is drawn, not announced. So the chord an IconButton already knows about has
 * to reach the accessibility tree separately, or a screen-reader user is the only person
 * in the product who cannot find out that the control has a key.
 */
describe('IconButton aria-keyshortcuts', () => {
  it('announces the chord in ARIA spelling', () => {
    render(<IconButton aria-label="Open command menu" icon={GLYPH} keys="ctrl+shift+k" />);

    const button = screen.getByRole('button', { name: 'Open command menu' });
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+K');
  });

  it('carries no attribute at all when there is no chord', () => {
    render(<IconButton aria-label="Archive" icon={GLYPH} />);

    // Absent, not empty: an empty value is a parse error for anything reading it.
    expect(screen.getByRole('button', { name: 'Archive' }).hasAttribute('aria-keyshortcuts')).toBe(
      false,
    );
  });

  it('carries no attribute for a sequence, which the attribute cannot express', () => {
    render(<IconButton aria-label="Go to inbox" icon={GLYPH} keys="g i" />);

    expect(
      screen.getByRole('button', { name: 'Go to inbox' }).hasAttribute('aria-keyshortcuts'),
    ).toBe(false);
  });
});
