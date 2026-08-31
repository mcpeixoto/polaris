/**
 * Motion for the marketing page, and nowhere else.
 *
 * The product itself is bound by --duration-fast: a surface that takes longer to answer
 * than the next keystroke takes to arrive feels broken. The landing page is the one
 * screen where that rule does not apply, because nobody is typing at it — they are
 * scrolling, and scrolling is the input the animation is answering. So the durations
 * here are marketing durations (0.6–1.6s) and they live on `.page` as local custom
 * properties rather than in tokens.css, where they would be a standing invitation to
 * slow down a menu.
 *
 * Five helpers, and each exists because the CSS-only version of it is either unsupported
 * or a lie:
 *
 *   useReveal    — one IntersectionObserver for the whole page, stamping `data-shown`
 *                  on every `[data-reveal]` as it arrives. `animation-timeline: view()`
 *                  does this natively and the stylesheet uses it where it can, but
 *                  Firefox has no scroll-driven animations at all, and "the page is
 *                  blank in Firefox" is not a trade worth making for one attribute.
 *   useScrolled  — whether the window has moved off the top, for the nav condense.
 *   useTypewriter— the command menu's query, retyping itself. There is no honest CSS
 *                  for changing text content.
 *   useSectionSpy— which section the reader is in, for the nav's indicator. CSS has no
 *                  way to style one element because a *different* one is on screen.
 *   useDisclosure— open/closed for the narrow-viewport menu, with the three closes a
 *                  disclosure owes: Escape, outside click, and growing past the
 *                  breakpoint. `:target` and the checkbox hack do none of the three.
 *
 * All of them are inert under `prefers-reduced-motion: reduce` or in an environment with
 * no observer (jsdom): the reveal marks everything shown immediately, the typewriter
 * holds its first phrase, and the spy reports the section it can measure. The page is
 * never left mid-animation with content the reader cannot see.
 */

import { useEffect, useRef, useState } from 'react';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Returns a ref for the page root. Every `[data-reveal]` inside it gets `data-shown`
 * the first time it crosses into view, and is then unobserved — a reveal is a one-way
 * door, because an element that fades back out as you scroll up is an element that
 * fights the reader for control of the page.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = root.querySelectorAll<HTMLElement>('[data-reveal]');

    // No observer (jsdom, or a browser old enough not to have one) means no reveal, not
    // an invisible page.
    if (typeof IntersectionObserver === 'undefined') {
      for (const target of targets) target.dataset.shown = '';
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.shown = '';
          observer.unobserve(entry.target);
        }
      },
      // Fire when the element's top has passed 88% of the viewport rather than at the
      // very edge: an element that begins moving the instant its first pixel appears has
      // finished before the reader has looked at it.
      { rootMargin: '0px 0px -12% 0px', threshold: 0 },
    );

    for (const target of targets) observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, []);

  return ref;
}

/** True once the window has scrolled past `after` pixels. Drives the nav condense. */
export function useScrolled(after = 6): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > after);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, [after]);

  return scrolled;
}

/**
 * Types a phrase, holds it, erases it, moves to the next. Returns the current cut.
 *
 * `phrases` must be a module-level constant: it is an effect dependency, and a fresh
 * array every render would restart the loop on every tick of its own output.
 */
