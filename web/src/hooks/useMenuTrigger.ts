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
 *
 * ## One picker, many places it can hang from
 *
 * A list has one status picker and hundreds of rows that each want to open it under their
 * own glyph. Mounting a picker per row is not the answer — it is hundreds of live queries
 * to serve the one that is open, and in a virtualised list the row that owns the open menu
 * unmounts the moment it scrolls out of the overscan window, taking the menu with it. So
 * the picker stays a singleton and the *anchor* moves: `showFrom(element)` opens it
 * positioned against something other than the registered trigger.
 *
 * `ref` is therefore not a plain ref but an object that resolves the override at read time.
 * That matters more than it looks. The issue list's bulk toolbar is not mounted while
 * nothing is selected: pressing `S` flips the flag that mounts it, and Menu measures the
 * trigger in a layout effect *after* that commit. A `show()` that snapshotted the element
 * would snapshot `null` and leave every keyboard-opened picker in the list unpositioned —
 * a failure jsdom cannot see, because every rect there is already zero.
 *
 * The override is cleared by `show`, `hide` and `toggle`, so a row element can never
 * survive into a menu opened from the keyboard or from the toolbar.
 */

import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';

/** What the trigger opens, as `aria-haspopup` spells it. */
export type PopupType = 'menu' | 'dialog' | 'listbox' | 'tree' | 'grid';

export interface MenuTrigger<E extends HTMLElement = HTMLButtonElement> {
  readonly open: boolean;
  /**
   * What a Menu positions against and hands focus back to: the element `showFrom` named if
   * one is standing, and the trigger itself otherwise.
   */
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
  /**
   * Open the menu against some other element — a glyph in a row, a one-pixel anchor at the
   * pointer. `null` falls back to the registered trigger, so a caller with nothing to
   * anchor to does not have to branch.
   */
  showFrom(element: HTMLElement | null): void;
}

export function useMenuTrigger<E extends HTMLElement = HTMLButtonElement>(
  popup: PopupType = 'menu',
): MenuTrigger<E> {
  /** The registered trigger. Written by React, through `props.ref`. */
  const own = useRef<E | null>(null);
  /** The element `showFrom` named, if a menu is currently hanging off one. */
  const from = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);

  /*
   * Read-through, and writable.
   *
   * The setter is not ceremony: two call sites hand this object straight to React as a JSX
   * `ref` (`features/triage/TriagePane.tsx`, `views/Landing.tsx`), and React assigns to
   * `.current`. A getter-only object would throw there on mount.
   */
  const ref = useMemo<RefObject<E | null>>(
    () => ({
      get current(): E | null {
        return (from.current as E | null) ?? own.current;
      },
      set current(element: E | null) {
        own.current = element;
      },
    }),
    [],
  );

  const show = useCallback(() => {
    from.current = null;
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    from.current = null;
    setOpen(false);
  }, []);
  const toggle = useCallback(() => {
    from.current = null;
    setOpen((current) => !current);
  }, []);
  const showFrom = useCallback((element: HTMLElement | null) => {
    from.current = element;
    setOpen(true);
  }, []);

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
      showFrom,
    }),
    [open, popup, ref, show, hide, toggle, showFrom],
  );
}
