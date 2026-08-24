/**
 * Keeping a surface on screen long enough for it to leave.
 *
 * Every floating surface in this product unmounts with `if (!open) return null`, which is
 * correct for everything except the one frame it matters: the frame the user asked for it to
 * go away. #118 gave all of them an entrance and could not give them an exit, because an
 * exit is not a stylesheet change — it is the node outliving the state that justified it.
 * This hook is that extra life, and nothing else.
 *
 * The bargain it makes is deliberately narrow. `open` still means what it always meant, and
 * every effect that keys on it — focus restore, the outside-click listener, the scroll lock
 * — still fires the instant it flips. Only the DOM node is held back. A caller therefore
 * never has to think about whether the surface is "sort of still open": it is not, it is
 * merely still visible, and the two are different facts with different names.
 *
 * ## The node it leaves behind is inert, and that is the whole safety story
 *
 * For as long as `exiting` is true there is a fully rendered dialog lying over the page that
 * the user believes they have already dismissed. If it can be clicked, Tab can reach it, or
 * a screen reader still reads it, then this hook has traded a hard cut for a haunting. So
 * `exitProps` carries `inert`, which in one attribute removes the subtree from the tab
 * order, from hit-testing and from the accessibility tree, and `data-exiting`, which
 * styles/motion.css uses to take pointer-events away a second time. Two mechanisms for one
 * guarantee is not redundancy here; `inert` is the load-bearing one and the stylesheet is
 * the one that still holds if a surface ever forgets to spread these props.
 *
 * Focus is then pushed out by hand rather than left to `inert`, and the reason is worth
 * stating because it looks redundant. React captures whatever was focused at the start of a
 * commit and re-focuses it at the end, so that a re-render does not silently drop the
 * caret — and that is exactly the wrong instinct here. The element it captured is a button
 * inside a dialog the user has just dismissed, and it is still connected, because holding it
 * is this hook's entire job. A browser honouring `inert` blunts the restore on its own, since
 * focusing an inert element does nothing. Where `inert` is not implemented, React succeeds,
 * and the surface leaves with the keyboard still inside it.
 *
 * So the blur below is not a fallback, it is the definition: an exiting surface hands focus
 * back to the document, which is precisely the state the hard unmount it replaces used to
 * produce. Every component that restores focus to its trigger already tests for that state,
 * and goes on working without knowing this hook exists — provided it restores from a passive
 * effect, which runs after this one. Modal is the one that had to move.
 *
 * ## Timing comes from the stylesheet, never from here
 *
 * The unmount is scheduled from the element's own computed `animation-duration`. That means
 * the number lives in exactly one place — the CSS that draws the exit — and a designer
 * changing an exit from one token to another does not have to know this file exists. It also
 * means the reduced-motion collapse in tokens.css is inherited for free: the token becomes
 * 1ms, the computed duration reads 1ms, and the surface is gone in a millisecond.
 *
 * When the computed duration is zero — no stylesheet at all, which is every jsdom test in
 * the suite — the unmount happens synchronously inside this layout effect, before the
 * browser has painted. Under vitest this hook is thus a no-op by construction, and the
 * component behaves exactly as it did before it existed.
 *
 * `animationend` ends it early and a timer ends it regardless. The timer is not paranoia: an
 * element that is display:none, or inside a tab that was backgrounded mid-exit, has a
 * non-zero declared duration and an animation that never fires. Waiting on the event alone
 * would strand the node on the page forever.
 */

import { useLayoutEffect, useState, type RefObject } from 'react';

/** Props for the surface's outermost node. See the note on inertness above. */
export interface ExitProps {
  readonly 'data-exiting'?: '';
  readonly inert?: boolean;
}

export interface Presence {
  /** Whether the surface belongs in the DOM at all. Replaces the `open` in `if (!open)`. */
  readonly present: boolean;
  /**
   * Spread onto the outermost node the surface renders.
   *
   * There is deliberately no `exiting` boolean beside it. Callers do not need to branch on
   * the state — the stylesheet keys on `data-exiting` and `inert` covers the rest — and
   * offering one would invite a component to start behaving differently on its way out,
   * which is the class of bug this whole file exists to avoid.
   */
  readonly exitProps: ExitProps;
}

const STAYING: ExitProps = {};
const LEAVING: ExitProps = { 'data-exiting': '', inert: true };

/**
 * The longest time in a computed CSS time list, in milliseconds.
 *
 * A list, because `animation-duration` is per-animation and a surface may grow a second one.
 * Anything unparseable counts as zero, which fails towards unmounting immediately rather
 * than towards a node that never leaves.
 */
function longestMs(list: string | undefined): number {
  if (list === undefined || list === '') return 0;
  let longest = 0;
  for (const part of list.split(',')) {
    const raw = part.trim();
    const value = raw.endsWith('ms')
      ? Number.parseFloat(raw)
      : raw.endsWith('s')
        ? Number.parseFloat(raw) * 1000
        : Number.NaN;
    if (Number.isFinite(value) && value > longest) longest = value;
  }
  return longest;
}

/**
 * How long the node has asked to stay, read from the exit that is now applied to it.
 *
 * Delay is included because a delayed exit is still an exit; nothing in this product uses
 * one, and the day something does, it will not need to remember to tell this file.
 */
function exitDurationMs(node: HTMLElement): number {
  const style = window.getComputedStyle(node);
  return longestMs(style.animationDuration) + longestMs(style.animationDelay);
}

/**
 * @param open  What the product thinks. Unchanged in meaning, and still the right thing for
 *              every effect that is not about pixels to depend on.
 * @param ref   The node the exit is drawn on — the same node `exitProps` is spread onto.
 */
export function usePresence(open: boolean, ref: RefObject<HTMLElement | null>): Presence {
  const [present, setPresent] = useState(open);

  // A render-phase update, which is the documented way to derive state from props without
  // paying a second commit. Opening has to be immediate: a surface that appeared one frame
  // after its keystroke would have traded the problem this hook solves for its mirror image.
  if (open && !present) setPresent(true);

  const exiting = present && !open;

  useLayoutEffect(() => {
    if (!exiting) return;
    const node = ref.current;
    if (node === null) {
      setPresent(false);
      return;
    }

    // After React's own focus restore, which is why this is a layout effect. See the note
    // above: a surface on its way out does not get to keep the keyboard.
    const active = document.activeElement;
    if (active instanceof HTMLElement && node.contains(active)) active.blur();

    const duration = exitDurationMs(node);
    if (duration <= 0) {
      setPresent(false);
      return;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setPresent(false);
    };
    // Only this element's own animation. `animationend` bubbles, and a surface full of rows
    // that ramp on hover would otherwise be unmounted by one of its children finishing.
    const onEnd = (event: AnimationEvent) => {
      if (event.target === node) finish();
    };
    node.addEventListener('animationend', onEnd);
    const timer = window.setTimeout(finish, duration + 50);
    return () => {
      node.removeEventListener('animationend', onEnd);
      window.clearTimeout(timer);
    };
  }, [exiting, ref]);

  return { present, exitProps: exiting ? LEAVING : STAYING };
}
