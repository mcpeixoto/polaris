/**
 * Escape out of a dialog that holds typing nobody else has a copy of.
 *
 * A create dialog is the only place the words in it exist. Escape is also the fastest key
 * on the keyboard and sits next to the one people reach for when a picker is open, so a
 * dialog that closes on it unconditionally will, sooner or later, throw away a paragraph
 * somebody meant to keep — and there is nothing to undo, because nothing was ever written.
 *
 * The guard is deliberately dumb: it does not decide what "dirty" means, because only the
 * dialog knows which of its fields count as work (a pre-filled team is not typing). It
 * only decides what happens next, and it renders nothing — the caller shows the shared
 * `ConfirmDialog` while `confirming` is true, so the question looks like every other
 * question in the product instead of like a `window.confirm`.
 *
 * Keep is the default answer, and discard is the one the user has to ask for by name. The
 * issue composer answers the same question differently — it offers to save a draft,
 * because it has somewhere to put one — and keeps its own flow; this is for the dialogs
 * that do not.
 */

import { useCallback, useState } from 'react';

export interface DiscardGuard {
  /** Call instead of `onClose`: from Escape, the backdrop, and the Cancel button. */
  readonly requestClose: () => void;
  /** True while the question is on screen. Render `ConfirmDialog` on it. */
  readonly confirming: boolean;
  /** "Keep editing" — dismiss the question and stay. */
  readonly keep: () => void;
  /** "Discard" — dismiss the question and close for real. */
  readonly discard: () => void;
}

export function useDiscardGuard(dirty: boolean, onClose: () => void): DiscardGuard {
  const [confirming, setConfirming] = useState(false);

  const requestClose = useCallback(() => {
    if (!dirty) {
      onClose();
      return;
    }
    setConfirming(true);
  }, [dirty, onClose]);

  const keep = useCallback(() => setConfirming(false), []);

  const discard = useCallback(() => {
    // Lowered before closing, so a dialog kept mounted for its exit animation does not
    // fade out with the confirmation still painted on top of it.
    setConfirming(false);
    onClose();
  }, [onClose]);

  return { requestClose, confirming, keep, discard };
}
