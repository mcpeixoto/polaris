/**
 * Keeping a floating surface on the screen it was measured against.
 *
 * Menu and Tooltip both anchor a portalled box to a control's rect, and both of them can
 * be asked to draw that box off the edge of the viewport — a status picker on the last
 * column of a board, a tooltip on the rightmost button of a toolbar. Flipping answers the
 * placement axis only; the cross axis needs a shift, and the shift is the same arithmetic
 * for both. It lived in Menu.tsx, was copied verbatim into three feature popovers, and the
 * tooltip simply went without, which is how half a hint ends up past the window edge.
 *
 * The functions take the surface's *rendered* rect, after the transforms and margins the
 * stylesheets own have been applied. Recomputing that geometry from the anchor would mean
 * this file knowing offsets the CSS decides, and the two drifting apart the first time
 * somebody adjusts the spacing.
 */

/** Kept off the viewport edge by this much when a surface has to be shifted to fit. */
export const VIEWPORT_MARGIN_PX = 8;

/** How far the surface must move horizontally to stay on screen. Zero when it already fits. */
export function horizontalShift(rect: DOMRect): number {
  if (rect.right > window.innerWidth - VIEWPORT_MARGIN_PX) {
    // The lower bound is what stops a box wider than the viewport being pushed off the
    // *left* edge to rescue its right one: the left margin wins the argument, because a
    // surface is read from its leading edge.
    return Math.max(
      window.innerWidth - VIEWPORT_MARGIN_PX - rect.right,
      VIEWPORT_MARGIN_PX - rect.left,
    );
  }
  if (rect.left < VIEWPORT_MARGIN_PX) return VIEWPORT_MARGIN_PX - rect.left;
  return 0;
}

/** The same for the vertical axis, which is the cross axis of a left- or right-placed tip. */
export function verticalShift(rect: DOMRect): number {
  if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN_PX) {
    return Math.max(
      window.innerHeight - VIEWPORT_MARGIN_PX - rect.bottom,
      VIEWPORT_MARGIN_PX - rect.top,
    );
  }
  if (rect.top < VIEWPORT_MARGIN_PX) return VIEWPORT_MARGIN_PX - rect.top;
  return 0;
}
