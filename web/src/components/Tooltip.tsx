import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEventHandler,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { Kbd } from './Kbd';
import styles from './Tooltip.module.css';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

/**
 * What Tooltip needs to be able to attach to its child. Anything that renders a DOM
 * element and passes its props through satisfies it, which is every control in this
 * directory.
 */
interface TriggerProps {
  onMouseEnter?: MouseEventHandler<HTMLElement> | undefined;
  onMouseLeave?: MouseEventHandler<HTMLElement> | undefined;
  onMouseDown?: MouseEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
  'aria-describedby'?: string | undefined;
}

export interface TooltipProps {
  /** The tip itself. Sentence case, no trailing period — it is a label, not a sentence. */
  label: ReactNode;
  /** A key spec, drawn as a hint beside the label. See Kbd. */
  keys?: string | undefined;
  placement?: TooltipPlacement | undefined;
  /** How long the pointer must rest before the tip appears. Keyboard focus is exempt. */
  delayMs?: number | undefined;
  /**
   * Whether to attach the tip to the trigger as its accessible description. Turn it off
   * when the trigger's accessible name already says the same words — an IconButton
   * labelled "Archive" with a tooltip reading "Archive" would otherwise be announced twice.
   */
  describe?: boolean | undefined;
  children: ReactElement<TriggerProps>;
}

interface Point {
  readonly top: number;
  readonly left: number;
}

/** A rest of a quarter second is long enough to be a decision and short enough not to nag. */
const DEFAULT_DELAY_MS = 250;

function anchorPointFor(rect: DOMRect, placement: TooltipPlacement): Point {
  switch (placement) {
    case 'top':
      return { top: rect.top, left: rect.left + rect.width / 2 };
    case 'bottom':
      return { top: rect.bottom, left: rect.left + rect.width / 2 };
    case 'left':
      return { top: rect.top + rect.height / 2, left: rect.left };
    case 'right':
      return { top: rect.top + rect.height / 2, left: rect.right };
  }
}

/**
 * The flip decision is taken from the tooltip's *rendered* rect, after the transform and
 * the margin in the stylesheet have been applied. Recomputing the geometry here instead
 * would mean this file knowing the offset that the CSS owns, and the two drifting apart the
 * first time someone adjusts the spacing.
 */
function flipIfClipped(rect: DOMRect, placement: TooltipPlacement): TooltipPlacement {
  switch (placement) {
    case 'top':
      return rect.top < 0 ? 'bottom' : 'top';
    case 'bottom':
      return rect.bottom > window.innerHeight ? 'top' : 'bottom';
    case 'left':
      return rect.left < 0 ? 'right' : 'left';
    case 'right':
      return rect.right > window.innerWidth ? 'left' : 'right';
  }
}

/**
 * Tooltip explains a control that cannot afford a visible label — which in a tracker this
 * dense is most of the toolbar.
 *
 * It appears on keyboard focus as well as on hover, and that is not a courtesy: in a
 * product whose primary interface is the keyboard, a hint that only pointers can reach is a
 * hint the intended audience never sees. Focus shows it immediately while hover waits out a
 * delay, because a pointer crossing a toolbar passes over controls it is not asking about,
 * whereas focus landing on one is a deliberate act.
 *
 * The tip renders through a portal into document.body. Toolbars, list rows and popovers all
 * clip their overflow, and a tooltip is by definition larger than the thing it describes.
 *
 * It deliberately does not close on Escape. Keyboard handling in this product belongs to
 * web/src/keys, and blur already covers the case that matters — the tip lives exactly as
 * long as the focus that summoned it.
 */
export function Tooltip({
  label,
  keys,
  placement = 'top',
  delayMs = DEFAULT_DELAY_MS,
  describe = true,
  children,
}: TooltipProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [point, setPoint] = useState<Point | null>(null);
  const [placementUsed, setPlacementUsed] = useState<TooltipPlacement>(placement);

  const triggerRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const flippedRef = useRef(false);
  // A pointer press focuses what it presses. Without this, clicking a button would pop its
  // own tooltip open on the way down, over the thing the click just did.
  const pointerPressRef = useRef(false);

  const cancelPending = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const show = () => {
    cancelPending();
    flippedRef.current = false;
    setPlacementUsed(placement);
    setVisible(true);
  };

  const hide = () => {
    cancelPending();
    setVisible(false);
    setPoint(null);
  };

  useEffect(() => cancelPending, []);

  useLayoutEffect(() => {
    if (!visible) return;
    const trigger = triggerRef.current;
    if (trigger === null) return;
    setPoint(anchorPointFor(trigger.getBoundingClientRect(), placementUsed));
  }, [visible, placementUsed]);

  useLayoutEffect(() => {
    if (!visible || point === null || flippedRef.current) return;
    const tip = tipRef.current;
    if (tip === null) return;
    const flipped = flipIfClipped(tip.getBoundingClientRect(), placementUsed);
    if (flipped === placementUsed) return;
    // Once per appearance. A tip that is clipped on both sides would otherwise flip
    // forever, and the first choice is the one the caller asked for.
    flippedRef.current = true;
    setPlacementUsed(flipped);
  }, [visible, point, placementUsed]);

  const childProps = children.props;
  const trigger = cloneElement(children, {
    onMouseEnter: (event) => {
      childProps.onMouseEnter?.(event);
      triggerRef.current = event.currentTarget;
      cancelPending();
      timerRef.current = window.setTimeout(show, delayMs);
    },
    onMouseLeave: (event) => {
      childProps.onMouseLeave?.(event);
      pointerPressRef.current = false;
      hide();
    },
    onMouseDown: (event) => {
      childProps.onMouseDown?.(event);
      pointerPressRef.current = true;
      hide();
    },
    onFocus: (event) => {
      childProps.onFocus?.(event);
      if (pointerPressRef.current) return;
      triggerRef.current = event.currentTarget;
      show();
    },
    onBlur: (event) => {
      childProps.onBlur?.(event);
      pointerPressRef.current = false;
      hide();
    },
    // Attached only while the tip exists: an aria-describedby pointing at nothing is a
    // dangling reference that some screen readers report as an error.
    'aria-describedby': visible
      ? [childProps['aria-describedby'], describe ? id : null].filter(Boolean).join(' ')
      : childProps['aria-describedby'],
  } satisfies TriggerProps);

  return (
    <>
      {trigger}
      {visible && point !== null
        ? createPortal(
            <div
              ref={tipRef}
              id={id}
              role="tooltip"
              className={[styles.tooltip, styles[placementUsed]].filter(Boolean).join(' ')}
              style={{ top: point.top, left: point.left }}
            >
              {label}
              {keys === undefined ? null : <Kbd keys={keys} className={styles.keys} />}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
