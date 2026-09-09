/**
 * Right-click plumbing for a list: where the pointer was, and something for a menu to hang off.
 *
 * `Menu` positions itself by measuring its trigger, and a right-click has no trigger — the
 * user aimed at a row, not at a control. So the caller renders a one-pixel element at the
 * pointer and gives the menu that. It is a real box rather than a `hidden` element, because
 * a hidden element has no rectangle to measure and the menu lands in the corner.
 *
 * The other half is focus. `Menu` hands focus back to its trigger on close, which is correct
 * everywhere else and useless here: the anchor is about to be unmounted. So the caller names
 * the element that should get the keyboard back — the scroller — and it is focused in the
 * *following* frame, after the menu's own restore rather than instead of it. Without the
 * frame the two fight and the page ends up focused on `<body>`, which is where a list's
 * keyboard navigation goes to die.
 *
 * A right-click menu that only a right-click can open is half a feature in a product whose
 * thesis is the keyboard, so `openFromEvent` also serves the synthesised `contextmenu` the
 * browser sends for Shift+F10 and the Menu key, and `openOn` gives an explicit chord
 * somewhere to aim. Both go through the same anchor as the pointer does.
 */

import { useCallback, useRef, useState, type CSSProperties, type RefObject } from 'react';

/** How far in from a row's leading edge a keyboard-opened menu sits. */
const KEYBOARD_INSET = 12;

/** The one-pixel box. Fixed to the viewport, since the coordinates are a pointer event's. */
const ANCHOR_STYLE: CSSProperties = {
  position: 'fixed',
  width: 1,
  height: 1,
  pointerEvents: 'none',
};

/**
 * Where a `contextmenu` event means to put a menu.
 *
 * For a pointer, where the pointer is. Without one — Shift+F10, the Menu key — the browser
 * still sends a `contextmenu` event, but the coordinates it invents are 0,0 in Chrome and the
 * element's corner in Firefox, so neither can be believed and the row is measured instead.
 *
 * Telling the two apart is the whole difficulty, and the obvious field is a trap. Measured in
 * Chrome 141 on macOS:
 *
 * | gesture             | detail | button | buttons |
 * |---------------------|--------|--------|---------|
 * | right-click         |   0    |   2    |    2    |
 * | ctrl+click, the Mac |   0    |   0    |    1    |
 * | keyboard            |   0    |   0    |    0    |
 *
 * So `detail` says nothing — a real right-click reports 0 exactly like the keyboard — and
 * `button` alone would take the Mac's ctrl+click for a keypress and open every menu in the
 * wrong place on the platform most of this is developed on. What is actually distinctive is
 * that nothing is pressed: no button, and no buttons.
 *
 * Exported for the surfaces that hold their own anchor state rather than using the hook.
 */
export function contextMenuPoint(event: {
  button: number;
  buttons: number;
  clientX: number;
  clientY: number;
  currentTarget: EventTarget | null;
}): { x: number; y: number } {
  const fromPointer = event.button !== 0 || event.buttons !== 0;
  if (!fromPointer && event.currentTarget instanceof HTMLElement) {
    return contextMenuPointOn(event.currentTarget);
  }
  return { x: event.clientX, y: event.clientY };
}

/**
 * Where a menu opened from an element belongs: the start of its lower edge, stepped in.
 *
 * Flush against the edge reads as an accident, and this is the same small step the pointer
 * would almost always have landed past anyway. Exported so that a surface opening its menu
 * from a chord puts it in the same place as one opening it from Shift+F10.
 */
export function contextMenuPointOn(element: HTMLElement): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.left + KEYBOARD_INSET, y: box.bottom };
}

export interface ContextMenuOptions<Id> {
  /**
   * Called before the menu opens, with what was clicked. Lists move the cursor here so the
   * menu acts on what is under the pointer: with a selection standing, right-clicking one of
   * six selected rows still means "these six", which is the rule the toolbar already follows.
   */
  onOpen?: ((id: Id) => void) | undefined;
  /** Where the keyboard goes when the menu closes. The list's scroller, normally. */
  returnFocusTo?: RefObject<HTMLElement | null> | undefined;
}

