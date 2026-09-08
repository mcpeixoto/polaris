import { useRef, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Menu, type MenuNode } from './Menu';

/**
 * A menu is drawn in viewport coordinates, and the viewport does not hold still: the issue
 * list scrolls under an open status picker, the window is resized, a sync delta reflows the
 * row the picker is anchored to. Measuring once on open and never again leaves the panel
 * floating where the trigger used to be.
 */

const ITEMS: MenuNode[] = [{ id: 'todo', label: 'Todo', onSelect: () => {} }];

function Picker({ stopPointerDown = false }: { stopPointerDown?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger} onClick={() => setOpen(true)}>
        Status
      </button>
      {/* A row that swallows pointerdown, which is what issue rows and drag handles do. */}
      <div onPointerDown={(event) => stopPointerDown && event.stopPropagation()}>
        <button>Elsewhere</button>
      </div>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        trigger={trigger}
        items={ITEMS}
        label="Status"
      />
    </>
  );
}

/**
 * A picker anchored to a row rather than to a control of its own, and a row that can go away
 * underneath it.
 *
 * The anchor is captured on click into a ref this component owns and deliberately does not
 * clear when the row unmounts — which is exactly what `useMenuTrigger`'s `showFrom` does,
 * and what a virtualised list does to it: scroll far enough with the status picker open and
 * the glyph it hangs off is recycled out of the DOM while the menu is still on screen.
 */
function RecycledRowPicker({ row = true }: { row?: boolean }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLElement | null>(null);
  return (
    <>
      {row ? (
        <button
          onClick={(event) => {
            anchor.current = event.currentTarget;
            setOpen(true);
          }}
        >
          Row status
        </button>
      ) : null}
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        trigger={anchor}
        items={ITEMS}
        label="Status"
      />
    </>
  );
}

/** The panel's own positioned wrapper, which is what carries the measured coordinates. */
function surfaceStyle(): CSSStyleDeclaration {
  const menu = screen.getByRole('menu', { name: 'Status' });
  const surface = menu.closest('[style]');
  if (!(surface instanceof HTMLElement)) throw new Error('no positioned surface');
  return surface.style;
}

describe('Menu anchoring', () => {
  it('re-anchors when an ancestor scrolls and when the window resizes', async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const trigger = screen.getByRole('button', { name: 'Status' });

    let top = 120;
    vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(
      () => ({ top, bottom: top + 28, left: 40, right: 140, width: 100, height: 28 }) as DOMRect,
    );

    await user.click(trigger);
    expect(surfaceStyle().top).toBe('148px');

    // A scroll on an inner element, which does not bubble — the listener has to capture.
    top = 60;
    await act(async () => {
      screen.getByText('Elsewhere').dispatchEvent(new Event('scroll', { bubbles: false }));
    });
    expect(surfaceStyle().top).toBe('88px');

    top = 200;
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(surfaceStyle().top).toBe('228px');
  });

  it('still closes on an outside press that stops propagation', async () => {
    const user = userEvent.setup();
    render(<Picker stopPointerDown />);

    await user.click(screen.getByRole('button', { name: 'Status' }));
    expect(screen.getByRole('menu', { name: 'Status' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));

    expect(screen.queryByRole('menu', { name: 'Status' })).toBeNull();
  });

  it('holds its last measured point when the trigger leaves the document', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RecycledRowPicker />);
    const row = screen.getByRole('button', { name: 'Row status' });

    let rect = { top: 300, bottom: 328, left: 40, right: 140, width: 100, height: 28 } as DOMRect;
    vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => rect);

    await user.click(row);
    expect(surfaceStyle().top).toBe('328px');

    // The row is recycled. The menu is still up, and still hanging off a node that is now
    // detached — which is the state `isConnected` exists to notice.
    rerender(<RecycledRowPicker row={false} />);
    expect(screen.getByRole('menu', { name: 'Status' })).toBeTruthy();

    // A detached node answers getBoundingClientRect with zeros rather than refusing, so a
    // re-anchor that only checked for `null` would sail through and fling the panel into the
    // top-left corner of the window while the user was reading it.
    rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
    });

    expect(surfaceStyle().top).toBe('328px');
  });

  it('pulls itself back on screen when the trigger has been scrolled out of view', async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const trigger = screen.getByRole('button', { name: 'Status' });

    // The rail of an issue with a long comment thread, scrolled past: the trigger is six
    // hundred pixels above the top of the window, so the menu is placed there too.
    vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(
      () => ({ top: -600, bottom: -572, left: 40, right: 140, width: 100, height: 28 }) as DOMRect,
    );

    // What the surface reports once it has been drawn at that point. It is not clipped by an
    // edge — it is wholly above the viewport, which is the case the flip cannot answer.
    const offscreen = {
      top: -572,
      bottom: -297,
      left: 40,
      right: 240,
      width: 200,
      height: 275,
    } as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.querySelector('[role="menu"]') === null
        ? ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect)
        : offscreen;
    });

    await user.click(trigger);

    // Back inside the window, at the margin every rescued surface is held off the edge by,
    // rather than at -572 where the keystroke would have looked like it did nothing.
    expect(surfaceStyle().top).toBe('8px');
  });

  it('pulls itself down when only its first rows are above the top edge', async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const trigger = screen.getByRole('button', { name: 'Status' });

    // The expensive half of this bug: the trigger is just above the fold, so most of the
    // menu is on screen and only the rows at the top of it are not. It looks present, it
    // satisfies "is the menu visible", and the row somebody wants cannot be clicked.
    vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(
      () => ({ top: -88, bottom: -60, left: 40, right: 140, width: 100, height: 28 }) as DOMRect,
    );

    const clipped = {
      top: -60,
      bottom: 215,
      left: 40,
      right: 240,
      width: 200,
      height: 275,
    } as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.querySelector('[role="menu"]') === null
        ? ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect)
        : clipped;
    });

    await user.click(trigger);

    // Moved down by the 68px that puts its first row at the margin, not left at -60 with
    // the top of the list unreachable.
    expect(surfaceStyle().top).toBe('8px');
  });
});
