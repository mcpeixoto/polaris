import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { usePresence } from '~/hooks/usePresence';

import { IconButton } from './IconButton';
import styles from './Modal.module.css';

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  open: boolean;
  /** Called by Escape, the close button, and a click on the backdrop. */
  onClose: () => void;
  /**
   * The dialog's accessible name, and its visible heading. Required, and a string: a modal
   * with no name is announced as "dialog", which tells a screen-reader user that something
   * has taken over the screen and nothing about what.
   */
  title: string;
  /** A line under the title, wired up as the dialog's accessible description. */
  description?: string | undefined;
  size?: ModalSize | undefined;
  /** Footer actions, laid out trailing-aligned. Usually a Cancel and a primary Button. */
  footer?: ReactNode | undefined;
  /**
   * What to focus on open. Point it at the field the user came to fill in — the title box
   * of a create-issue modal — because the alternative is a keyboard user's first act being
   * to Tab past the furniture.
   */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  className?: string | undefined;
  children: ReactNode;
}

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
 * The focusable elements inside the dialog, in tab order.
 *
 * Visibility is consulted through `checkVisibility` when the host has it, and skipped
 * otherwise. Every other way of asking — `offsetParent`, `getClientRects`, a computed
 * style — reports "invisible" for the entire document under jsdom, which would leave the
 * trap with nothing to trap and the test suite unable to see it fail.
 */
function focusableWithin(root: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) {
    if (element.closest('[inert],[aria-hidden="true"]') !== null) continue;
    const visible = (element as { checkVisibility?: () => boolean }).checkVisibility;
    if (typeof visible === 'function' && !visible.call(element)) continue;
    found.push(element);
  }
  return found;
}

/**
 * Modal is the product's one interruption: the create-issue form, a destructive
 * confirmation, the keyboard help overlay.
 *
 * Everything it does follows from the word "modal" being a claim about the whole page. It
 * says so to assistive technology with `aria-modal`, so the content behind it is not read;
 * it says so to the keyboard by trapping Tab, so focus cannot wander behind a scrim it
 * cannot see past; it says so to the pointer by locking body scroll, because scrolling the
 * page under an open dialog is the clearest possible signal that the dialog is not really
 * in charge. Getting one of those right and not the others produces a dialog that works
 * for exactly one kind of user.
 *
 * Focus goes in on open and comes back out on close, to the element that opened it. That
 * round trip is what makes a modal a detour rather than a redirection: `C`, type a title,
 * Escape, and the caret is back in the list on the row it left.
 *
 * It renders through a portal into document.body — a dialog nested inside a scrolling,
 * overflow-hidden list pane is a dialog clipped by it — and, with Menu, is one of the two
 * components in this directory allowed its own key handler. Escape and Tab inside an open
 * dialog are properties of the dialog, not entries in the keymap; see web/src/keys for the
 * rule and Menu for the same exception.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  initialFocus,
  className,
  children,
}: ModalProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  // A press that began inside the dialog and ended on the backdrop is a drag — selecting
  // the last word of a sentence, usually — not a dismissal.
  const backdropPressRef = useRef(false);

  // `present` outlives `open` by the length of the exit. Everything below still keys on
  // `open`, because focus and the scroll lock are answers to "has the user dismissed this",
  // not to "is anything still painted": Escape has to hand the keyboard back on the frame it
  // was pressed, whatever the scrim is doing afterwards.
  const { present, exitProps } = usePresence(open, backdropRef);

  // Declared before the focusing effect below, and a layout effect like it, so that what it
  // captures is the element that opened the dialog rather than the dialog's own first
  // field. Effect order is the only thing keeping those two apart.
  useLayoutEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    returnRef.current = previous instanceof HTMLElement ? previous : null;
  }, [open]);

  /**
   * And the other half of the round trip, deliberately in a passive effect rather than in
   * the cleanup of the layout effect above.
   *
   * The split is not stylistic. Since the dialog now outlives `open` by the length of its
   * exit, the element that was focused inside it is still connected when the closing commit
   * ends — and React, which captures the focused element before a commit and re-focuses it
   * after, would put the caret straight back into the dialog the user has just dismissed.
   * Restoring from a layout cleanup means restoring before that happens and being quietly
   * overruled. A passive effect runs after the whole commit, including after usePresence has
   * emptied the exiting subtree of focus, so this is the last word rather than the first.
   */
  useEffect(() => {
    if (!open) return;
    return () => {
      const target = returnRef.current;
      returnRef.current = null;
      // isConnected: the trigger is often a row action that the same interaction removed
      // from the DOM, and focusing a detached node drops focus to the body silently.
      if (target !== null && target.isConnected) target.focus();
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const requested = initialFocus?.current ?? null;
    if (requested !== null) {
      requested.focus();
      return;
    }
    // The close button is skipped: it is first in the DOM because it belongs in the
    // header, and landing on it offers the user the one action they did not open the
    // dialog to perform.
    const target =
      focusableWithin(dialog).find((element) => element !== closeRef.current) ?? dialog;
    target.focus();
  }, [open, initialFocus]);

  // The one exception, and it is about the scrim rather than the dialog: releasing the lock
  // on `open` would return the scrollbar — and reflow the page behind a backdrop that is
  // still opaque — while the user is watching it fade.
  useLayoutEffect(() => {
    if (!present) return;
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    // Restoring the previous value rather than clearing it is what makes nesting work: the
    // inner dialog hands back the 'hidden' the outer one set.
    return () => {
      body.style.overflow = previous;
    };
  }, [present]);

  if (!present) return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // Stops the application's window-level key listener seeing the same press: without
      // it, one Escape closes this dialog and whatever is behind it.
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (dialog === null) return;
    const focusable = focusableWithin(dialog);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) {
      // Nothing to move to, so Tab must not move: the browser's next stop is the page
      // behind the dialog.
      event.preventDefault();
      dialog.focus();
      return;
    }

    const active = document.activeElement;
    const inside = active instanceof HTMLElement && dialog.contains(active);
    if (!inside) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    // Only the two edges are handled. Everything between them is the browser's own tab
    // order, which already accounts for tabindex, disabled controls and content the
    // selector below cannot see.
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onBackdropMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    backdropPressRef.current = event.target === event.currentTarget;
  };

  const onBackdropClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!backdropPressRef.current || event.target !== event.currentTarget) return;
    backdropPressRef.current = false;
    onClose();
  };

  return createPortal(
    <div
      ref={backdropRef}
      className={styles.backdrop}
      onMouseDown={onBackdropMouseDown}
      onClick={onBackdropClick}
      {...exitProps}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        className={[styles.dialog, styles[size], className].filter(Boolean).join(' ')}
        // The dialog is the fallback focus target when it holds nothing focusable, so it
        // has to be programmatically focusable — and only that.
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className={styles.header}>
          <div className={styles.headings}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {description === undefined ? null : (
              <p id={descriptionId} className={styles.description}>
                {description}
              </p>
            )}
          </div>
          <IconButton
            ref={closeRef}
            aria-label="Close"
            keys="Escape"
            size="sm"
            onClick={onClose}
            icon={
              <svg viewBox="0 0 16 16" fill="none">
                <path
                  d="m4.5 4.5 7 7m0-7-7 7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            }
          />
        </div>
        <div className={styles.body}>{children}</div>
        {footer === undefined ? null : <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
