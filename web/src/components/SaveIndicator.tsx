import { useCallback, useEffect, useRef, useState } from 'react';

import styles from './SaveIndicator.module.css';

/** Where a save currently is. `failed` carries its message on the state, not here. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export interface SaveIndicatorProps {
  state: SaveState;
  /** Overrides the default "Saving…" / "Saved" wording where the subject deserves naming. */
  savingLabel?: string | undefined;
  savedLabel?: string | undefined;
  className?: string | undefined;
}

/**
 * The line that says a settings write happened.
 *
 * Every write in the settings area used to be fire-and-forget with a failure-only banner:
 * a blur-save workspace name, a status recolour and a role change all looked exactly like
 * doing nothing. A form the user cannot tell they have submitted gets submitted again.
 *
 * It is `role="status"`, not `role="alert"` — a confirmation is polite by definition, and
 * an assertive announcement on every keystroke-adjacent save would talk over the field the
 * user is still in. The failure case renders nothing here: a failure belongs beside the
 * control that failed, with the reason, which is what `SettingsSection`'s `error` slot is
 * for. This element only ever carries good news, and its absence is not a claim.
 */
export function SaveIndicator({
  state,
  savingLabel = 'Saving…',
  savedLabel = 'Saved',
  className,
}: SaveIndicatorProps) {
  const text = state === 'saving' ? savingLabel : state === 'saved' ? savedLabel : '';

  return (
    <span
      className={[styles.root, state === 'saved' ? styles.fading : null, className]
        .filter(Boolean)
        .join(' ')}
      role="status"
      aria-live="polite"
    >
      {text}
    </span>
  );
}

export interface SaveStateHandle {
  state: SaveState;
  /** The refusal, for a `SettingsSection`'s `error` slot. `undefined` while things are fine. */
  error: string | undefined;
  /**
   * Runs the write and reports it: `saving` while in flight, `saved` (which fades after a
   * couple of seconds) on success, `failed` plus a message on a refusal. Resolves to true
   * when the write landed, so a caller can revert an optimistic patch on false.
   */
  run: (write: () => Promise<unknown>) => Promise<boolean>;
  /** Drops a failure — for a field that has just been edited again. */
  clear: () => void;
}

/** How long "Saved" stays on screen before it fades. Long enough to be read, once. */
const SAVED_MS = 2000;

/**
 * The state machine behind `SaveIndicator`, so every settings screen reports a save the
 * same way instead of each inventing a banner.
 *
 * `describe` turns whatever the write rejected with into a sentence. It is a parameter
 * because only the caller knows which `ApiError` messages are worth showing verbatim.
 */
export function useSaveState(
  describe: (failure: unknown) => string = defaultDescribe,
): SaveStateHandle {
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | undefined>(undefined);

  // Two guards. `live` stops a resolution from setting state on an unmounted section, and
  // `timer` stops an earlier "Saved" from clearing a later one.
  const live = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const clear = useCallback(() => {
    setState('idle');
    setError(undefined);
  }, []);

  const run = useCallback(
    async (write: () => Promise<unknown>): Promise<boolean> => {
      if (timer.current !== null) clearTimeout(timer.current);
      setState('saving');
      setError(undefined);
      try {
        await write();
        if (!live.current) return true;
        setState('saved');
        timer.current = setTimeout(() => {
          if (live.current) setState('idle');
        }, SAVED_MS);
        return true;
      } catch (failure: unknown) {
        if (!live.current) return false;
        setState('failed');
        setError(describe(failure));
        return false;
      }
    },
    [describe],
  );

  return { state, error, run, clear };
}

function defaultDescribe(failure: unknown): string {
  return failure instanceof Error && failure.message !== ''
    ? failure.message
    : 'That change could not be saved.';
}
