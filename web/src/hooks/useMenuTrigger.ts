/**
 * The control a Menu hangs off, and the open state that belongs with it.
 *
 * Menu deliberately does not own its trigger: it needs the element both to position itself
 * against and to hand focus back to on close, and inventing one would take that decision
 * away from the surface that knows what the control looks like. The consequence is that
 * every picker call site writes the same ref, the same boolean, and the same two ARIA
 * attributes — and the third copy is the one that forgets `aria-expanded`, leaving a screen
 * reader user with a button that gives no hint a menu exists.
 *
 * Opening is also a keyboard action here (`S`, `A`, `P` in the issue list), and an action's
 * `run` closure is captured once at registration. So `show` and `hide` are stable for the
 * life of the component rather than rebuilt per render, or the registered shortcut would go
 * on toggling a boolean nobody is reading any more.
 *
 * The popup type is an argument because not every surface this hook opens is a menu. The
 * due-date panel is a `role="dialog"` holding a text field, and a trigger promising a menu
 * tells a screen reader to expect a list the arrow keys walk — so the announcement and the
 * thing that opens disagreed. The default stays `menu`, which is what every other call site
 * opens.
 */

import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';

/** What the trigger opens, as `aria-haspopup` spells it. */
export type PopupType = 'menu' | 'dialog' | 'listbox' | 'tree' | 'grid';

export interface MenuTrigger<E extends HTMLElement = HTMLButtonElement> {
  readonly open: boolean;
  readonly ref: RefObject<E | null>;
  /** Spread onto the trigger element: the ref, the ARIA pair, and the pointer affordance. */
  readonly props: {
    readonly ref: RefObject<E | null>;
    readonly 'aria-haspopup': PopupType;
    readonly 'aria-expanded': boolean;
    readonly onClick: () => void;
  };
  show(): void;
  hide(): void;
  toggle(): void;
}

export function useMenuTrigger<E extends HTMLElement = HTMLButtonElement>(
  popup: PopupType = 'menu',
): MenuTrigger<E> {
  const ref = useRef<E | null>(null);
  const [open, setOpen] = useState(false);

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((current) => !current), []);

  return useMemo(
    () => ({
      open,
      ref,
      props: {
        ref,
        'aria-haspopup': popup,
        'aria-expanded': open,
        onClick: toggle,
      },
      show,
      hide,
      toggle,
    }),
    [open, popup, show, hide, toggle],
  );
}
