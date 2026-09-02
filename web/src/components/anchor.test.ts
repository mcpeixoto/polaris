import { describe, expect, it } from 'vitest';

import { horizontalShift, verticalShift, VIEWPORT_MARGIN_PX } from './anchor';

/**
 * The arithmetic that keeps a floating surface on screen. It is worth testing directly
 * rather than only through Menu, because the interesting cases — a box wider than the
 * window, a box clipped on both edges — are ones a component test cannot construct without
 * stubbing every rect in sight.
 */

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('horizontalShift', () => {
  it('leaves a surface that already fits alone', () => {
    expect(horizontalShift(rect(100, 0, 200, 50))).toBe(0);
  });

  it('pulls a surface back from the right edge, margin included', () => {
    // 200 wide, starting 100px before the edge: it overhangs by 100 and owes the margin too.
    const shift = horizontalShift(rect(window.innerWidth - 100, 0, 200, 50));
    expect(shift).toBe(-(100 + VIEWPORT_MARGIN_PX));
  });

  it('pushes a surface off the left edge back on', () => {
    expect(horizontalShift(rect(-20, 0, 200, 50))).toBe(VIEWPORT_MARGIN_PX + 20);
  });

  it('keeps the leading edge when the surface is wider than the window', () => {
    // Clipped on both sides. The left margin wins, because a surface is read from the edge
    // it starts at — rescuing the right edge would push the beginning off screen.
    const wide = rect(-50, 0, window.innerWidth + 400, 50);
    expect(horizontalShift(wide)).toBe(VIEWPORT_MARGIN_PX + 50);
  });
});

describe('verticalShift', () => {
  it('leaves a surface that already fits alone', () => {
    expect(verticalShift(rect(0, 100, 200, 50))).toBe(0);
  });

  it('lifts a surface off the bottom edge', () => {
    const shift = verticalShift(rect(0, window.innerHeight - 20, 200, 50));
    expect(shift).toBe(-(30 + VIEWPORT_MARGIN_PX));
  });

  it('drops a surface off the top edge back down', () => {
    expect(verticalShift(rect(0, -10, 200, 50))).toBe(VIEWPORT_MARGIN_PX + 10);
  });
});
