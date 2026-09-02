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
});
