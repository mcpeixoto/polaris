/**
 * The submit half of a create dialog: one create in the air at a time, and one place the
 * refusal is written down.
 *
 * Every create dialog in the product had grown the same three lines — a `saving` flag, a
 * `setSaveError(e instanceof ApiError ? e.message : '…')` catch, and a ref for the ⌘⏎
 * action to call — and each copy was subtly its own. Only the issue composer had the part
 * that actually matters: the guard against a second submit.
 *
 * `saving` is state, and state is a frame late. A submit handler runs synchronously up to
 * its first `await`, so a second ⌘⏎ — or a click on "Create" in the same tick — finds
 * `saving` still false, passes the guard and files a second entity with a second id. With
 * optimistic writes both of them land in the list, and the user has two projects called
 * the same thing and no idea why. So the guard reads `inFlight`, a ref written in the same
 * statement as `setSaving(true)`: the window in which a create is refused is exactly the
 * window in which a create is in flight.
 *
 * `submit` returns whether it ran, so a caller that has its own work to undo on refusal
 * (clearing a local draft slot, say) can tell "refused as a duplicate" from "attempted".
 */

import { useCallback, useRef, useState } from 'react';

import { ApiError } from '~/sync/api';

export interface DialogSubmit {
  /** True from the moment a create is accepted until it settles. Drives the button. */
  readonly saving: boolean;
  /** The refusal, ready to render. Null while nothing has been refused. */
  readonly error: string | null;
  /** For the validation a dialog does before it calls `submit` — an empty name, say. */
  readonly setError: (message: string | null) => void;
  /**
   * Runs `fn` unless a create is already in the air, in which case nothing happens and it
   * answers false. `saving` is cleared and the message written on a throw; on success it
   * is left set, because the dialog closes and a button that stops spinning first only
   * flickers.
   */
  readonly submit: (fn: () => Promise<void>) => Promise<boolean>;
  /**
   * A stable callback for `useActions` to bind ⌘⏎ to. Assign the current submit path to
   * `submitRef.current` on each render; the action reads it at dispatch.
   */
  readonly submitRef: { current: () => void };
  /**
   * Drops the spinner without closing anything.
   *
   * `submit` deliberately leaves `saving` set on success, because the ordinary ending is
   * that the dialog closes and a button that returns to its resting label for one frame
   * first reads as a failure. A "create more" run has no such ending: it files, stays open
   * and takes the next one, so the button has to come back — otherwise the second create is
   * refused by a control that is still spinning over work that finished.
   */
  readonly reset: () => void;
}

/**
 * @param fallback What to say when the failure is not an `ApiError` and has no message of
 * its own worth showing — "The project could not be created."
 */
export function useDialogSubmit(fallback: string): DialogSubmit {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const submitRef = useRef<() => void>(() => {});

  const submit = useCallback(
    async (fn: () => Promise<void>): Promise<boolean> => {
      if (inFlight.current) return false;
      // Written together, on purpose: the ref is what the guard above reads, and the state
      // is what the button reads. Splitting them reopens the two-⌘⏎ window.
      inFlight.current = true;
      setSaving(true);
      setError(null);
      try {
        await fn();
        // `saving` stays true: the caller closes the dialog on the next line, and dropping
        // the button back to its resting label for one frame first reads as a failure.
        inFlight.current = false;
        return true;
      } catch (failure) {
        inFlight.current = false;
        setSaving(false);
        setError(failure instanceof ApiError ? failure.message : fallback);
        return true;
      }
    },
    [fallback],
  );

  const reset = useCallback(() => setSaving(false), []);

  return { saving, error, setError, submit, reset, submitRef };
}
