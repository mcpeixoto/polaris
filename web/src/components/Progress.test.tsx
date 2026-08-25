import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Progress } from './Progress';

describe('Progress', () => {
  // "62%" read on its own tells a screen-reader user nothing about what is 62% done.
  it('is named by what it measures', () => {
    render(<Progress percent={62} label="Sub-issues" />);
    expect(screen.getByRole('img', { name: 'Sub-issues: 62%' })).toBeTruthy();
  });

  // 2 of 3 and 200 of 300 are the same percentage and not equally interesting.
  it('prefers the counts to the percentage when it has them', () => {
    render(<Progress percent={60} label="Sub-issues" detail="3 of 5" />);
    expect(screen.getByRole('img', { name: 'Sub-issues: 3 of 5' })).toBeTruthy();
  });

  // A progressbar announces an operation in flight, and screen readers treat it as
  // something to watch. This is a standing fact about an issue, no more live than its
  // priority — a list of fifty parents must not sound like fifty downloads.
  it('is an image, not a progressbar', () => {
    render(<Progress percent={50} label="Sub-issues" />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  // A rollup should not throw, whatever arithmetic produced it.
  it('clamps rather than rejecting a value outside the range', () => {
    const { rerender } = render(<Progress percent={-10} label="Sub-issues" />);
    expect(screen.getByRole('img', { name: 'Sub-issues: 0%' })).toBeTruthy();
    rerender(<Progress percent={140} label="Sub-issues" />);
    expect(screen.getByRole('img', { name: 'Sub-issues: 100%' })).toBeTruthy();
    rerender(<Progress percent={Number.NaN} label="Sub-issues" />);
    expect(screen.getByRole('img')).toBeTruthy();
  });

  it('fills the ring in proportion, starting at twelve o clock', () => {
    const { container } = render(<Progress percent={25} label="Sub-issues" />);
    const fill = container.querySelector('circle:nth-of-type(2)');
    const circumference = 2 * Math.PI * 7;
    // One dash as long as the whole ring, wound back by the part that is not done: at 25%
    // three quarters of the circumference is still offset. The proportion is the same claim
    // as before, made in the one property that can be animated without the arc's two ends
    // interpolating separately.
    expect(fill?.getAttribute('stroke-dasharray')).toBe(`${circumference}`);
    expect(fill?.getAttribute('stroke-dashoffset')).toBe(`${circumference - circumference / 4}`);
    // Without the rotation the ring fills from three o'clock, which reads as an arbitrary
    // rotation rather than as progress.
    expect(fill?.getAttribute('transform')).toBe('rotate(-90 9 9)');
  });
});
