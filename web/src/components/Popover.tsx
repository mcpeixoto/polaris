/**
 * The anchored panel: a floating surface that holds controls rather than a list of commands.
 *
 * `Menu` already answers "choose one of these", and everything it does — type-ahead, the
 * arrow keys, `aria-activedescendant` — depends on every row being a command. A panel with a
 * text field in it cannot make that bargain: the menu's type-ahead would swallow every digit
 * of a date, and a menu item wrapping an input is a widget no screen reader has a name for.
 * So the due-date panel grew its own portal, its own anchor arithmetic, its own
 * outside-pointerdown listener and its own focus restore — and then `ProjectDisplayMenu` grew
 * a second copy, and the two drifted. This is that machinery, written once.
 *
 * It owns four things and deliberately nothing else:
 *
 * - **The portal.** A rail clips its overflow and a panel is taller than the button that
 *   opens it, so the surface is drawn on the body and positioned from the trigger's rect.
 * - **The exit.** `usePresence` keeps the node alive for the length of its fade. `open` still
 *   means what it meant everywhere else: the keyboard context is handed back and focus goes
 *   home on the frame Escape lands, not on the frame the pixels finish.
 * - **Dismissal.** Escape as a *registered* action, and a pointerdown outside both the panel
 *   and its trigger.
 * - **Focus.** Returned to the trigger on close, but only when closing is what lost it —
 *   clicking straight into another control closes this too, and dragging focus back out of
 *   the field somebody has just clicked into is worse than not restoring it at all.
 *
 * ## Why `actionId` is a required prop and not a constant
 *
 * `KeymapRegistry.register` throws on a duplicate id, on purpose: silently overwriting a
 * binding is how a shortcut mysteriously stops working. A shared popover with a hard-coded id
 * would therefore be un-mountable twice on one screen — which is exactly what a project's
 * start date and target date ask for. Two *guarded* bindings on one key are fine (the registry
 * allows them, and `enabled` is what makes the open one win), so the caller supplies the id and
 * every popover on a screen keeps its own.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { useActions, useKeyContext } from '~/app/keymap';
import { usePresence } from '~/hooks/usePresence';

import { horizontalShift } from './anchor';
import styles from './Popover.module.css';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** The control it belongs to: what it is positioned against, and where focus returns. */
  trigger: RefObject<HTMLElement | null>;
  /** The dialog's accessible name, e.g. "Due date". Announced when focus enters it. */
  label: string;
  /**
   * The id its Escape is registered under. Unique across everything mounted at once — see the
   * note above; two popovers sharing one id is a thrown error at mount, not a subtle bug.
   */
  actionId: string;
  /** What the help overlay calls that Escape. Defaults to closing the named panel. */
  actionTitle?: string | undefined;
  /** The help overlay's section for it. */
  actionGroup?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}

export function Popover({
  open,
  onClose,
  trigger,
  label,
  actionId,
  actionTitle,
  actionGroup = 'General',
  className,
  children,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  // Positioning settles once per opening: the shift is measured from the panel's rendered
  // rect, and re-measuring after moving it would chase its own tail.
  const settledRef = useRef(false);

  const { present, exitProps } = usePresence(open, panelRef);

  /**
   * What the registered Escape reads. The registry captures `run` once, at registration, so a
   * closure over `onClose` would go on calling whichever callback the first render happened to
   * pass — the same reason the issue list reaches its commands through a ref.
   */
  const state = useRef({ open, close: onClose });
  state.current = { open, close: onClose };

  // The panel has taken the keyboard, so the screen's own chords stop competing with the
  // controls being tabbed through. `menu` is sealed, which is what makes that true.
  useKeyContext('menu', open);

  useActions(
    [
      {
        id: actionId,
        title: actionTitle ?? `Close the ${label.toLowerCase()} panel`,
        keys: ['Escape'],
        when: 'menu',
        group: actionGroup,
        // Hidden from the command menu: "close the thing that is open" is not something
        // anybody searches for, and it still appears in the help overlay.
        hidden: true,
        // Disabled is treated as unbound, so with the panel shut Escape falls through to
        // whatever else claims it rather than being swallowed by a command with nothing to
        // do — and so a second popover on the same screen can hold the same key.
        enabled: () => state.current.open,
        run: () => state.current.close(),
      },
    ],
    [actionId],
  );

  useLayoutEffect(() => {
    if (!open) {
      // Cleared when the panel has gone, not when it was told to go: `point` is where it is
      // drawn, and a still-visible panel would drop to the corner of the window without it.
      if (!present) {
        setPoint(null);
        settledRef.current = false;
      }
      return;
    }
    const anchor = trigger.current;
    if (anchor === null) return;
    const rect = anchor.getBoundingClientRect();
    setPoint({ top: rect.bottom, left: rect.left });
  }, [open, present, trigger]);

  useLayoutEffect(() => {
    if (!open || point === null || settledRef.current) return;
    const panel = panelRef.current;
    if (panel === null) return;
    settledRef.current = true;
    const shift = horizontalShift(panel.getBoundingClientRect());
    if (shift !== 0) setPoint({ top: point.top, left: point.left + shift });
  }, [open, point]);

  useEffect(() => {
    if (!open) return;
    // Captured while open. Reading the ref inside the cleanup would read whatever it points at
    // by then, which after an unmount is null — and the focus restore would silently stop.
    const anchorAtOpen = trigger.current;
    return () => {
      const active = document.activeElement;
      if (active === null || active === document.body) anchorAtOpen?.focus();
    };
  }, [open, trigger]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) === true) return;
      if (trigger.current?.contains(target) === true) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onClose, trigger]);

  if (!present) return null;

  const style: CSSProperties = point === null ? {} : { top: point.top, left: point.left };

  return createPortal(
    <div
      ref={panelRef}
      // A dialog rather than a menu: it holds fields and forms, and `menu` promises a list of
      // commands the arrow keys walk. Not `aria-modal` either — the screen behind it stays
      // readable, which is the point of editing a property in place.
      role="dialog"
      aria-label={label}
      className={[styles.panel, className].filter(Boolean).join(' ')}
      style={style}
      tabIndex={-1}
      {...exitProps}
    >
      {children}
    </div>,
    document.body,
  );
}

interface Point {
  readonly top: number;
  readonly left: number;
}
