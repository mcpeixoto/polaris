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
 * Three helpers, and each exists because the CSS-only version of it is either
 * unsupported or a lie:
 *
 *   useReveal    — one IntersectionObserver for the whole page, stamping `data-shown`
 *                  on every `[data-reveal]` as it arrives. `animation-timeline: view()`
 *                  does this natively and the stylesheet uses it where it can, but
 *                  Firefox has no scroll-driven animations at all, and "the page is
 *                  blank in Firefox" is not a trade worth making for one attribute.
 *   useScrolled  — whether the window has moved off the top, for the nav condense.
 *   useTypewriter— the command menu's query, retyping itself. There is no honest CSS
 *                  for changing text content.
 *
 * All three are inert under `prefers-reduced-motion: reduce` or in an environment with
 * no observer (jsdom): the reveal marks everything shown immediately, and the
 * typewriter holds its first phrase. The page is never left mid-animation with content
 * the reader cannot see.
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
