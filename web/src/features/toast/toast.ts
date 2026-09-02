/**
 * The notification stack: what the product says when something happened that the screen the
 * user is looking at cannot say for itself.
 *
 * It exists because of one number. Seventy-seven call sites in this client end in
 * `.catch(report)`, and `report` wrote to the console — so a write the server refused left
 * the optimistic value on screen and told the user nothing whatsoever. A local-first client
 * that silently discards refusals is not offering optimism, it is offering a guess.
 *
 * **This is not the undo toast, and the two must not be merged.** `features/undo` models a
 * short deadline attached to one reversible action: exactly one offer is visible, a second
 * one replaces the first, and the whole thing expires. This models a queue of things that
 * have already happened and cannot be taken back, where the second one must *not* evict the
 * first — two mutations failing in the same batch are two facts, and showing one of them is
 * how a user concludes the other succeeded. Same corner of the screen, different promises.
 *
 * Everything here is pure. The stack is a value, every function returns a new one, and
 * nothing in this file talks to React, renders, or knows a toast is a rectangle. `ToastHost`
 * subscribes; `showToast` is a plain function call, because the code that reports a failure
 * is a click handler, a registered action or a mutation wrapper, none of which are inside a
 * component and none of which should have to reach one through a context.
 */

export type ToastTone = 'error' | 'info';

export interface Toast {
  /** Stable for as long as the entry lives, so a click and a timer name the same one. */
  readonly id: string;
  /** The headline, in the user's words: "Couldn't update issue". One line. */
  readonly title: string;
  /** The detail beneath it — usually a server message. Optional, and never the only text. */
  readonly description?: string | undefined;
  readonly tone: ToastTone;
  /**
   * Offered as a button when the caller knows how to try again. Absent means there is
   * nothing useful to press, which is honest and better than a dead "Retry".
   */
  readonly retry?: (() => void) | undefined;
  /** When it was raised. Expiry is measured from here and nowhere else. */
  readonly at: number;
}

/**
 * How long a toast stays up.
 *
 * Errors get longer than confirmations because they are read rather than glanced at, and
 * because the person reading one is deciding whether to act. Neither is configurable per
 * call: a dismissal window that varies is one nobody can learn.
 */
export const TOAST_TTL_MS: Readonly<Record<ToastTone, number>> = {
  error: 8000,
  info: 5000,
};

/**
 * How many are shown at once.
 *
 * Three, and the oldest is dropped rather than queued. A stack tall enough to cover the
 * content it is describing has stopped being a notification and become a modal nobody
 * agreed to, and a queue that drains one at a time makes the last message arrive long after
 * the action that caused it.
 */
export const TOAST_DEPTH = 3;

export interface ToastStack {
  /** Oldest first, which is the order they are rendered in — newest nearest the corner. */
  readonly entries: readonly Toast[];
}

export const EMPTY_TOAST_STACK: ToastStack = { entries: [] };

/** Adds a toast, dropping the oldest when the stack is full. */
export function push(stack: ToastStack, toast: Omit<Toast, 'at'>, now: number): ToastStack {
  const entries = [
    ...stack.entries.filter((entry) => entry.id !== toast.id),
    { ...toast, at: now },
  ];
  return { entries: entries.slice(Math.max(entries.length - TOAST_DEPTH, 0)) };
}

/** Removes one. Returns the same stack when it was not there, so a double click is one. */
export function dismiss(stack: ToastStack, id: string): ToastStack {
  const kept = stack.entries.filter((entry) => entry.id !== id);
  return kept.length === stack.entries.length ? stack : { entries: kept };
}

/** When a toast stops being shown. */
export function expiresAt(toast: Toast): number {
  return toast.at + TOAST_TTL_MS[toast.tone];
}

/** The soonest deadline in the stack, or null when nothing is live. */
export function nextDeadline(stack: ToastStack): number | null {
  let soonest: number | null = null;
  for (const entry of stack.entries) {
    const at = expiresAt(entry);
    if (soonest === null || at < soonest) soonest = at;
  }
  return soonest;
}

/**
 * Drops everything whose window has closed.
 *
 * Returns the stack it was given when nothing expired, and that identity matters rather than
 * being an optimisation: the host arms a timer, prunes, and publishes the result, so a prune
 * that always allocated would notify its subscribers forever.
 */
export function expire(stack: ToastStack, now: number): ToastStack {
  const kept = stack.entries.filter((entry) => now < expiresAt(entry));
  return kept.length === stack.entries.length ? stack : { entries: kept };
}

/**
 * Pushes every deadline forward by `elapsed`, which is how hovering pauses the stack.
 *
 * Moving `at` rather than holding a separate "paused since" is what keeps this file pure and
 * the host's timer arithmetic a single subtraction. A toast the pointer rested on for four
 * seconds gets its full window back from the moment the pointer leaves, which is the whole
 * point: the user was reading it.
 */
export function extend(stack: ToastStack, elapsed: number): ToastStack {
  if (elapsed <= 0 || stack.entries.length === 0) return stack;
  return { entries: stack.entries.map((entry) => ({ ...entry, at: entry.at + elapsed })) };
}
