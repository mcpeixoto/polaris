import { useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Menu, type MenuNode } from './Menu';

/**
 * These tests drive the menu the way a user does — from the trigger, with the keyboard —
 * rather than by poking at its props. The keyboard model *is* the component: a menu whose
 * arrows are asserted through an internal callback would keep passing after the day
 * somebody breaks the roving tabindex and nothing can be reached any more.
 */

interface PickerProps {
  items: readonly MenuNode[];
  filterable?: boolean;
}

function Picker({ items, filterable = false }: PickerProps) {
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
        filterable={filterable}
      />
    </>
  );
}

const NAMES = ['Backlog', 'Todo', 'In Progress', 'Done', 'Canceled'];

function statuses(onSelect: (name: string) => void): MenuNode[] {
  return NAMES.map((name) => ({
    id: name.toLowerCase().replace(' ', '-'),
    label: name,
    onSelect: () => onSelect(name),
  }));
}

/** The active item is the focused one when there is no filter box; see the component. */
function activeText(): string | null {
  return document.activeElement?.textContent ?? null;
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Status' }));
  return screen.getByRole('menu', { name: 'Status' });
}

describe('Menu', () => {
  it('opens with the first item active and moves it with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Picker items={statuses(() => {})} />);
    await openMenu(user);

    expect(activeText()).toBe('Backlog');

    await user.keyboard('{ArrowDown}');
    expect(activeText()).toBe('Todo');

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(activeText()).toBe('Done');

    await user.keyboard('{ArrowUp}');
    expect(activeText()).toBe('In Progress');
  });

  it('wraps at both ends and jumps with Home and End', async () => {
    const user = userEvent.setup();
    render(<Picker items={statuses(() => {})} />);
    await openMenu(user);

    await user.keyboard('{ArrowUp}');
    expect(activeText()).toBe('Canceled');

    await user.keyboard('{ArrowDown}');
    expect(activeText()).toBe('Backlog');

    await user.keyboard('{End}');
    expect(activeText()).toBe('Canceled');

    await user.keyboard('{Home}');
    expect(activeText()).toBe('Backlog');
  });

  it('opens on the current value rather than at the top', async () => {
    const user = userEvent.setup();
    const items = statuses(() => {}).map((node, index) =>
      index === 2 ? { ...node, selected: true } : node,
    );
    render(<Picker items={items} />);
    await openMenu(user);

    expect(activeText()).toBe('In Progress');
  });

  it('invokes the active item on Enter and closes', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Picker items={statuses(onSelect)} />);
    await openMenu(user);

    await user.keyboard('{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('Todo');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('never invokes a disabled item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const items: MenuNode[] = [
      { id: 'a', label: 'Assign to me', disabled: true, onSelect: () => onSelect('a') },
      { id: 'b', label: 'Assign to Ada', onSelect: () => onSelect('b') },
    ];
    render(<Picker items={items} />);
    await openMenu(user);

    // The disabled item is skipped entirely, so the menu opens on the one below it.
    expect(activeText()).toBe('Assign to Ada');

    await user.click(screen.getByRole('menuitem', { name: 'Assign to me' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Picker items={statuses(() => {})} />);
    const trigger = screen.getByRole('button', { name: 'Status' });
    await openMenu(user);

    expect(document.activeElement).not.toBe(trigger);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('jumps to a matching item as the user types', async () => {
    const user = userEvent.setup();
    render(<Picker items={statuses(() => {})} />);
    await openMenu(user);

    await user.keyboard('i');
    expect(activeText()).toBe('In Progress');

    // The buffer keeps growing while the user is still typing, so a second letter refines
    // the same search rather than starting a new one.
    await user.keyboard('n');
    expect(activeText()).toBe('In Progress');
  });

  it('cycles through the items sharing a letter when that letter is repeated', async () => {
    const user = userEvent.setup();
    const items: MenuNode[] = ['Ada Lovelace', 'Alan Turing', 'Grace Hopper'].map((name) => ({
      id: name,
      label: name,
      onSelect: () => {},
    }));
    render(<Picker items={items} />);
    await openMenu(user);

    await user.keyboard('a');
    expect(activeText()).toBe('Ada Lovelace');

    await user.keyboard('a');
    expect(activeText()).toBe('Alan Turing');

    await user.keyboard('a');
    expect(activeText()).toBe('Ada Lovelace');
  });

  it('filters, keeps focus in the box, and names the active item to assistive technology', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Picker items={statuses(onSelect)} filterable />);
    await openMenu(user);

    const filter = screen.getByRole('textbox', { name: 'Status' });
    expect(document.activeElement).toBe(filter);

    // Anywhere in the label, not just the start: "og" finds Backlog and In Progress, which
    // is what someone half-remembering a status name actually types.
    await user.keyboard('og');
    const shown = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(shown).toEqual(['Backlog', 'In Progress']);

    // Focus never leaves the box, so the active item is named rather than focused.
    expect(document.activeElement).toBe(filter);
    expect(filter.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('menuitem', { name: 'Backlog' }).id,
    );

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('In Progress');
  });

  it('says so when the filter matches nothing', async () => {
    const user = userEvent.setup();
    render(<Picker items={statuses(() => {})} filterable />);
    await openMenu(user);

    await user.keyboard('zzz');

    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('drops headings and rules that filtering has left with nothing to punctuate', async () => {
    const user = userEvent.setup();
    const items: MenuNode[] = [
      { kind: 'heading', label: 'Suggested' },
      { id: 'ada', label: 'Ada Lovelace', onSelect: () => {} },
      { kind: 'separator' },
      { kind: 'heading', label: 'Everyone' },
      { id: 'grace', label: 'Grace Hopper', onSelect: () => {} },
    ];
    render(<Picker items={items} filterable />);
    await openMenu(user);

    expect(screen.getAllByRole('group')).toHaveLength(2);
    expect(screen.getAllByRole('separator')).toHaveLength(1);

    await user.keyboard('grace');

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Grace Hopper',
    ]);
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
    expect(screen.queryByText('Suggested')).toBeNull();
  });

  it('closes when something outside it is pressed', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Picker items={statuses(() => {})} />
        <button>Elsewhere</button>
      </>,
    );
    await openMenu(user);

    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));

    expect(screen.queryByRole('menu')).toBeNull();
  });
});