export function useTypewriter(phrases: readonly string[]): string {
  const [text, setText] = useState(phrases[0] ?? '');

  useEffect(() => {
    if (prefersReducedMotion() || phrases.length < 2) return;

    let index = 0;
    let cut = phrases[0]?.length ?? 0;
    let mode: 'hold' | 'erase' | 'type' = 'hold';
    let timer = 0;

    const step = () => {
      let delay: number;
      switch (mode) {
        case 'hold':
          mode = 'erase';
          delay = 1900;
          break;
        case 'erase':
          cut = Math.max(0, cut - 1);
          delay = 26;
          if (cut === 0) {
            index = (index + 1) % phrases.length;
            mode = 'type';
            delay = 260;
          }
          break;
        default: {
          const full = phrases[index] ?? '';
          cut = Math.min(full.length, cut + 1);
          delay = 54;
          if (cut === full.length) mode = 'hold';
          break;
        }
      }
      setText((phrases[index] ?? '').slice(0, cut));
      timer = window.setTimeout(step, delay);
    };

    timer = window.setTimeout(step, 1400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [phrases]);

  return text;
}

/**
 * Which of `ids` is the section the reader is currently looking at, or `null` above the
 * first one. Drives the nav's indicator, so the header says where you are rather than
 * only where you could go.
 *
 * The naive version — mark whatever is intersecting — flickers: at most viewport heights
 * two sections are on screen at once and they trade the highlight on every scroll tick.
 * This one keeps the *last* section whose top has passed a line a third of the way down
 * the viewport, which is monotonic in scroll position and therefore cannot oscillate.
 *
 * It reads geometry on a scroll listener rather than through an IntersectionObserver
 * because the answer depends on the ordering of all the sections at once, not on any one
 * of them crossing an edge — the observer version needs the same full pass on every entry
 * and buys nothing. `ids` must be a module-level constant: it is an effect dependency.
 */
export function useSectionSpy(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let frame = 0;

    const measure = () => {
      frame = 0;
      const line = window.innerHeight * 0.34;
      let found: string | null = null;
      for (const id of ids) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top === undefined || top > line) continue;
        found = id;
      }
      // The last section can be too short to ever reach the line on a tall viewport, so
      // it would never light up. At the bottom of the document it is the answer whatever
      // the geometry says.
      const atEnd = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
      setActive(atEnd ? (ids[ids.length - 1] ?? found) : found);
    };

    /*
     * One measurement per frame. Scroll fires many times a frame and measure reads layout
     * on every section, so the coalescing is not optional.
     *
     * Cancel-and-reschedule rather than the usual `if (frame === 0)` latch. The two are
     * identical in a tab that is painting; they differ in one that is not, because
     * requestAnimationFrame does not run in a background tab and the latch is only cleared
     * from inside the callback. Under the latch a hidden tab accumulates one pending
     * measurement and discards every scroll after it, so what lands when the tab comes
     * back is the geometry of whatever frame the browser chooses to serve. Cancelling
     * first keeps exactly one pending callback either way and holds no state that can be
     * left set.
     */
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    // Deferred rather than measured inline, because an effect runs before the browser has
    // necessarily finished laying the page out: measuring here can find every section
    // stacked near the top and light up the first link for a frame.
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [ids]);

  return active;
}

/**
 * A boolean that closes itself.
 *
 * The mobile nav is a disclosure and disclosures are where accessibility bugs live, so
 * the three obligations are met here once rather than in the markup: Escape closes it,
 * a click outside closes it, and a viewport that grows past the breakpoint closes it —
 * otherwise the panel stays mounted, invisible, holding focus, over a desktop layout that
 * has its own visible links.
 *
 * `ref` goes on the element that counts as "inside", which is the whole header rather
 * than the panel: the toggle button must not be an outside click, or the button would
 * close the panel and reopen it in the same gesture.
 */
export function useDisclosure(breakpoint = 900) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: Event) => {
      // `as Node` rather than an `instanceof` guard: the header contains an inline SVG,
      // whose elements are SVGElement and not HTMLElement, and a guard that missed them
      // would treat a click on the logo as a click outside.
      const target = event.target as Node | null;
      if (target !== null && ref.current?.contains(target)) return;
      setOpen(false);
    };
    // Guarded the same way useTypewriter guards its own query: jsdom has no matchMedia at
    // all, and the two closes above are the ones that matter — an environment without
    // media queries is not one where the viewport is about to cross a breakpoint.
    const wide =
      typeof window.matchMedia === 'function'
        ? window.matchMedia(`(min-width: ${breakpoint + 1}px)`)
        : null;
    const onWide = () => {
      if (wide?.matches) setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    wide?.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      wide?.removeEventListener('change', onWide);
    };
  }, [open, breakpoint]);

  return { open, setOpen, ref };
}
