/**
 * The one branch every surface used to carry its own copy of, pinned once.
 *
 * Three kinds of stored value, three drawings: a token is a line glyph, anything else typed
 * is text, and nothing — or a token this build does not know — is the caller's fallback.
 * The colour is inline because it is workspace data; a theme must not be able to restyle it.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EntityIcon } from './EntityIcon';

const fallback = <span data-testid="fallback">generic</span>;

describe('EntityIcon', () => {
  it('draws an icon token as its line glyph', () => {
    const { container } = render(<EntityIcon icon="icon:rocket" color="" fallback={fallback} />);

    const mark = container.querySelector('[data-icon="rocket"]');
    expect(mark).not.toBeNull();
    expect(mark?.querySelector('svg')).not.toBeNull();
    expect(screen.queryByTestId('fallback')).toBeNull();
  });

  it('draws an emoji as the text it is', () => {
    const { container } = render(<EntityIcon icon="🚀" color="" fallback={fallback} />);

    expect(container.textContent).toBe('🚀');
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByTestId('fallback')).toBeNull();
  });

  it('draws the fallback when there is no icon', () => {
    const { rerender } = render(<EntityIcon icon="" color="#3b82f6" fallback={fallback} />);
    expect(screen.getByTestId('fallback')).toBeTruthy();

    rerender(<EntityIcon icon={undefined} color="#3b82f6" fallback={fallback} />);
    expect(screen.getByTestId('fallback')).toBeTruthy();
  });

  it('draws the fallback for a token this build has no glyph for', () => {
    const { container } = render(
      <EntityIcon icon="icon:no-such-glyph" color="" fallback={fallback} />,
    );

    expect(screen.getByTestId('fallback')).toBeTruthy();
    // Never the raw token in a table cell.
    expect(container.textContent).not.toContain('icon:');
  });

  it('tints the glyph with the stored colour, inline', () => {
    const { container } = render(
      <EntityIcon icon="icon:rocket" color="#3b82f6" fallback={fallback} />,
    );

    const mark = container.querySelector<HTMLElement>('[data-icon="rocket"]');
    expect(mark?.style.color).toBe('rgb(59, 130, 246)');
  });

  it('tints text the same way, and leaves it untinted without a colour', () => {
    const { container, rerender } = render(
      <EntityIcon icon="🚀" color="#16a34a" fallback={fallback} />,
    );
    expect(container.querySelector<HTMLElement>('span')?.style.color).toBe('rgb(22, 163, 74)');

    rerender(<EntityIcon icon="🚀" color="" fallback={fallback} />);
    expect(container.querySelector<HTMLElement>('span')?.style.color).toBe('');
  });
});
