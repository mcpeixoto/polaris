/**
 * The hand-off from a context menu into a property picker.
 *
 * Choosing "Status…" closes the menu and opens the picker on the same one-pixel anchor. If
 * close cleared that anchor, the picker would fall back to a toolbar trigger half a screen
 * away — the bug IssueList once had. A flag set for the one close that is really an open is
 * how callers keep the anchor alive without inventing a second state machine.
 */

import { useCallback, useRef } from 'react';

export interface ContextMenuHandoff {
  /**
   * Mark the next close as a hand-off into a picker. Call before closing the menu and
   * opening the picker against the same anchor.
   */
  begin(): void;
  /** Whether the close currently in flight is a hand-off. Clears the flag. */
  consume(): boolean;
}

export function useContextMenuHandoff(): ContextMenuHandoff {
  const handingOff = useRef(false);

  const begin = useCallback(() => {
    handingOff.current = true;
  }, []);

  const consume = useCallback(() => {
    const value = handingOff.current;
    handingOff.current = false;
    return value;
  }, []);

  return { begin, consume };
}
