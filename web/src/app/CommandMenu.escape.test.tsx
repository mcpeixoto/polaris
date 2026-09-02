import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Escape closes the command menu from wherever focus happens to be.
 *
 * It was handled on the query input alone. That holds while focus is in the input and
 * fails the moment it is not — an empty result set leaves focus on the panel, and a screen
 * that claims focus on mount can take it out of the input while the menu is open. Escape
 * then reached an element with no handler, the modal stayed up over a screen whose own keys
 * were now behind it, and the only way out was the mouse. The end-to-end keymap walk caught
 * it as a dialog that would not hide.
 */

vi.mock('react-router', () => ({ useNavigate: () => () => undefined }));

vi.mock('~/app/context', () => ({
  useEngine: () => ({}),
  useQuery: () => [],
}));

vi.mock('./keymap', () => ({
  useKeymap: () => ({
    registry: { listForContext: () => [], actionsFor: () => [], all: () => [] },
    context: { screen: null },
  }),
}));

vi.mock('~/hooks/useFocusTrap', () => ({ useFocusTrap: () => undefined }));

const { CommandMenu } = await import('./CommandMenu');

describe('CommandMenu', () => {
  it('closes on Escape pressed on the panel, not only in the query box', () => {
    const onClose = vi.fn();
    render(<CommandMenu open onClose={onClose} />);

    const panel = screen.getByRole('dialog', { name: /command menu/i });
    fireEvent.keyDown(panel, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape even when focus has been pulled out of the dialog', () => {
    const onClose = vi.fn();
    const outside = document.createElement('button');
    document.body.append(outside);
    render(<CommandMenu open onClose={onClose} />);

    // The screen underneath finishing its mount and claiming focus. The trap puts focus
    // back, but a keystroke landing first used to be swallowed and left the modal up.
    outside.focus();
    fireEvent.keyDown(outside, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    outside.remove();
  });

  it('does nothing while the menu is closed', () => {
    const onClose = vi.fn();
    render(<CommandMenu open={false} onClose={onClose} />);

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('still closes on Escape from the query box', () => {
    const onClose = vi.fn();
    render(<CommandMenu open onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole('combobox', { name: /search commands/i }), {
      key: 'Escape',
    });

    expect(onClose).toHaveBeenCalled();
  });
});
