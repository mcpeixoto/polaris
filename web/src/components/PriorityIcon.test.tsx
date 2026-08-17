import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PriorityIcon, PRIORITY_LEVELS, priorityLabel } from './PriorityIcon';

const NAMES: readonly [number, string][] = [
  [0, 'No priority'],
  [1, 'Urgent'],
  [2, 'High'],
  [3, 'Medium'],
  [4, 'Low'],
];

describe('PriorityIcon', () => {
  it.each(NAMES)('level %i announces itself as %s', (priority, name) => {
    render(<PriorityIcon priority={priority} />);
    expect(screen.getByRole('img', { name })).toBeTruthy();
  });

  it('is silent when the priority is already written beside it', () => {
    const { container } = render(<PriorityIcon priority={1} decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  /**
   * The one that matters. A backlog is scanned, not read, and often by someone who cannot
   * separate the orange from the red — so if two levels ever draw the same marks, the
   * icon has quietly become a colour swatch and this test is what says so.
   */
  it('draws a different shape for every level', () => {
    const shapes = PRIORITY_LEVELS.map((priority) => {
      const { container } = render(<PriorityIcon priority={priority} />);
      return container.querySelector('svg')?.innerHTML ?? '';
    });
    expect(new Set(shapes).size).toBe(PRIORITY_LEVELS.length);
  });

  it('falls back to no priority for a value outside the scale', () => {
    expect(priorityLabel(9)).toBe('No priority');
    render(<PriorityIcon priority={9} />);
    expect(screen.getByRole('img', { name: 'No priority' })).toBeTruthy();
  });
});
