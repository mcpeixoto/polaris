import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Avatar } from './Avatar';

/**
 * Found by running axe over the component gallery, where the blank-name specimen renders
 * exactly what a workspace member with no display name renders: a `role="img"` whose
 * `aria-label` is whitespace, which is a nameless image — the "?" inside it is
 * `aria-hidden`, so a screen reader has nothing at all to announce.
 */
describe('Avatar with no usable name', () => {
  it('is still announced as somebody', () => {
    render(<Avatar name="  " />);

    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Unnamed person');
  });

  it('keeps the placeholder initial out of the accessibility tree', () => {
    render(<Avatar name="  " />);

    const inner = screen.getByRole('img').firstElementChild;
    expect(inner?.textContent).toBe('?');
    expect(inner?.getAttribute('aria-hidden')).toBe('true');
  });

  it('says a real name as it was given', () => {
    render(<Avatar name="Ada Lovelace" />);

    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Ada Lovelace');
  });
});
