/**
 * A submenu whose list is not a list the menu can hold.
 *
 * "Mark as ▸ Blocked by…" searches the whole corpus, so the rows have to come from the caller
 * and the caller has to hear every keystroke. That is what `onFilterChange` on a submenu is
 * for, and the part worth a test is the closing half: the box goes with the panel, so the
 * caller's search has to be told, or the next opening shows eight issues somebody searched for
 * a minute ago under a box that reads empty.
 */

import { useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Menu, type MenuNode } from './Menu';

function Harness({ items }: { items: readonly MenuNode[] }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger} onClick={() => setOpen(true)}>
        Actions
      </button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        trigger={trigger}
        items={items}
        label="Actions"
      />
    </>
  );
}

function tree(onFilterChange: (value: string) => void): MenuNode[] {
  return [
    {
      kind: 'submenu',
      id: 'mark-blocked',
      label: 'Blocked by…',
      text: 'Blocked by',
      keys: 'm b',
      filterable: true,
      filterPlaceholder: 'Search issues…',
      emptyLabel: 'Search by identifier or title',
      onFilterChange,
      items: [{ id: 'eng-7', label: 'ENG-7 Fix the flake', onSelect: vi.fn() }],
    },
  ];
}

describe('a submenu whose caller owns the search', () => {
  it('reports what was typed, and reports the empty box when it closes', async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    render(<Harness items={tree(onFilterChange)} />);

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.keyboard('{ArrowDown}{ArrowRight}');
    await user.keyboard('ENG');

    expect(onFilterChange.mock.calls.map(([value]) => value)).toEqual(['E', 'EN', 'ENG']);

    await user.keyboard('{Escape}');

    // The panel has gone, so the caller's search must not still be narrowed by text nobody
    // can see. Escape closes the submenu only; the menu behind it is still up.
    expect(onFilterChange).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('menu', { name: 'Actions' })).toBeTruthy();
  });

  it('draws the chord on the row that opens the submenu', async () => {
    const user = userEvent.setup();
    render(<Harness items={tree(vi.fn())} />);

    await user.click(screen.getByRole('button', { name: 'Actions' }));

    // A submenu row is still a command in the user's head: the chord opens the same list the
    // row does, and a cascade that dropped every cap would hide the product's shortcuts.
    const row = screen.getByRole('menuitem', { name: /^Blocked by…/ });
    expect(row.textContent).not.toBe('Blocked by…');
  });
});
