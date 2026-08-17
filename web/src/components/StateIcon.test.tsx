import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CATEGORY_ORDER, type StateCategory } from '../store';
import { StateIcon, STATE_LABELS } from './StateIcon';

/**
 * Driven from the store's own list of categories rather than a copy of it. A category
 * added on the server reaches this file as a failing test instead of as an issue row with
 * no icon on it.
 */
const CATEGORIES = Object.keys(CATEGORY_ORDER) as StateCategory[];

describe('StateIcon', () => {
  it.each(CATEGORIES)('%s announces itself', (category) => {
    render(<StateIcon category={category} />);
    expect(screen.getByRole('img', { name: STATE_LABELS[category] })).toBeTruthy();
  });

  it('prefers the name the team gave the status over the category', () => {
    render(<StateIcon category="started" label="In Review" />);
    expect(screen.getByRole('img', { name: 'In Review' })).toBeTruthy();
  });

  it('is silent when the status is already written beside it', () => {
    const { container } = render(<StateIcon category="completed" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  /**
   * Backlog and unstarted are both grey by design, so the drawing is the only thing telling
   * them apart. Duplicate is the deliberate exception: it shares canceled's mark and is
   * separated by its name, because it is the same closed work with a different reason.
   */
  it('draws a different shape for every category it distinguishes', () => {
    const shapes = new Map<StateCategory, string>();
    for (const category of CATEGORIES) {
      const { container } = render(<StateIcon category={category} />);
      shapes.set(category, container.querySelector('svg')?.innerHTML ?? '');
    }
    expect(shapes.get('duplicate')).toBe(shapes.get('canceled'));
    const drawn = CATEGORIES.filter((category) => category !== 'duplicate');
    expect(new Set(drawn.map((category) => shapes.get(category))).size).toBe(drawn.length);
  });

  it('grows the started wedge with the progress it is given', () => {
    const { container: none } = render(<StateIcon category="started" progress={0} />);
    const { container: half } = render(<StateIcon category="started" progress={0.5} />);
    const { container: all } = render(<StateIcon category="started" progress={1} />);

    // No wedge at all, a wedge, and a full disc: three shapes, not three shades.
    expect(none.querySelectorAll('circle, path')).toHaveLength(1);
    expect(half.querySelector('path')).not.toBeNull();
    expect(all.querySelectorAll('circle')).toHaveLength(2);
  });

  it('takes the colour the workspace chose for a status when it is given one', () => {
    const { container } = render(<StateIcon category="unstarted" color="#bada55" />);
    expect(container.querySelector('svg')?.style.color).toBe('rgb(186, 218, 85)');
  });
});
