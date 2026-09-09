/**
 * Whether the initiative screen's property rail is showing, and how the two halves agree
 * about it.
 *
 * The toggle is in the shell's tab row, because that is where Linear puts it and because it
 * has to survive the move between Overview and Activity. The rail itself is drawn by the
 * Overview, because the Progress section in it reads the same rollup the page does. So the
 * shell holds the state and hands it down the outlet — the one channel a route already has
 * to its child — rather than the two of them each keeping a copy and drifting.
 *
 * A screen rendered outside a route (a test mounting the Overview on its own) gets no
 * context at all, and the answer there is "showing": a property rail nobody asked to hide is
 * the default arrangement of this page.
 */

import { useOutletContext } from 'react-router';

/** Which screen's folds these are — see `features/view/collapse`. */
export const INITIATIVE_RAIL_KEY = 'initiative.rail';

/** The member of that set standing for the whole rail, beside its section ids. */
export const INITIATIVE_RAIL_ID = 'rail';

export interface InitiativeOutletContext {
  readonly railOpen: boolean;
}

export function useInitiativeRailOpen(): boolean {
  // Null outside a route with an `<Outlet context>`, which is exactly the standalone case.
  const context = useOutletContext<InitiativeOutletContext | null>();
  return context?.railOpen ?? true;
}
