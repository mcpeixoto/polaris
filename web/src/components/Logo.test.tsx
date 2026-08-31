import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Logo } from './Logo';

/**
 * Three properties, and all three are things the animation could quietly break.
 *
 * The name is one string, not seven letters — the word is drawn as one span per letter so
 * each can carry its own delay, and the whole point of the hidden twin beside it is that a
 * screen reader reads "Polaris" rather than spelling it.
 *
 * The paint ids are unique per instance. Every page that uses this component uses it
 * twice, in the header and the footer, and a duplicated SVG id is not an error anywhere:
 * `url(#…)` silently resolves to whichever element came first, so the bug is a footer that
 * looks right until the header changes.
 */
describe('Logo', () => {
  it('reads as one word, not as seven letters', () => {
    render(<Logo />);
    expect(screen.getByText('Polaris')).toBeTruthy();
    // The drawn letters are hidden from assistive technology, so the name above is the
    // only "Polaris" in the tree.
    expect(screen.queryAllByText('Polaris')).toHaveLength(1);
  });

  it('drops the word entirely when asked for the mark alone', () => {
    const { container } = render(<Logo markOnly />);
    expect(screen.queryByText('Polaris')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('gives every instance its own paint, so two lockups cannot share one', () => {
    const { container } = render(
      <>
        <Logo />
        <Logo size="lg" />
      </>,
    );

    const ids = [...container.querySelectorAll('linearGradient, clipPath')].map((node) => node.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);

    // Every reference resolves, and resolves inside its own svg rather than to the first
    // matching id in the document.
    for (const svg of container.querySelectorAll('svg')) {
      const local = new Set([...svg.querySelectorAll('linearGradient, clipPath')].map((n) => n.id));
      for (const node of svg.querySelectorAll('[fill^="url("], [clip-path^="url("]')) {
        const reference = node.getAttribute('fill') ?? node.getAttribute('clip-path') ?? '';
        expect(local.has(reference.slice(5, -1))).toBe(true);
      }
    }
  });
});
