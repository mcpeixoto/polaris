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

/**
 * A submenu wide enough to need a filter box is the case type-ahead cannot serve: typing
 * matches the parent row and stops there. These hold the filtered submenu to the ARIA shape
 * the top-level filterable menu already uses — an input owning `aria-activedescendant`
 * rather than roving focus — because that shape had never been rendered inside a submenu
 * before, and to the one key whose meaning changes when a caret is present.
 */
function people(onSelect: (name: string) => void): MenuNode[] {
  return [
    { id: 'archive', label: 'Archive', onSelect: () => onSelect('archive') },
    {
      kind: 'submenu',
      id: 'assignee',
      label: 'Assignee',
      filterable: true,
      filterPlaceholder: 'Assign to…',
      emptyLabel: 'No matching people',
      items: [
        { id: 'ada', label: 'Ada Lovelace', onSelect: () => onSelect('ada') },
        { id: 'alan', label: 'Alan Turing', onSelect: () => onSelect('alan') },
        { id: 'grace', label: 'Grace Hopper', onSelect: () => onSelect('grace') },
      ],
    },
  ];
}

describe('Menu filterable submenus', () => {
  it('gives the submenu its own filter box and puts the keyboard in it', async () => {
    const user = userEvent.setup();
    render(<Picker items={people(() => {})} />);
    await openRoot(user);

    await user.keyboard('{ArrowDown}{ArrowRight}');

    const field = screen.getByPlaceholderText('Assign to…');
    await waitFor(() => expect(document.activeElement).toBe(field));
    // The input owns the active row, and the rows themselves never take focus — the shape
    // the top-level filterable menu uses. Roving focus here would take the caret away from
    // the field on the first arrow press.
    expect(field.getAttribute('aria-activedescendant')).toBeTruthy();
    expect(field.getAttribute('aria-controls')).toBe(
      screen.getByRole('menu', { name: 'Assignee' }).getAttribute('id'),
    );
  });

  it('narrows the submenu by what is typed, and chooses from what is left', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Picker items={people(onSelect)} />);
    await openRoot(user);

    await user.keyboard('{ArrowDown}{ArrowRight}');
    await user.keyboard('grace');

    expect(screen.queryByRole('menuitem', { name: 'Alan Turing' })).toBeNull();
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('grace');
  });

  it('shows the submenu its own empty label when nothing matches', async () => {
    const user = userEvent.setup();
    render(<Picker items={people(() => {})} />);
    await openRoot(user);

    await user.keyboard('{ArrowDown}{ArrowRight}');
    await user.keyboard('zzz');

    expect(screen.getByText('No matching people')).toBeTruthy();
  });

  it('lets ArrowLeft move the caret while there is text, and go back once there is none', async () => {
    const user = userEvent.setup();
    render(<Picker items={people(() => {})} />);
    await openRoot(user);

    await user.keyboard('{ArrowDown}{ArrowRight}');
    await user.keyboard('ada');

    // A caret in a field is what ArrowLeft is for. Closing the submenu here would make the
    // filter box unusable to anyone who mistypes.
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('menu', { name: 'Assignee' })).toBeTruthy();

    await user.clear(screen.getByPlaceholderText('Assign to…'));
    await user.keyboard('{ArrowLeft}');

    expect(screen.queryByRole('menu', { name: 'Assignee' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Move to' })).toBeTruthy();
  });

  it('closes only the submenu on Escape, with the filter box focused', async () => {
    const user = userEvent.setup();
    render(<Picker items={people(() => {})} />);
    await openRoot(user);

    await user.keyboard('{ArrowDown}{ArrowRight}');
    await user.keyboard('al{Escape}');

    expect(screen.queryByRole('menu', { name: 'Assignee' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Move to' })).toBeTruthy();
  });
});
