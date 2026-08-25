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
 *
 * **It leaves the way it arrived.** This was the last surface in the product with an entrance
 * and no exit, and it is the surface where that asymmetry read worst: the toast is a deadline,
 * and a deadline that expires by the offer blinking out of existence gives the user no way to
 * tell "you ran out of time" from "the app dropped something". The fall says which. Presence
 * comes from usePresence like everywhere else, which means the leaving node is `inert` and
 * unclickable for the fifty milliseconds it is still on screen — a toast whose button could
 * still be hit on its way out would undo something the user had already stopped being offered.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useActions } from '~/app/keymap';
import { Button } from '~/components';
import { report } from '~/features/issue/mutations';
import { usePresence } from '~/hooks/usePresence';
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
  const toastRef = useRef<HTMLDivElement>(null);
  const { present, exitProps } = usePresence(action !== null, toastRef);

  /**
   * The offer the toast is currently showing, which is not always the offer that exists.
   *
   * For the length of the exit there is no offer at all — the window lapsed, or the undo was
   * taken, and that is precisely what set the toast leaving. Rendering from `action` would
   * therefore blank the label and the button on the frame the fall begins, so what falls is an
   * empty rounded rectangle rather than the sentence the user was deciding about. Holding the
   * last one is the difference between a toast leaving and a toast being deleted.
   *
   * `latest` returns the entry itself out of a stack that only changes by being replaced, so
   * comparing by identity settles after one extra render instead of proposing a new value on
   * every pass. This is the same render-phase update usePresence makes, for the same reason.
   */
  const [shown, setShown] = useState(action);
  if (action !== null && action !== shown) setShown(action);

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
      {!present || shown === null ? null : (
        // Keyed by the offer, so that one offer replacing another re-enters instead of
        // rewriting the label under the user's eyes. Deleting a second issue while the first
        // toast is still up used to swap "Deleted ENG-42" for "Deleted ENG-43" in place, with
        // nothing to say that the button underneath now took back a different thing — the
        // most consequential silent text change in the product. A fresh node replays `rise`,
        // which is the smallest honest way to say this is a new offer.
        <div key={shown.id} ref={toastRef} className={styles.toast} {...exitProps}>
          <span className={styles.label}>{shown.label}</span>
          <Button size="sm" onClick={() => runUndo(shown.id)}>
            Undo
          </Button>
        </div>
      )}
    </div>
  );
}