export interface ContextMenuApi<Id> {
  /** The pointer position while the menu is open, and null when it is not. */
  at: { x: number; y: number } | null;
  /** What was right-clicked, for the caller to build the menu's items and label from. */
  id: Id | null;
  openAt(x: number, y: number, id: Id): void;
  /**
   * Opens the menu against an element rather than a pointer, at the start of its lower
   * edge — where a menu opened from a row belongs, and where the pointer would have been
   * if there had been one.
   *
   * This is the keyboard's way in. It positions the same one-pixel anchor rather than
   * handing `Menu` a different trigger, so flipping, re-anchoring on scroll and focus
   * return all stay on the single path they are already tested on.
   */
  openOn(element: HTMLElement, id: Id): void;
  /**
   * The handler a row should use, which is both ways in at once.
   *
   * Shift+F10 and the Menu key already reach us where the platform has them: the browser
   * synthesises a `contextmenu` event, and `contextMenuPoint` measures the row rather than
   * believing coordinates that were never taken from a pointer. It has to be a branch here
   * rather than a key binding, because binding Shift+F10 ourselves would `preventDefault`
   * the keydown and suppress the very event we want. macOS has no such gesture, which is
   * why a surface should also register a chord of its own.
   */
  openFromEvent(
    event: {
      button: number;
      buttons: number;
      clientX: number;
      clientY: number;
      currentTarget: EventTarget | null;
      preventDefault(): void;
    },
    id: Id,
  ): void;
  /** Shuts the menu and hands the keyboard back to `returnFocusTo`. */
  close(): void;
  /**
   * Shuts the menu because something else is taking the keyboard — an inline editor, a
   * dialog — and therefore does *not* restore focus.
   *
   * The restore is scheduled a frame out, so left to `close` it lands after the editor has
   * focus and pulls it straight back to the list. An editor that commits on blur then
   * commits nothing and closes: renaming a dashboard from its menu did exactly that, and
   * discarded everything typed into it.
   */
  handOff(): void;
  /** Pass to `Menu`'s `trigger`. */
  anchorRef: RefObject<HTMLDivElement | null>;
  /** Spread onto the one-pixel `<div>`, rendered only while `at` is not null. */
  anchorProps: {
    ref: RefObject<HTMLDivElement | null>;
    style: CSSProperties;
  };
}

export function useContextMenu<Id = string>(
  options: ContextMenuOptions<Id> = {},
): ContextMenuApi<Id> {
  const { onOpen, returnFocusTo } = options;
  const [state, setState] = useState<{ x: number; y: number; id: Id } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  // Through a ref so `openAt` and `close` are stable for the life of the list: they are
  // handed to every row, and a new identity per render re-renders all of them.
  const latest = useRef({ onOpen, returnFocusTo });
  latest.current = { onOpen, returnFocusTo };

  const openAt = useCallback((x: number, y: number, id: Id) => {
    latest.current.onOpen?.(id);
    setState({ x, y, id });
  }, []);

  const openOn = useCallback(
    (element: HTMLElement, id: Id) => {
      const point = contextMenuPointOn(element);
      openAt(point.x, point.y, id);
    },
    [openAt],
  );

  const openFromEvent = useCallback(
    (
      event: {
        button: number;
        buttons: number;
        clientX: number;
        clientY: number;
        currentTarget: EventTarget | null;
        preventDefault(): void;
      },
      id: Id,
    ) => {
      event.preventDefault();
      const point = contextMenuPoint(event);
      openAt(point.x, point.y, id);
    },
    [openAt],
  );

  const close = useCallback(() => {
    setState(null);
    requestAnimationFrame(() => latest.current.returnFocusTo?.current?.focus());
  }, []);

  const handOff = useCallback(() => {
    setState(null);
  }, []);

  return {
    at: state === null ? null : { x: state.x, y: state.y },
    id: state?.id ?? null,
    openAt,
    openOn,
    openFromEvent,
    close,
    handOff,
    anchorRef,
    anchorProps: {
      ref: anchorRef,
      style: { ...ANCHOR_STYLE, top: state?.y ?? 0, left: state?.x ?? 0 },
    },
  };
}
