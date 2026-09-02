import { useRef, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Menu, type MenuNode } from './Menu';

/**
 * A cascade is the thing that keeps a picker from becoming a fifty-row scroll, and it is
 * only worth having if the keyboard can drive it: ArrowRight in, ArrowLeft back, Escape out
 * one layer at a time. These tests hold it to that, from the trigger, the way a user does.
 */

function Picker({ items }: { items: readonly MenuNode[] }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger} onClick={() => setOpen(true)}>
        Move to
      </button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        trigger={trigger}
        items={items}
        label="Move to"
      />
    </>
  );
}

function tree(onSelect: (name: string) => void): MenuNode[] {
  return [
    { id: 'archive', label: 'Archive', onSelect: () => onSelect('archive') },
    {
      kind: 'submenu',
      id: 'team',
      label: 'Team',
      items: [
        { id: 'eng', label: 'Engineering', onSelect: () => onSelect('eng') },
        { id: 'design', label: 'Design', onSelect: () => onSelect('design') },
      ],
    },
  ];
}

async function openRoot(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Move to' }));
  return screen.getByRole('menu', { name: 'Move to' });
}

describe('Menu submenus', () => {
  it('announces the row as a menu that opens, and says whether it is open', async () => {
    const user = userEvent.setup();
    render(<Picker items={tree(() => {})} />);
    await openRoot(user);

    const row = screen.getByRole('menuitem', { name: 'Team' });
    expect(row.getAttribute('aria-haspopup')).toBe('menu');
    expect(row.getAttribute('aria-expanded')).toBe('false');

    await user.keyboard('{ArrowDown}{ArrowRight}');

    expect(screen.getByRole('menuitem', { name: 'Team' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByRole('menu', { name: 'Team' })).toBeTruthy();
  });

  it('opens on ArrowRight and chooses from the child with Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Picker items={tree(onSelect)} />);
    await openRoot(user);

    await user.keyboard('{ArrowDown}{ArrowRight}');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledWith('design');
  });

  it('goes back one layer on ArrowLeft, and no further', async () => {
    const user = userEvent.setup();
    render(<Picker items={tree(() => {})} />);
    await openRoot(user);

    await user.keyboard('{ArrowDown}{ArrowRight}');
    expect(screen.getByRole('menu', { name: 'Team' })).toBeTruthy();

    await user.keyboard('{ArrowLeft}');

    // The submenu is gone; the menu it came from is not, and the row it came from is where
    // the keyboard has been put back.
    expect(screen.queryByRole('menu', { name: 'Team' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Move to' })).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Team' })),
    );

    // At the top level ArrowLeft means nothing, so it must not close the menu as well.
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('menu', { name: 'Move to' })).toBeTruthy();
  });

  it('Escape inside a submenu closes that submenu only', async () => {
    const user = userEvent.setup();
    render(<Picker items={tree(() => {})} />);
    await openRoot(user);

    await user.keyboard('{ArrowDown}{ArrowRight}{Escape}');

    expect(screen.queryByRole('menu', { name: 'Team' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Move to' })).toBeTruthy();
  });

  it('keeps the parent open when the press lands inside the submenu', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Picker items={tree(onSelect)} />);
    await openRoot(user);

    await user.keyboard('{ArrowDown}{ArrowRight}');
    // The child is portalled beside the parent rather than inside it, so a bare `contains`
    // check on the parent's surface would read this press as an outside click and close the
    // whole cascade before the click landed.
    await user.click(screen.getByRole('menuitem', { name: 'Engineering' }));

    expect(onSelect).toHaveBeenCalledWith('eng');
  });
});
