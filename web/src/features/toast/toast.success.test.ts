import { describe, expect, it } from 'vitest';

import { EMPTY_TOAST_STACK, expiresAt, push, TOAST_TTL_MS, type Toast } from './toast';

/**
 * The confirmation tone.
 *
 * It exists because the stack had `error` and `info` and no way to say a write landed, so the
 * product reported every refusal and confirmed nothing. The two things asserted here are the
 * two that could quietly go wrong: that a confirmation is glanced at rather than read, and
 * that raising one does not evict a failure — which is the promise in this module's own
 * docstring, and the reason a success and an error are not the same mechanism as an undo
 * offer.
 */

function entry(id: string, tone: Toast['tone']): Omit<Toast, 'at'> {
  return { id, title: id, tone };
}

describe('the success tone', () => {
  it('is glanced at rather than read, like any other confirmation', () => {
    expect(TOAST_TTL_MS.success).toBe(TOAST_TTL_MS.info);
    expect(TOAST_TTL_MS.success).toBeLessThan(TOAST_TTL_MS.error);

    const stack = push(EMPTY_TOAST_STACK, entry('done', 'success'), 1_000);

    expect(expiresAt(stack.entries[0]!)).toBe(1_000 + TOAST_TTL_MS.success);
  });

  it('does not evict a failure it arrives beside', () => {
    const failed = push(EMPTY_TOAST_STACK, entry('refused', 'error'), 0);
    const both = push(failed, entry('saved', 'success'), 0);

    expect(both.entries.map((toast) => toast.id)).toEqual(['refused', 'saved']);
  });
});
