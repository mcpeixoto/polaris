import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FACET, Logo, RAYS, STAR } from './Logo';

/**
 * Three properties, and all three are things the animation could quietly break.
 *
 * The name is one string, not seven letters — the word is drawn as one span per letter so
 * each can carry its own delay, and the whole point of the hidden twin beside it is that a
 * screen reader reads "Polaris" rather than spelling it.
 *
 * The geometry is the fourth, and it is a different kind of property: it is not that the
 * numbers are right — a logo has no right numbers — but that they are the same numbers the
 * tab icon, the desktop icon and the iOS app draw. Five surfaces render this mark and each
 * one holds its own copy of the coordinates, because none of them can read a TSX file at
 * build time. So the copies are checked in and asserted, here and in the iOS suite's
 * MarkGeometryTests: a change to the star that does not update its renderings fails, which
 * is the whole of what stops the product growing a second logo again.
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

  it('draws the mark the other four surfaces are rendering', () => {
    // Change these and you are changing the logo. The list of files that need the same
    // change is in Logo.tsx's header; the iOS half of it is asserted in MarkGeometryTests.
    expect(STAR).toBe(
      'M20 4.5Q23.2 16.8 35.5 20 23.2 23.2 20 35.5 16.8 23.2 4.5 20 16.8 16.8 20 4.5Z',
    );
    expect(FACET).toBe(
      'M20 4.5Q23.2 16.8 20 20 16.8 16.8 20 4.5ZM20 35.5Q23.2 23.2 20 20 16.8 23.2 20 35.5Z',
    );
    expect(RAYS).toEqual([
      [26.01, 13.99, 29.55, 10.45],
      [13.99, 13.99, 10.45, 10.45],
      [13.99, 26.01, 10.45, 29.55],
      [26.01, 26.01, 29.55, 29.55],
    ]);
  });

  it('renders the orbit and the star from those constants and nothing else', () => {
    const { container } = render(<Logo markOnly />);
    const svg = container.querySelector('svg')!;

    // Every filled path in the mark is one of the two constants. A fifth star drawn inline
    // here would be a fifth star in the product.
    const paths = [...svg.querySelectorAll('path')].map((node) => node.getAttribute('d'));
    expect(new Set(paths)).toEqual(new Set([STAR, FACET]));

    // The orbit is the tilted ellipse, not a circle: the tilt is the mark.
    const ring = svg.querySelector('ellipse')!;
    expect(ring.getAttribute('transform')).toBe('rotate(-24 20 20)');
    expect(ring.getAttribute('rx')).toBe('17.5');
    expect(ring.getAttribute('ry')).toBe('6.8');

    // Four rays, in the four diagonal gaps.
    expect(svg.querySelectorAll('line')).toHaveLength(RAYS.length);
  });
});
