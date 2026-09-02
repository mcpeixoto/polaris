/**
 * Pushing a keyboard context from a primitive, without making the primitive depend on a
 * provider it has no way to require.
 *
 * `app/keymap`'s `useKeyContext` is the real thing and this is a thin wrapper over it: an
 * open Menu pushes `'menu'` and an open Modal pushes `'modal'`, so one Escape closes one
 * layer rather than the layer and everything the shell's global `app.dismiss` reaches. Five
 * feature call sites already did this by hand around a Menu they happened to own; the ten
 * menus in AppShell did not, and the difference was invisible until Escape closed two of
 * them at once.
 *
 * The tolerance is the only thing worth explaining. `useKeymap` throws outside a
 * `KeymapProvider`, which is correct for a screen — a screen with no keymap is a screen
 * whose shortcuts silently do nothing — and wrong for a primitive: `Menu` and `Modal` are
 * rendered by the component gallery, by a dozen unit tests, and by anything that mounts one
 * of them in isolation, none of which have a keyboard to shadow. A missing provider here
 * means there is no context stack to push onto, which is not an error, it is an absence.
 * The `useContext` call inside `useKeymap` runs either way, so the hook order is stable and
 * the catch is safe.
 */

import { useEffect } from 'react';

import { useKeymap } from '~/app/keymap';
import type { Context } from '~/keys';

export function useOptionalKeyContext(context: Context, active: boolean): void {
  let pushContext: ((c: Context) => () => void) | null = null;
  try {
    // The rule is right about the general case and wrong about this one: `useKeymap` is a
    // `useContext` call, it runs on every render whether or not it then throws, and the hook
    // order below is therefore identical either way. Catching it is the only way to ask
    // "is there a keymap here?" without exporting the context object itself.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    pushContext = useKeymap().pushContext;
  } catch {
    pushContext = null;
  }

  useEffect(() => {
    if (!active || pushContext === null) return;
    return pushContext(context);
  }, [pushContext, context, active]);
}
