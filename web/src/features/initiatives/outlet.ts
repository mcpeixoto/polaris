/**
 * What the initiative shell hands down to the tab inside it.
 *
 * Two things, and both exist because a control and the thing it acts on ended up in
 * different components — which is the shape this page has now that Linear's layout puts the
 * name, the icon and the properties in the reading column while the trail, the tabs and the
 * `…` menu stay in the chrome above it.
 *
 * `railOpen` is the toggle's answer. The toggle is in the shell's tab row, because that is
 * where Linear puts it and because hiding the rail has to survive the move between Overview
 * and Activity. The rail itself is drawn by the Overview, whose rollup it shows.
 *
 * `openMenuAt` is the shell's own `…` menu, opened from somewhere else on the screen. The
 * body's title block answers a right-click with it, and the alternative — a second menu
 * built in the body from the same items — is two lists of the same commands drifting apart.
 *
 * A screen rendered outside a route (a test mounting the Overview on its own) gets no
 * context at all. The answers there are "showing" and "do nothing": a property rail nobody
 * asked to hide is the default arrangement of this page, and a menu with no shell to own it
 * is not a menu.
 */

import { useOutletContext } from 'react-router';

/** Which screen's folds these are — see `features/view/collapse`. */
export const INITIATIVE_RAIL_KEY = 'initiative.rail';

/** The member of that set standing for the whole rail, beside its section ids. */
export const INITIATIVE_RAIL_ID = 'rail';

export interface InitiativeOutletContext {
  readonly railOpen: boolean;
  /** Open the shell's `…` menu at a point, for a right-click the body caught. */
  openMenuAt(x: number, y: number): void;
}

const STANDALONE: InitiativeOutletContext = {
  railOpen: true,
  openMenuAt: () => {},
};

export function useInitiativeOutlet(): InitiativeOutletContext {
  // Null outside a route with an `<Outlet context>`, which is exactly the standalone case.
  return useOutletContext<InitiativeOutletContext | null>() ?? STANDALONE;
}
