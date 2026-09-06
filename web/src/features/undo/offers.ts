/**
 * The undo stack's one live copy, and the subscription over it.
 *
 * Split out of `UndoToast` so that a second surface can ask "is an undo on offer right now?"
 * without importing the component — and one does: the toast stack shares the bottom-left
 * corner with the undo toast, and moves up out of its way while one is showing. Holding the
 * stack here rather than in the component keeps that a read of a value, not a dependency on
 * a React tree, and keeps `ToastHost` → `UndoToast` → `mutations` → `ToastHost` from closing
 * into a cycle.
 *
 * `undo.ts` stays pure; this file is only the module-level cell it is applied to.
 */

import { EMPTY_UNDO_STACK, latest, type UndoStack } from './undo';

let stack: UndoStack = EMPTY_UNDO_STACK;
const listeners = new Set<() => void>();

export function publish(next: UndoStack): void {
  // Identity, not equality: `expire` returns the same object when nothing lapsed, and
  // notifying on that would put the host's prune timer into a loop with itself.
  if (next === stack) return;
  stack = next;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function snapshot(): UndoStack {
  return stack;
}

/** Whether the undo toast is on screen — the only thing the toast stack needs to know. */
export function hasOffer(): boolean {
  return latest(stack) !== null;
}
