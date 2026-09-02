import { useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Menu, type MenuNode } from './Menu';

/**
 * What a menu *says* it is, which is not the same question as what it does.
 *
 * The roles themselves are deliberately one set for both shapes — see the note in the
 * component on why promoting the filterable shape to a combobox over a listbox is not a
 * decision this file can take alone. What is tested here is the part that is a property of
 * the menu: selection is announced rather than drawn, and a filter narrowed to nothing says
 * so inside the container the input points at rather than beside it.
 */

function Picker({ items, filterable }: { items: readonly MenuNode[]; filterable?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger} onClick={() => setOpen(true)}>
        Status
      </button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        trigger={trigger}
        items={items}
        label="Status"
        filterable={filterable ?? false}
      />
    </>
  );
}

const STATUSES: MenuNode[] = [
  { id: 'todo', label: 'Todo', selected: false, onSelect: () => {} },
  { id: 'doing', label: 'In Progress', selected: true, onSelect: () => {} },
  { id: 'done', label: 'Done', selected: false, onSelect: () => {} },
];

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Status' }));
}

describe('Menu announcement', () => {
  it('marks the current value rather than leaving the tick to carry it', async () => {
    const user = userEvent.setup();
    render(<Picker items={STATUSES} />);
    await open(user);

    // The tick is aria-hidden, so without this attribute the selection is drawn and never
    // said — which the composition doc forbids outright.
    expect(screen.getByRole('menuitem', { name: 'In Progress' }).getAttribute('aria-current')).toBe(
      'true',
    );
    expect(screen.getByRole('menuitem', { name: 'Todo' }).getAttribute('aria-current')).toBeNull();
  });

  it('names the active item from the filter box, which keeps the focus', async () => {
    const user = userEvent.setup();
    render(<Picker items={STATUSES} filterable />);
    await open(user);

    const box = screen.getByRole('textbox', { name: 'Status' });
    const list = screen.getByRole('menu', { name: 'Status' });
    expect(box.getAttribute('aria-controls')).toBe(list.id);
    expect(box.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('menuitem', { name: 'In Progress' }).id,
    );
  });

  it('keeps the empty message inside the list, as a live region', async () => {
    const user = userEvent.setup();
    render(<Picker items={STATUSES} filterable />);
    await open(user);

    await user.keyboard('zzz');

    const message = screen.getByRole('status');
    expect(message.textContent).toBe('No matches');
    // Inside the container the filter box names, or a screen reader is told the list is
    // empty and never told why.
    expect(screen.getByRole('menu', { name: 'Status' }).contains(message)).toBe(true);
  });
});
