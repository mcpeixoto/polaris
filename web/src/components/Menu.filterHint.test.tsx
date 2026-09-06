import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Menu, type MenuNode } from './Menu';

function Picker({ items, filterHint }: { items: readonly MenuNode[]; filterHint?: string }) {
  const trigger = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={trigger}>Status</button>
      <Menu
        open
        onClose={() => {}}
        trigger={trigger}
        items={items}
        label="Status"
        filterable
        filterPlaceholder="Change status…"
        filterHint={filterHint}
      />
    </>
  );
}

const ITEMS: MenuNode[] = [
  { id: 'todo', label: 'Todo', keys: '1', selected: true, onSelect: () => {} },
  { id: 'doing', label: 'In Progress', keys: '2', onSelect: () => {} },
];

/**
 * The filter row teaches the chord that would have opened the menu, and a row's shortcut
 * is drawn as quiet text rather than as key caps — both are what Linear's pickers do, and
 * both are read by somebody who reached the menu with the pointer.
 */
describe('Menu filter hint', () => {
  it('draws the chord beside the filter box, on the Mac convention', () => {
    render(<Picker items={ITEMS} filterHint="s" />);

    expect(screen.getByRole('textbox', { name: 'Status' })).toBeTruthy();
    expect(screen.getByText('S', { selector: 'kbd' })).toBeTruthy();
  });

  it('draws nothing when no chord is given', () => {
    render(<Picker items={ITEMS} />);
    expect(screen.queryByText('S', { selector: 'kbd' })).toBeNull();
  });

  it('draws a row shortcut as text, not as a key cap', () => {
    render(<Picker items={ITEMS} filterHint="s" />);
    const row = screen.getByRole('menuitem', { name: /In Progress/ });
    expect(row.textContent).toContain('2');
    expect(row.querySelector('kbd')).toBeNull();
  });
});
