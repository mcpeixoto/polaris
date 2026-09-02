/**
 * Putting a screen back where it was.
 *
 * The shell keys its view container on the pathname so a route change is a mount, and the
 * price of that is that every navigation throws away every scroll offset in it: open an
 * issue from row four hundred, press Back, and you are at row one.
 *
 * Keyed on `location.key` rather than on the path, which is the part worth pinning down —
 * the two differ exactly where it matters. Going back to a list is the same path as the
 * visit before it and a different history entry, and it is the entry's offset that should
 * come back; a fresh navigation to a path visited an hour ago should start at the top.
 */

import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearScrollRestoration, useScrollRestoration } from './useScrollRestoration';

/**
 * jsdom lays nothing out, so every element measures zero and the hook would find no scroller
 * anywhere. Overflow is what it actually branches on; the measurements are stood in for on
 * the prototype so that "does this element overflow" stops being the question that decides
 * every case in this file.
 */
const descriptors = {
  scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight'),
  clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'),
};

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, value: 4000 });
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, value: 100 });
});

afterEach(() => {
  clearScrollRestoration();
  if (descriptors.scrollHeight) {
    Object.defineProperty(Element.prototype, 'scrollHeight', descriptors.scrollHeight);
  }
  if (descriptors.clientHeight) {
    Object.defineProperty(Element.prototype, 'clientHeight', descriptors.clientHeight);
  }
});

/** The shape every screen has: `.view` clips, and the scrolling happens somewhere below it. */
function Screen({ historyKey }: { historyKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollRestoration(ref, historyKey);
  return (
    <div ref={ref} data-testid="view">
      <div data-testid="scroller" style={{ overflowY: 'auto' }} />
    </div>
  );
}

/** The other shape: a screen that scrolls as one box, with nothing to find inside it. */
function BareScreen({ historyKey }: { historyKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollRestoration(ref, historyKey);
  return <div ref={ref} data-testid="view" />;
}

describe('scroll restoration', () => {
  it('gives an entry back the offset it was left at', () => {
    const first = render(<Screen historyKey="entry-1" />);
    first.getByTestId('scroller').scrollTop = 1200;
    first.unmount();

    const second = render(<Screen historyKey="entry-1" />);
    expect(second.getByTestId('scroller').scrollTop).toBe(1200);
  });

  it('starts a different history entry at the top, even on the same screen', () => {
    const first = render(<Screen historyKey="entry-1" />);
    first.getByTestId('scroller').scrollTop = 1200;
    first.unmount();

    // A fresh navigation rather than a Back: the same component, a new entry, and no reason
    // to land somebody four hundred rows down a list they have just arrived at.
    const second = render(<Screen historyKey="entry-2" />);
    expect(second.getByTestId('scroller').scrollTop).toBe(0);
  });

  it('falls back to the view itself when the screen scrolls as one box', () => {
    const first = render(<BareScreen historyKey="entry-3" />);
    first.getByTestId('view').scrollTop = 640;
    first.unmount();

    const second = render(<BareScreen historyKey="entry-3" />);
    expect(second.getByTestId('view').scrollTop).toBe(640);
  });
});
