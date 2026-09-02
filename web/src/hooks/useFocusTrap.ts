/**
 * Keeping Tab inside a surface that has taken over the screen, and handing focus back when
 * it leaves.
 *
 * `Modal` grew this behaviour first and still owns its own copy, because its trap is
 * entangled with the dialog's `initialFocus` contract and its exit-presence dance. This hook
 * is the same guarantee for the surfaces that are modal in every way that matters to a user
 * but are not `Modal` — the command palette being the one that mattered: `role="dialog"`,
 * `aria-modal="true"`, a scrim over the whole page, and Tab walking straight out of it into
 * a sidebar nobody could see.
 *
 * Three things, and deliberately only three:
 *
 * **Tab wraps.** Only the two edges are handled; everything between them is the browser's
 * own tab order, which already accounts for `tabindex`, disabled controls and content no
 * selector can see.
 *
 * **Focus goes in.** On activation, the first focusable descendant — or the container
 * itself, which is why callers give it `tabIndex={-1}`. A surface that opens with focus
 * still behind it is one whose first keystroke goes somewhere else.
 *
 * **Focus comes back.** The element that was focused when the trap armed is refocused when
 * it disarms. Without it, dismissing the palette drops the caret on `<body>` and the next
 * `J` goes nowhere — the exact bug this was written for.
 *
 * The Tab handler is attached to the document in the capture phase rather than returned for
 * the caller to spread, so a surface whose inner controls stop propagation cannot leak the
 * key. Escape is *not* handled here: which layer Escape closes is a question about the whole
 * application's layer stack, and the answer lives with the surface, not with its trap.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * What the browser will put focus on, as a selector.
 *
 * `[tabindex^="-"]` rather than `[tabindex="-1"]`: any negative value is programmatic-focus
 * only, and `-2` is legal.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  'audio[controls]',
  'video[controls]',
  'iframe',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex^="-"])',
].join(',');

/**
 * The focusable elements inside `root`, in tab order.
 *
 * Visibility is consulted through `checkVisibility` when the host has it, and skipped
 * otherwise. Every other way of asking — `offsetParent`, `getClientRects`, a computed style
 * — reports "invisible" for the entire document under jsdom, which would leave the trap with
 * nothing to trap and the test suite unable to see it fail.
 */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) {
    if (element.closest('[inert],[aria-hidden="true"]') !== null) continue;
    const visible = (element as { checkVisibility?: () => boolean }).checkVisibility;
    if (typeof visible === 'function' && !visible.call(element)) continue;
    found.push(element);
  }
  return found;
}

export interface FocusTrapOptions {
  /**
   * Focused on activation instead of the first focusable descendant. Point it at the thing
   * the user came for — a palette's query box — rather than at the furniture in front of it.
   */
  readonly initialFocus?: RefObject<HTMLElement | null> | undefined;
}

/**
 * @param ref     The surface. Must be focusable itself (`tabIndex={-1}`) so the trap has
 *                somewhere to put focus when the surface holds nothing focusable at all.
 * @param active  Whether the trap is armed. Keys on what the *product* thinks is open, not
 *                on what is still painted: a surface on its way out must not hold Tab.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  options: FocusTrapOptions = {},
): void {
  const { initialFocus } = options;
  const returnRef = useRef<HTMLElement | null>(null);

  // A layout effect, and declared before the one that moves focus in, so what it captures is
  // the element that opened the surface rather than the surface's own first field. Effect
  // order is the only thing keeping those two apart.
  useLayoutEffect(() => {
    if (!active) return;
    const previous = document.activeElement;
    returnRef.current = previous instanceof HTMLElement ? previous : null;
  }, [active]);

  useLayoutEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (container === null) return;
    const requested = initialFocus?.current ?? null;
    (requested ?? focusableWithin(container)[0] ?? container).focus();
  }, [active, ref, initialFocus]);

  /**
   * The return half of the trip, in a passive effect rather than in the cleanup of a layout
   * effect — the same split `Modal` makes, for the same reason. React captures the focused
   * element before a commit and refocuses it after, so restoring from a layout cleanup is
   * restoring before that happens and being quietly overruled.
   */
  useEffect(() => {
    if (!active) return;
    return () => {
      const target = returnRef.current;
      returnRef.current = null;
      // isConnected: the trigger is often a row action that the same interaction removed
      // from the DOM, and focusing a detached node drops focus to the body silently.
      if (target !== null && target.isConnected) target.focus();
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const container = ref.current;
      if (container === null) return;

      const focusable = focusableWithin(container);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        // Nothing to move to, so Tab must not move: the browser's next stop is the page
        // behind the surface.
        event.preventDefault();
        container.focus();
        return;
      }

      const activeElement = document.activeElement;
      const inside = activeElement instanceof HTMLElement && container.contains(activeElement);
      if (!inside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && (activeElement === first || activeElement === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Capture, so a control inside the surface that stops propagation cannot leak Tab past
    // the trap and into the page behind the scrim.
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [active, ref]);
}
