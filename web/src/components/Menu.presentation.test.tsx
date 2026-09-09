/**
 * Presentation props that make context menus denser than property pickers: key caps,
 * compact rows, and no empty tick column when nothing is selected.
 */

import { useRef, useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Menu, type MenuNode } from './Menu';
import styles from './Menu.module.css';

function Harness({
  items,
  keysPresentation,
  density,
}: {
  items: readonly MenuNode[];
  keysPresentation?: 'text' | 'kbd';
  density?: 'default' | 'compact';
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger} onClick={() => setOpen(true)}>
        Open
      </button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        trigger={trigger}
        items={items}
        label="Actions"
        {...(keysPresentation === undefined ? {} : { keysPresentation })}
        {...(density === undefined ? {} : { density })}
      />
    </>
  );
}

describe('Menu presentation', () => {
  it('draws key caps when keysPresentation is kbd', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        keysPresentation="kbd"
        items={[
          {
            id: 'status',
            label: 'Status…',
            keys: 's',
            onSelect: () => {},
          },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const item = screen.getByRole('menuitem', { name: /Status/ });
    expect(within(item).getByText('S')).toBeTruthy();
    expect(item.querySelector('kbd')).not.toBeNull();
  });

  it('keeps quiet text for keys by default', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        items={[
          {
            id: 'status',
            label: 'Status…',
            keys: 's',
            onSelect: () => {},
          },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const item = screen.getByRole('menuitem', { name: /Status/ });
    expect(item.querySelector('kbd')).toBeNull();
    expect(item.textContent).toContain('S');
  });

  it('applies compact density to the panel', async () => {
    const user = userEvent.setup();
    render(
      <Harness density="compact" items={[{ id: 'open', label: 'Open', onSelect: () => {} }]} />,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const menu = screen.getByRole('menu', { name: 'Actions' });
    expect(menu.closest(`.${styles.compact}`)).not.toBeNull();
  });

  it('omits the tick column when no item is selected', async () => {
    const user = userEvent.setup();
    render(<Harness items={[{ id: 'open', label: 'Open', onSelect: () => {} }]} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const item = screen.getByRole('menuitem', { name: 'Open' });
    expect(item.className).toContain(styles.noTick);
    expect(item.querySelector(`.${styles.tick}`)).toBeNull();
  });

  it('keeps the tick column when an item is selected', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        items={[
          { id: 'a', label: 'A', selected: true, onSelect: () => {} },
          { id: 'b', label: 'B', onSelect: () => {} },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const selected = screen.getByRole('menuitem', { name: 'A' });
    expect(selected.className).not.toContain(styles.noTick);
    expect(selected.querySelector(`.${styles.tick}`)).not.toBeNull();
  });
});
