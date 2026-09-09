import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useContextMenu } from './useContextMenu';

/**
 * The two things this hook is for are the two that are invisible when broken: an anchor with
 * a real box for the menu to measure, and the keyboard landing back on the list rather than
 * on `<body>` when the menu goes away.
 */

afterEach(cleanup);

function Host({ onOpen }: { onOpen?: (id: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const menu = useContextMenu<string>({ onOpen, returnFocusTo: scroller });
  return (
    <div>
      <div ref={scroller} tabIndex={-1} data-testid="scroller">
        <button
          type="button"
          onContextMenu={(event) => {
            event.preventDefault();
            menu.openAt(120, 40, 'row-1');
          }}
        >
          row
        </button>
      </div>
      {menu.at === null ? null : (
        <div data-testid="anchor" {...menu.anchorProps}>
          <output>{menu.id}</output>
        </div>
      )}
      <button type="button" onClick={menu.close}>
        close
      </button>
    </div>
  );
}

describe('useContextMenu', () => {
  it('places a positioned anchor at the pointer and names what was clicked', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<Host onOpen={onOpen} />);

    expect(screen.queryByTestId('anchor')).toBeNull();

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'row' }),
    });

    const anchor = screen.getByTestId('anchor');
    expect(anchor.style.position).toBe('fixed');
    expect(anchor.style.left).toBe('120px');
    expect(anchor.style.top).toBe('40px');
    // A measurable box, not `hidden`: a hidden element has no rectangle and the menu would
    // place itself in the corner.
    expect(anchor.style.width).toBe('1px');
    expect(anchor.style.height).toBe('1px');
    expect(onOpen).toHaveBeenCalledWith('row-1');
    expect(screen.getByRole('status').textContent).toBe('row-1');
  });

  it('closes and hands the keyboard back to the list a frame later', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'row' }),
    });

    await user.click(screen.getByRole('button', { name: 'close' }));

    expect(screen.queryByTestId('anchor')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('scroller')));
  });
});

/**
 * The keyboard's way in, and the three gestures it must not be confused with.
 *
 * A browser sends a real `contextmenu` event for Shift+F10 and the Menu key, with
 * coordinates that were never taken from a pointer. The obvious way to spot that is `detail`,
 * and it is wrong: measured in Chrome, a genuine right-click reports `detail: 0` exactly like
 * the keyboard does. What separates them is that nothing is pressed — and ctrl+click, which
 * is how macOS right-clicks, is `button: 0` with `buttons: 1`, so it is one field away from
 * looking like a keypress on the platform this is written on.
 */
function KeyboardHost() {
  const menu = useContextMenu<string>();
  return (
    <div>
      <button
        type="button"
        data-testid="row"
        onContextMenu={(event) => menu.openFromEvent(event, 'row-1')}
      >
        row
      </button>
      {menu.at === null ? null : (
        <div data-testid="anchor" {...menu.anchorProps}>
          <output>{`${menu.at.x},${menu.at.y}`}</output>
        </div>
      )}
    </div>
  );
}

/** jsdom gives every element a zero box, so a row with a position has to be faked. */
function boxOf(element: HTMLElement, box: { left: number; bottom: number }) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left: box.left,
    bottom: box.bottom,
    top: box.bottom - 32,
    right: box.left + 400,
    width: 400,
    height: 32,
    x: box.left,
    y: box.bottom - 32,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('useContextMenu, opened without a pointer', () => {
  it('takes the pointer position from a real right-click', () => {
    render(<KeyboardHost />);
    const row = screen.getByTestId('row');

    fireEvent.contextMenu(row, { button: 2, buttons: 2, clientX: 120, clientY: 40 });

    expect(screen.getByTestId('anchor').textContent).toBe('120,40');
  });

  it('measures the row instead when the event came from the keyboard', () => {
    render(<KeyboardHost />);
    const row = screen.getByTestId('row');
    boxOf(row, { left: 200, bottom: 96 });

    // What Shift+F10 sends: a `contextmenu` with no pointer behind it. Chrome reports 0,0,
    // and a menu that believed those coordinates would open in the corner of the screen.
    fireEvent.contextMenu(row, { button: 0, buttons: 0, clientX: 0, clientY: 0 });

    expect(screen.getByTestId('anchor').textContent).toBe('212,96');
  });

  it('still trusts the pointer for a ctrl+click, which is how macOS right-clicks', () => {
    render(<KeyboardHost />);
    const row = screen.getByTestId('row');
    boxOf(row, { left: 8, bottom: 300 });

    // `button` is 0 here, same as a keypress. Only `buttons` tells them apart, and reading
    // the wrong field puts every menu in the wrong place on the platform most of this is
    // developed on.
    fireEvent.contextMenu(row, { button: 0, buttons: 1, clientX: 64, clientY: 288 });

    expect(screen.getByTestId('anchor').textContent).toBe('64,288');
  });
});
