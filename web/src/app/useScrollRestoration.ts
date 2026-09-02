/**
 * Putting a screen back where it was when you left it.
 *
 * The shell keys its view container on the pathname, which is what lets a route change be a
 * mount and therefore have an entrance — and the cost of that is that every navigation
 * discards every scroll offset in it. Open an issue from row four hundred of a list, press
 * Back, and you are at row one, which is the single most reliable way to make somebody stop
 * using the keyboard and start using the mouse.
 *
 * Keyed on `location.key` rather than on the pathname. The two differ exactly where it
 * matters: going Back to a list is the *same* path as the visit before it but a different
 * entry in the history stack, and it is the entry's offset that should be restored. Two tabs
 * open on one path have two keys and two offsets, and a fresh navigation to a path visited
 * an hour ago correctly starts at the top.
 *
 * The map is module-level and unbounded within a session, which is affordable: an entry is a
 * short string and a number, and the whole thing goes when the document does. Persisting it
 * would be a mistake rather than an improvement — a stored offset outlives the list that
 * justified it, and restoring row four hundred of a list that now has nine rows is worse
 * than starting at the top.
 */

import { useLayoutEffect, type RefObject } from 'react';

const offsets = new Map<string, number>();

/**
 * Which element inside the view actually scrolls.
 *
 * Not the container itself: `.view` is `overflow: hidden`, and every screen in the product
 * is written as a flex column that owns its own scrolling somewhere inside. So the scroller
 * is found rather than assumed — the first descendant that both overflows and is allowed to
 * scroll — and the container is the fallback for the screens that scroll themselves.
 *
 * `getComputedStyle` rather than a class or a data attribute, because the screens belong to
 * the views layer and a shell that required them to mark their scroller would be a shell
 * that silently stops working for the one somebody forgot to mark.
 */
function scrollerIn(root: HTMLElement): HTMLElement {
  const candidates = root.querySelectorAll<HTMLElement>('*');
  for (const element of candidates) {
    if (element.scrollHeight <= element.clientHeight) continue;
    const overflow = getComputedStyle(element).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return element;
  }
  return root;
}

/**
 * Saves the view's scroll offset on the way out and restores it on the way in.
 *
 * The restore is a layout effect so it lands before the browser paints — restoring in a
 * passive effect shows the top of the list for one frame and then jumps, which reads as the
 * page having been scrolled *for* you rather than as never having left.
 *
 * A screen whose rows arrive after mount — a virtualised list, or anything waiting on a
 * query — cannot be scrolled to an offset that does not exist yet, so the attempt is
 * repeated once on the next frame. Once, and not a retry loop: a second frame covers the
 * ordinary case of content that renders synchronously from the replica, and anything slower
 * than that is a screen the user has already started reading.
 */
export function useScrollRestoration(
  ref: RefObject<HTMLElement | null>,
  key: string | undefined,
): void {
  useLayoutEffect(() => {
    const root = ref.current;
    if (root === null || key === undefined) return;

    const saved = offsets.get(key);
    if (saved !== undefined && saved > 0) {
      scrollerIn(root).scrollTop = saved;
      const frame = requestAnimationFrame(() => {
        const scroller = scrollerIn(root);
        if (scroller.scrollTop < saved) scroller.scrollTop = saved;
      });
      // The cleanup below runs on unmount, by which time the frame has long fired; cancelling
      // matters for the navigation that lands and leaves inside one frame, which redirects do.
      return () => {
        cancelAnimationFrame(frame);
        offsets.set(key, scrollerIn(root).scrollTop);
      };
    }

    // React runs an effect's cleanup before it detaches the tree, so the element is still
    // measurable here. Reading it any later would read zero off a node nobody can see.
    return () => {
      offsets.set(key, scrollerIn(root).scrollTop);
    };
  }, [ref, key]);
}

/** For tests, and for the moments a session's history stops meaning anything. */
export function clearScrollRestoration(): void {
  offsets.clear();
}
