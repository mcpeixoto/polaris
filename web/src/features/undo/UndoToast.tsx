/**
 * The undo toast: the newest undoable action, and the button that takes it back.
 *
 * Mounted **once**, at the top of the shell, and never rendered by the screens that offer
 * undos. That is the only arrangement that works: the toast has to outlive the surface the
 * action was performed on — deleting an issue from its detail view navigates away from it —
 * and a per-screen toast would unmount with the screen, taking the offer with it exactly when
 * it is needed. Mounting a second one throws at startup rather than quietly winning the
 * keyboard shortcut, because the registry refuses a duplicate action id.
 *
 * The stack itself lives in this module rather than in React state for the same reason. The
 * code that offers an undo is a click handler in a list, a registered keymap action, or a
 * mutation wrapper — none of which are inside this component, and none of which should have to
 * reach it through a context that the whole tree then re-renders for. So `offerUndo` is a plain
 * function call, this component subscribes to the result, and `undo.ts` stays a pure module
 * that knows nothing about React, issues or toasts.
 *
 * Two details are load bearing.
 *
 * **It is a live region.** An action confirmed only by something appearing in the corner of the
 * screen is an action confirmed to some people and not to others, and the whole point of this
 * surface is telling somebody that the thing they just did is still reversible. The region
 * itself is always in the document and only its contents change, because a live region that is
 * inserted already populated is frequently not announced at all.
 *
 * **The shortcut goes through the registry.** `mod+z` is registered here as an ordinary action,
 * so it appears in the help overlay and the command menu, and so it is checked for conflicts at
 * startup like every other binding. It deliberately does not fire while a text field has focus —
 * the keymap only forwards a handful of global chords out of one — because inside a description
 * `mod+z` means undo the last thing you typed, and stealing it to resurrect an issue would be
 * astonishing.
 */

import { useEffect, useSyncExternalStore } from 'react';

import { useActions } from '~/app/keymap';
import { Button } from '~/components';
import { report } from '~/features/issue/mutations';
import styles from './UndoToast.module.css';
import { EMPTY_UNDO_STACK, expire, expiresAt, latest, record, take, type UndoStack } from './undo';

let stack: UndoStack = EMPTY_UNDO_STACK;
let sequence = 0;
const listeners = new Set<() => void>();

function publish(next: UndoStack): void {
  // Identity, not equality: `expire` returns the same object when nothing lapsed, and
  // notifying on that would put the host's prune timer into a loop with itself.
  if (next === stack) return;
  stack = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): UndoStack {
  return stack;
}

export interface UndoOffer {
  /** What was done, in the words the toast shows: "Deleted ENG-42". */
  readonly label: string;
  /** Puts it back. Rejections are reported, not shown — the toast has already gone. */
  readonly undo: () => Promise<void>;
  /**
   * Identifies the offer, so re-offering it refreshes the window rather than queueing a
   * second one. Defaults to a fresh id, which is right for anything that is not repeatable.
   */
  readonly id?: string | undefined;
}

/**
 * Offers an action as undoable for the next few seconds.
 *
 * Called *after* the destructive write has been made, not instead of it. An undo toast is not
 * a confirmation dialogue and must not be used as one: the delete happens, the row goes, and
 * this is the way back — which is faster for the ninety-nine cases where the user meant it and
 * no slower for the one where they did not.
 */
export function offerUndo(offer: UndoOffer): void {
  sequence += 1;
  publish(
    record(stack, {
      id: offer.id ?? `undo-${sequence}`,
      label: offer.label,
      undo: offer.undo,
    }),
  );
}

/**
 * Forgets every outstanding offer.
 *
 * For the moments when the closures stop meaning anything rather than merely getting old:
 * signing out, or switching workspace. An undo holding an engine for a workspace this client
 * has closed would send a write into the wrong replica if anybody pressed it.
 */
export function clearUndoOffers(): void {
  publish(EMPTY_UNDO_STACK);
}

/**
 * Runs one undo, at most once.
 *
 * Reads the module's stack rather than a value captured during render, so two clicks landing
 * in the same tick — or a click racing the keyboard shortcut — resolve to one undo. `take`
 * removes the entry in the same operation that returns it, which is what makes that true.
 */
function runUndo(id: string): void {
  const result = take(stack, id);
  publish(result.stack);
  if (result.action !== null) result.action.undo().catch(report);
}

export function UndoToast() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const action = latest(current);

  // Auto-dismissal. One timer for the newest entry rather than one per entry: the toast only
  // ever shows the newest, and everything older than it expires no later than it does.
  useEffect(() => {
    const top = latest(current);
    if (top === null) {
      // Nothing live, but there may still be lapsed entries holding closures. Pruning here
      // rather than on a timer means the last one is released as soon as it stops mattering.
      publish(expire(current));
      return;
    }
    const timer = setTimeout(
      () => publish(expire(snapshot())),
      Math.max(expiresAt(top) - Date.now(), 0),
    );
    return () => clearTimeout(timer);
  }, [current]);

  useActions(
    [
      {
        id: 'undo.last',
        title: 'Undo the last change',
        keys: ['mod+z'],
        group: 'General',
        // Treated as unbound while there is nothing to undo, so the keystroke falls through
        // to whatever else might want it rather than being swallowed by a dead command.
        enabled: () => latest(snapshot()) !== null,
        run: () => {
          const top = latest(snapshot());
          if (top !== null) runUndo(top.id);
        },
      },
    ],
    [],
  );

  return (
    <div className={styles.host} role="status" aria-live="polite">
      {action === null ? null : (
        <div className={styles.toast}>
          <span className={styles.label}>{action.label}</span>
          <Button size="sm" onClick={() => runUndo(action.id)}>
            Undo
          </Button>
        </div>
      )}
    </div>
  );
}
