import { describe, expect, it } from 'vitest';

import {
  dismiss,
  EMPTY_TOAST_STACK,
  expire,
  expiresAt,
  extend,
  nextDeadline,
  push,
  TOAST_DEPTH,
  TOAST_TTL_MS,
  type Toast,
} from './toast';

/**
 * The stack is a value, so these tests are arithmetic rather than rendering. What they hold
 * it to is the one promise that separates it from the undo stack: a second message does not
 * evict the first, because two failures in the same batch are two facts.
 */

function entry(id: string, tone: Toast['tone'] = 'info'): Omit<Toast, 'at'> {
  return { id, title: id, tone };
}

describe('toast stack', () => {
  it('keeps earlier messages when a new one arrives', () => {
    const one = push(EMPTY_TOAST_STACK, entry('a'), 0);
    const two = push(one, entry('b'), 0);

    expect(two.entries.map((toast) => toast.id)).toEqual(['a', 'b']);
  });

  it('drops the oldest rather than growing past the depth', () => {
    let stack = EMPTY_TOAST_STACK;
    for (let i = 0; i <= TOAST_DEPTH; i++) stack = push(stack, entry(`t${i}`), 0);

    expect(stack.entries).toHaveLength(TOAST_DEPTH);
    expect(stack.entries[0]?.id).toBe('t1');
  });

  it('refreshes a message re-raised under the same id instead of stacking a copy', () => {
    const first = push(EMPTY_TOAST_STACK, entry('save-failed'), 0);
    const again = push(first, entry('save-failed'), 500);

    expect(again.entries).toHaveLength(1);
    expect(again.entries[0]?.at).toBe(500);
  });

  it('gives an error a longer window than a confirmation', () => {
    const errors = push(EMPTY_TOAST_STACK, entry('e', 'error'), 0);
    const infos = push(EMPTY_TOAST_STACK, entry('i', 'info'), 0);

    expect(expiresAt(errors.entries[0] as Toast)).toBeGreaterThan(
      expiresAt(infos.entries[0] as Toast),
    );
  });

  it('expires on the deadline and returns the same stack when nothing lapsed', () => {
    const stack = push(EMPTY_TOAST_STACK, entry('a'), 0);
    const deadline = TOAST_TTL_MS.info;

    expect(expire(stack, deadline - 1)).toBe(stack);
    expect(expire(stack, deadline).entries).toHaveLength(0);
  });

  it('reports the soonest deadline, so one timer covers the stack', () => {
    const stack = push(push(EMPTY_TOAST_STACK, entry('a'), 0), entry('b'), 1000);

    expect(nextDeadline(stack)).toBe(TOAST_TTL_MS.info);
    expect(nextDeadline(EMPTY_TOAST_STACK)).toBeNull();
  });

  it('hands back the time a paused stack spent being read', () => {
    const stack = push(EMPTY_TOAST_STACK, entry('a'), 0);
    const resumed = extend(stack, 4000);

    expect(expiresAt(resumed.entries[0] as Toast)).toBe(TOAST_TTL_MS.info + 4000);
    // Identity, because the host publishes the result and a prune that always allocated
    // would notify its subscribers forever.
    expect(extend(stack, 0)).toBe(stack);
  });

  it('is idempotent on dismissal, so a double click is one dismissal', () => {
    const stack = push(EMPTY_TOAST_STACK, entry('a'), 0);
    const gone = dismiss(stack, 'a');

    expect(gone.entries).toHaveLength(0);
    expect(dismiss(gone, 'a')).toBe(gone);
  });
});
