/**
 * Moving a heading, as arithmetic.
 *
 * The interesting cases are the ones where a move means nothing — a drop on itself, a key
 * the list does not hold, the top heading pressed upwards — because each of those has to
 * come back as the *same array*, not an equal one. `IssueList` compares by identity to
 * decide whether to write a URL and a stored preference, so an equal-but-new array there is
 * a navigation, a server round trip and a re-render for a gesture that changed nothing.
 */

import { describe, expect, it } from 'vitest';

import { canReorderGroups, reorderGroupKeys, shiftGroupKey } from './groupOrder';

const KEYS = ['a', 'b', 'c', 'd'];

describe('reorderGroupKeys', () => {
  it('takes the target place when dragged upwards, pushing the target down', () => {
    expect(reorderGroupKeys(KEYS, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('lands after the target when dragged downwards', () => {
    expect(reorderGroupKeys(KEYS, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves to the very top and the very bottom', () => {
    expect(reorderGroupKeys(KEYS, 'c', 'a')).toEqual(['c', 'a', 'b', 'd']);
    expect(reorderGroupKeys(KEYS, 'a', 'd')).toEqual(['b', 'c', 'd', 'a']);
  });

  it('returns the same array for a drop on itself', () => {
    expect(reorderGroupKeys(KEYS, 'b', 'b')).toBe(KEYS);
  });

  it('returns the same array when either key is not in the list', () => {
    expect(reorderGroupKeys(KEYS, 'z', 'b')).toBe(KEYS);
    expect(reorderGroupKeys(KEYS, 'b', 'z')).toBe(KEYS);
  });

  it('does not mutate what it was given', () => {
    const before = [...KEYS];
    reorderGroupKeys(KEYS, 'd', 'a');
    expect(KEYS).toEqual(before);
  });
});

describe('shiftGroupKey', () => {
  it('moves one place in either direction', () => {
    expect(shiftGroupKey(KEYS, 'c', -1)).toEqual(['a', 'c', 'b', 'd']);
    expect(shiftGroupKey(KEYS, 'b', 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('clamps rather than wrapping, so the ends are ends', () => {
    expect(shiftGroupKey(KEYS, 'a', -1)).toBe(KEYS);
    expect(shiftGroupKey(KEYS, 'd', 1)).toBe(KEYS);
  });

  it('returns the same array for a key it does not hold', () => {
    expect(shiftGroupKey(KEYS, 'z', 1)).toBe(KEYS);
  });
});

describe('canReorderGroups', () => {
  it('needs a grouping to arrange', () => {
    expect(canReorderGroups('none', 'none')).toBe(false);
    expect(canReorderGroups('state', 'none')).toBe(true);
  });

  it('refuses under swimlanes, where a key names two dimensions at once', () => {
    expect(canReorderGroups('state', 'assignee')).toBe(false);
  });
});
