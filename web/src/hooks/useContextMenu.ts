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
 */

import { useCallback, useRef, useState, type CSSProperties, type RefObject } from 'react';

/** The one-pixel box. Fixed to the viewport, since the coordinates are a pointer event's. */
const ANCHOR_STYLE: CSSProperties = {
  position: 'fixed',
  width: 1,
  height: 1,
  pointerEvents: 'none',
};

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
  close(): void;
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

  const close = useCallback(() => {
    setState(null);
    requestAnimationFrame(() => latest.current.returnFocusTo?.current?.focus());
  }, []);

  return {
    at: state === null ? null : { x: state.x, y: state.y },
    id: state?.id ?? null,
    openAt,
    close,
    anchorRef,
    anchorProps: {
      ref: anchorRef,
      style: { ...ANCHOR_STYLE, top: state?.y ?? 0, left: state?.x ?? 0 },
    },
  };
}
