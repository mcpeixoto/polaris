import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
