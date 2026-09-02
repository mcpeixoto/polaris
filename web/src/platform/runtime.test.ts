/**
 * The Windows taskbar overlay is an image, and the count inside it is drawn by this side of
 * the bridge. What it says at 1, at 100 and at 0 is the part that is easy to get wrong and
 * impossible to notice — nobody runs the app on Windows with a hundred unread rows to check.
 */

import { describe, expect, it } from 'vitest';

import { badgeIcon, badgeLabel } from './runtime';

describe('badgeLabel', () => {
  it('shows the count while it fits in the sixteen pixels there are', () => {
    expect(badgeLabel(1)).toBe('1');
    expect(badgeLabel(42)).toBe('42');
    expect(badgeLabel(99)).toBe('99');
  });

  it('stops counting at 99, rather than drawing a smudge', () => {
    expect(badgeLabel(100)).toBe('99+');
    expect(badgeLabel(4210)).toBe('99+');
  });

  it('is empty when there is nothing to say, which is what removes the overlay', () => {
    expect(badgeLabel(0)).toBe('');
    expect(badgeLabel(-3)).toBe('');
  });
});

describe('badgeIcon', () => {
  it('draws nothing for an empty count', () => {
    expect(badgeIcon(0)).toBeNull();
  });

  it('returns null rather than throwing where there is no canvas to draw on', () => {
    // jsdom has no 2d context. The shell treats null as "no overlay", which is the same
    // outcome as a count of zero — and better than an exception inside a React effect.
    expect(badgeIcon(7)).toBeNull();
  });
});
