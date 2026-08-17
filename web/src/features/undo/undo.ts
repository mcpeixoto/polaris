/**
 * The undo stack: a short, bounded list of things the user could still take back.
 *
 * It exists for one situation and is sized for it. A person presses delete, and somewhere
 * between half a second and five seconds later they realise it was the wrong row. For that
 * interval there should be one button that puts it back, and after it there should be
 * nothing — because an "Undo" that is still on screen a minute later will eventually be
 * pressed by somebody who has forgotten what it undoes.
 *
 * **This is not a command pattern and must not become one.** There is no redo, no inverse of
 * an inverse, no serialisation, no attempt to model the application's history. An entry is a
 * label and a closure, minted by whoever performed the action, and discarded shortly
 * afterwards. The temptation to generalise should be resisted, because a real undo stack is a
 * promise about *every* state transition in the product and this client cannot make it: writes
 * are optimistic, other people's deltas land between a user's action and their regret, and
 * most of the API's mutations have no inverse it exposes. The narrow promise — a destructive
 * action is recoverable for the seconds in which a mistake is realised — is one the product
 * can keep, and it is worth more than a broken general one.
 *
 * Everything here is pure. The stack is a value, every function returns a new one, and nothing
 * in this file ever calls the undo it is holding — running it is the caller's decision. `take`
 * is what makes that decision happen at most once: an entry leaves the stack in the same
 * operation that hands it out, so a double-pressed button finds nothing the second time.
 */

export interface UndoableAction {
  /** Stable for as long as the entry lives, so a click and a keystroke name the same one. */
  readonly id: string;
  /** What was done, in the words the toast shows: "Deleted ENG-42". */
  readonly label: string;
  /** Puts it back. Rejects like any other mutation; the caller reports the failure. */
  readonly undo: () => Promise<void>;
  /** When it was recorded. Expiry is measured from here and nowhere else. */
  readonly at: number;
}

export interface UndoStack {
  /** Oldest first, so the newest — the one an undo means — is the last. */
  readonly entries: readonly UndoableAction[];
}

/**
 * How long an action stays undoable.
 *
 * Long enough to read a toast and reach for it, short enough that the offer has expired by the
 * time attention has moved on. It is deliberately not configurable per action: an undo whose
 * window varies is one nobody can learn.
 */
export const UNDO_WINDOW_MS = 8000;

/**
 * How many actions the stack holds.
 *
 * Small on purpose. Deeper is not more useful — nothing in the product shows more than the
 * newest entry — and every entry retains a closure over an engine and an issue id, so an
 * unbounded stack is a leak that grows with the length of the session rather than with
 * anything the user did.
 */
export const UNDO_DEPTH = 5;

export const EMPTY_UNDO_STACK: UndoStack = { entries: [] };

/**
 * Records an action as undoable, dropping the oldest if the stack is full.
 *
 * Re-recording an id replaces the entry it names rather than adding a second one, so an action
 * that is offered again — the same row deleted twice, a retry after a failure — refreshes its
 * window instead of leaving a stale duplicate behind it in the stack.
 */
export function record(
  stack: UndoStack,
  action: Omit<UndoableAction, 'at'>,
  now: number = Date.now(),
): UndoStack {
  const entries = [
    ...stack.entries.filter((entry) => entry.id !== action.id),
    { ...action, at: now },
  ];
  return { entries: entries.slice(Math.max(entries.length - UNDO_DEPTH, 0)) };
}

/** When an entry stops being undoable. */
export function expiresAt(action: UndoableAction): number {
  return action.at + UNDO_WINDOW_MS;
}

/** Whether the window is still open. The boundary itself counts as closed. */
export function isLive(action: UndoableAction, now: number = Date.now()): boolean {
  return now < expiresAt(action);
}

/**
 * The action an undo would run, or null when there is nothing to take back.
 *
 * Walks backwards rather than trusting the last entry, so a caller holding a stack it has not
 * pruned still gets a correct answer instead of an expired one.
 */
export function latest(stack: UndoStack, now: number = Date.now()): UndoableAction | null {
  for (let i = stack.entries.length - 1; i >= 0; i--) {
    const entry = stack.entries[i];
    if (entry !== undefined && isLive(entry, now)) return entry;
  }
  return null;
}

export interface TakeResult {
  /** The stack without the entry, whether or not it was still live. */
  readonly stack: UndoStack;
  /** The action to run, or null if it had already been taken or had expired. */
  readonly action: UndoableAction | null;
}

/**
 * Removes an entry and hands it out, at most once.
 *
 * The removal and the handing out are one operation because that is the whole guarantee: a
 * caller that takes, then acts, cannot act twice on the same entry, and two clicks arriving in
 * the same tick resolve to one undo rather than two restores of the same issue.
 *
 * An expired entry is dropped and *not* returned. Letting it run would mean the toast having
 * gone is no longer proof that the offer has lapsed, and the server would refuse the write a
 * moment later anyway.
 */
export function take(stack: UndoStack, id: string, now: number = Date.now()): TakeResult {
  const found = stack.entries.find((entry) => entry.id === id);
  if (found === undefined) return { stack, action: null };
  return {
    stack: { entries: stack.entries.filter((entry) => entry.id !== id) },
    action: isLive(found, now) ? found : null,
  };
}

/**
 * Drops everything whose window has closed.
 *
 * Returns the stack it was given when nothing expired, and that identity matters rather than
 * being an optimisation: the host arms a timer, prunes, and publishes the result, so a prune
 * that always allocated would notify its subscribers forever.
 */
export function expire(stack: UndoStack, now: number = Date.now()): UndoStack {
  const kept = stack.entries.filter((entry) => isLive(entry, now));
  return kept.length === stack.entries.length ? stack : { entries: kept };
}
