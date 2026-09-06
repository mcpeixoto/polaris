import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton, SkeletonRows } from './Skeleton';

describe('Skeleton', () => {
  it('is decoration: it takes no place in the accessibility tree', () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    expect(container.querySelector('[role]')).toBeNull();
  });

  it('passes width and height through as given', () => {
    const { container } = render(<Skeleton width="40%" height="var(--space-4)" />);
    const block = container.firstElementChild as HTMLElement;
    expect(block.style.width).toBe('40%');
    expect(block.style.height).toBe('var(--space-4)');
  });
});

describe('SkeletonRows', () => {
  it('draws the number of rows asked for, and six otherwise', () => {
    const { container } = render(<SkeletonRows count={3} />);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);

    const { container: fallback } = render(<SkeletonRows />);
    expect(fallback.querySelectorAll('[aria-hidden="true"]')).toHaveLength(6);
  });

  it('announces nothing — the screen around it owns that', () => {
    const { container } = render(<SkeletonRows count={4} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[aria-busy]')).toBeNull();
  });
});
