/**
 * Who owns the agent panel's open state, and the chord that flips it.
 *
 * The state lives in a hook rather than inside `AgentPanel` because the shell needs it
 * twice: once to render the panel, and once so Escape's application-wide dismiss can shut
 * it along with everything else. A component that owned its own openness could not be told
 * to close by the thing that owns "close whatever is on screen".
 *
 * The chord is registered here and not in `AppShell` so that the whole of the feature —
 * the shortcut, the panel, the transport — is one directory, and so this can be tested by
 * mounting a hook rather than the entire shell.
 */

import { useCallback, useState } from 'react';

import { useActions } from '~/app/keymap';

export interface AgentPanelHandle {
  readonly open: boolean;
  /** Stable, so a caller can put it in a dependency list without re-creating itself. */
  readonly close: () => void;
}

/**
 * `mod+J` because it is unclaimed on both platforms and next to `mod+K`, which is the other
 * "ask the product something in words" chord. It is a toggle, so it ignores auto-repeat:
 * a held key would otherwise open and shut the panel twenty times a second.
 *
 * Checked against `desktop/src/main/main.ts` by scripts/lint-keymap.sh — a native menu
 * accelerator is consumed before the renderer ever sees the keystroke, so a chord that
 * exists in both places is a shortcut that silently does nothing.
 */
export function useAgentPanel(): AgentPanelHandle {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useActions([
    {
      id: 'agent.toggle',
      title: 'Ask the agent',
      keys: ['mod+j'],
      group: 'General',
      ignoreRepeat: true,
      run: () => setOpen((current) => !current),
    },
  ]);

  return { open, close };
}
