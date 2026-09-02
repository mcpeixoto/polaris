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

import { usePresence } from '~/hooks/usePresence';

import { horizontalShift, verticalShift } from './anchor';
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

/**
 * How long the group stays warm after a tip has been shown.
 *
 * The delay exists so that a pointer crossing a toolbar on its way somewhere else does not
 * pop six hints. Once one of them has actually been asked for, that argument is spent: the
 * user is reading the toolbar, and making them wait another quarter second per button
 * makes the row feel reluctant rather than careful. So the first tip is earned and every
 * one within this window of it is immediate.
 *
 * Module-level rather than a provider, deliberately. "Has a tooltip been shown recently"
 * is a fact about the pointer, not about a subtree, and a provider would have to be
 * mounted somewhere for a behaviour that has no natural boundary.
 */
const GROUP_WARM_MS = 300;

let warmUntil = 0;

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
 * It closes on Escape as well as on blur — see the note on the listener below, and on why
 * that is not a breach of the rule that web/src/keys owns the keyboard.
 *
 * The hover delay is shared across every instance rather than owned by each one. A toolbar
 * of six icon buttons crossed left to right used to cost a quarter second six times over,
 * which reads as reluctance; the first hint is earned and the rest of the group follow it
 * immediately.
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
  // Positioning settles once per appearance: the flip decides the side, the shift puts the
  // box back on screen, and neither may then argue with the other.
  const settledRef = useRef(false);
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
    settledRef.current = false;
    warmUntil = Date.now() + GROUP_WARM_MS;
    setPlacementUsed(placement);
    setVisible(true);
  };

  // The anchor point is deliberately not cleared here. It is what the tip is drawn at, and
  // the tip is still on screen for the length of its fade; dropping it would send a visible
  // element to the top-left corner of the window on its way out. The next `show` recomputes
  // it in a layout effect, before anything is painted, so nothing stale is ever seen.
  const hide = () => {
    cancelPending();
    setVisible(false);
  };

  useEffect(() => cancelPending, []);

  // A tip that vanishes the instant the pointer leaves reads as a flicker rather than as
  // something that was there. Visibility is still `visible` — the accessible description
  // below is attached to that and not to this, because a description that outlived the tip
  // by even 50ms would be a dangling reference for exactly as long.
  const { present, exitProps } = usePresence(visible, tipRef);

  useLayoutEffect(() => {
    if (!visible) return;
    const trigger = triggerRef.current;
    if (trigger === null) return;
    settledRef.current = false;
    setPoint(anchorPointFor(trigger.getBoundingClientRect(), placementUsed));
  }, [visible, placementUsed]);

  useLayoutEffect(() => {
    if (!visible || point === null || settledRef.current) return;
    const tip = tipRef.current;
    if (tip === null) return;
    const rect = tip.getBoundingClientRect();
    const flipped = flipIfClipped(rect, placementUsed);
    if (flipped !== placementUsed && !flippedRef.current) {
      // Once per appearance. A tip that is clipped on both sides would otherwise flip
      // forever, and the first choice is the one the caller asked for.
      flippedRef.current = true;
      setPlacementUsed(flipped);
      return;
    }
    settledRef.current = true;
    // The cross axis, which flipping cannot reach. A `top` tip is centred on its trigger, so
    // one on the rightmost button of a toolbar hangs half its width off the window; flipping
    // it to `bottom` moves it nowhere useful. Menu has shifted for this since it was written
    // and the tooltip simply did not, which is why the two now share the arithmetic.
    const shift =
      placementUsed === 'left' || placementUsed === 'right'
        ? verticalShift(rect)
        : horizontalShift(rect);
    if (shift === 0) return;
    setPoint(
      placementUsed === 'left' || placementUsed === 'right'
        ? { top: point.top + shift, left: point.left }
        : { top: point.top, left: point.left + shift },
    );
  }, [visible, point, placementUsed]);

  /**
   * Re-measuring while the tip is up.
   *
   * A tooltip summoned by keyboard focus can be on screen for as long as the user leaves it
   * there, and the toolbar under it moves — the list behind scrolls, a sidebar collapses,
   * the window is resized. Position is captured once at `show`, so without this the tip
   * drifts away from the control it is describing and ends up labelling something else.
   * Scroll is caught in the capture phase because the scroller is almost never the document.
   */
  useEffect(() => {
    if (!visible) return;
    const reanchor = () => {
      const trigger = triggerRef.current;
      if (trigger === null) return;
      settledRef.current = false;
      setPoint(anchorPointFor(trigger.getBoundingClientRect(), placementUsed));
    };
    window.addEventListener('scroll', reanchor, { capture: true, passive: true });
    window.addEventListener('resize', reanchor);
    return () => {
      window.removeEventListener('scroll', reanchor, { capture: true });
      window.removeEventListener('resize', reanchor);
    };
  }, [visible, placementUsed]);

  /**
   * Escape dismisses the tip, and this is a correction rather than a new feature.
   *
   * WCAG 2.1 SC 1.4.13 asks three things of content shown on hover: that it be dismissable,
   * hoverable and persistent. This surface is `pointer-events: none`, so it cannot be
   * hovered into to magnify — which makes dismissal the one of the three it can actually
   * offer, and a 44ch tip a low-vision user can neither reach nor close is the exact case
   * the criterion was written for.
   *
   * It does not breach the rule that web/src/keys owns the keyboard, for the same narrow
   * reason Menu and Modal do not: what Escape does while a surface of this component's is on
   * screen is a property of that surface. The listener exists only while one is, and the
   * press is stopped so it does not also close the dialog behind it.
   */
  useEffect(() => {
    if (!visible) return;
    // Written out rather than calling `hide`, which is a fresh closure on every render and
    // would re-subscribe this listener with it.
    const onKeyDown =
      /* keymap-lint-allow: dismisses this surface before the layer beneath it sees Escape; exists only while a tip is up */ (
        event: KeyboardEvent,
      ) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        setVisible(false);
      };
    document.addEventListener(
      /* keymap-lint-allow: see above — the tooltip's own Escape, not a shortcut */ 'keydown',
      onKeyDown,
      { capture: true },
    );
    return () =>
      document.removeEventListener(
        /* keymap-lint-allow: the pair of the listener above */ 'keydown',
        onKeyDown,
        { capture: true },
      );
  }, [visible]);

  const childProps = children.props;
  const trigger = cloneElement(children, {
    onMouseEnter: (event) => {
      childProps.onMouseEnter?.(event);
      triggerRef.current = event.currentTarget;
      cancelPending();
      // Warm: the pointer is already reading this row of controls, so the next hint is
      // immediate. Cold: it may only be passing through, and has to ask.
      if (Date.now() < warmUntil) show();
      else timerRef.current = window.setTimeout(show, delayMs);
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
      {present && point !== null
        ? createPortal(
            <div
              ref={tipRef}
              id={id}
              role="tooltip"
              className={[styles.tooltip, styles[placementUsed]].filter(Boolean).join(' ')}
              style={{ top: point.top, left: point.left }}
              {...exitProps}
            >
              {label}
              {keys === undefined ? null : <Kbd keys={keys} surface="raised" />}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
