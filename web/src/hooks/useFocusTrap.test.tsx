import { useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { useFocusTrap } from './useFocusTrap';

/**
 * A trap is a property of the document, not of the component that asks for one, so every
 * assertion here is about where focus actually is.
 */

function Host({ initial }: { initial?: boolean }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const queryRef = useRef<HTMLInputElement>(null);
  useFocusTrap(panelRef, open, initial === true ? { initialFocus: queryRef } : {});

  return (
    <>
      <button onClick={() => setOpen(true)}>Open palette</button>
      <button>Behind the scrim</button>
      {!open ? null : (
        <div ref={panelRef} role="dialog" aria-label="Commands" tabIndex={-1}>
          <button>First</button>
          <input ref={queryRef} aria-label="Query" />
          <button onClick={() => setOpen(false)}>Last</button>
        </div>
      )}
    </>
  );
}

describe('useFocusTrap', () => {
  it('moves focus into the surface on open', async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByRole('button', { name: 'Open palette' }));

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
  });

  it('honours an explicit initial focus, which is the thing the user came for', async () => {
    const user = userEvent.setup();
    render(<Host initial />);

    await user.click(screen.getByRole('button', { name: 'Open palette' }));

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Query' }));
  });

  it('wraps Tab at the last stop rather than letting it walk out', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Open palette' }));

    screen.getByRole('button', { name: 'Last' }).focus();
    await user.tab();

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
  });

  it('wraps Shift+Tab at the first stop', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Open palette' }));

    await user.tab({ shift: true });

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last' }));
  });

  it('returns focus to whatever opened it, so the next keystroke goes somewhere', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Open palette' });

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Last' }));

    expect(document.activeElement).toBe(trigger);
  });
});
