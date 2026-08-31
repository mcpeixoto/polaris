import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useSectionSpy } from './landingMotion';

/**
 * The scroll spy decides which nav link is lit, and every one of its interesting cases is
 * a geometry it is hard to get a browser into on purpose: two sections on screen at once,
 * a final section too short to reach the line, a scroll that arrives while frames are
 * suspended. jsdom has no layout, which here is the point — the rects are stated outright
 * and the hook is tested against them.
 */

const IDS = ['product', 'keyboard', 'sync', 'self-host'] as const;

/** Places the four sections at the given viewport-relative tops and lays out a page. */
function place(tops: Record<string, number>, { pageHeight = 4000, scrollY = 0 } = {}) {
  for (const id of IDS) {
    const section = document.createElement('section');
    section.id = id;
    section.getBoundingClientRect = () =>
      ({ top: tops[id] ?? 0 }) as ReturnType<Element['getBoundingClientRect']>;
    document.body.append(section);
  }
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true });
  Object.defineProperty(document.body, 'scrollHeight', { value: pageHeight, configurable: true });
}

/** Fires a scroll and lets the hook's one-per-frame measurement land. */
async function scroll() {
  await act(async () => {
    window.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        resolve(null);
      });
    });
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useSectionSpy', () => {
  it('lights the last section whose top has passed the line, not the first on screen', async () => {
    // Two sections are on screen at once — keyboard has crossed the line at 272px, sync has
    // not. The reader is in keyboard.
    place({ product: -1800, keyboard: 100, sync: 600, 'self-host': 1400 });
    const { result } = renderHook(() => useSectionSpy(IDS));
    await scroll();
    expect(result.current).toBe('keyboard');
  });

  it('lights nothing above the first section', async () => {
    place({ product: 700, keyboard: 1500, sync: 2300, 'self-host': 3100 });
    const { result } = renderHook(() => useSectionSpy(IDS));
    await scroll();
    expect(result.current).toBeNull();
  });

  it('lights the last section at the bottom of the page, however short it is', async () => {
    // self-host is 60px tall at the very end of a page: its top never reaches the line, so
    // the geometry alone would leave sync lit while the reader stares at self-host.
    place({ product: -3000, keyboard: -2000, sync: -900, 'self-host': 740 }, { scrollY: 3200 });
    const { result } = renderHook(() => useSectionSpy(IDS));
    await scroll();
    expect(result.current).toBe('self-host');
  });

  /**
   * measure() reads a rect off every section, and scroll fires many times a frame. Without
   * the coalescing this is a layout read per event, which is the classic way to make a
   * page that scrolls at 20fps on a trackpad — and it is invisible in every other test
   * here, because they all end at the right answer either way.
   */
  it('measures once for a burst of scrolls, not once per scroll', async () => {
    let reads = 0;
    place({ product: -1800, keyboard: 100, sync: 600, 'self-host': 1400 });
    for (const section of document.querySelectorAll('section')) {
      const tops: Record<string, number> = {
        product: -1800,
        keyboard: 100,
        sync: 600,
        'self-host': 1400,
      };
      section.getBoundingClientRect = () => {
        reads += 1;
        return { top: tops[section.id] ?? 0 } as ReturnType<Element['getBoundingClientRect']>;
      };
    }

    const { result } = renderHook(() => useSectionSpy(IDS));
    act(() => {
      for (let i = 0; i < 20; i += 1) window.dispatchEvent(new Event('scroll'));
    });
    await scroll();

    expect(result.current).toBe('keyboard');
    // One pass over four sections, plus the mount measurement's own pass.
    expect(reads).toBeLessThanOrEqual(IDS.length * 2);
  });
});
