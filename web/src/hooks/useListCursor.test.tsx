import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KeymapProvider, useActions, useKeyContext } from '~/app/keymap';
import type { UUID } from '~/store';

import { useListCursor } from './useListCursor';

/**
 * Everything here is asserted through real keystrokes on a real registry, because what this
 * hook exists to fix is nine screens where the chord reaches nothing. A test that called
 * `move(1)` directly would pass on a hook that never registered anything at all.
 */

afterEach(cleanup);

const ROWS = ['a', 'b', 'c', 'd'] as UUID[];

function List({
  ids = ROWS,
  prefix = 'testList',
  onOpen,
}: {
  ids?: readonly UUID[];
  prefix?: string;
  onOpen?: (id: UUID) => void;
}) {
  useKeyContext('list');
  const { cursorId, selection, rowProps } = useListCursor({ ids, prefix, onOpen, noun: 'row' });
  return (
    <ul
      aria-label="rows"
      data-cursor-id={cursorId ?? ''}
      data-selected={selection.ordered.join(',')}
    >
      {ids.map((id) => (
        <li key={id} {...rowProps(id)}>
          {id}
        </li>
      ))}
    </ul>
  );
}

/**
 * Stands in for the shell's own Escape. Registered rather than listened for, because a
 * `keydown` listener would fire whether or not the list claimed the key — which is the one
 * thing this is here to tell apart.
 */
function Shell({ onDismiss }: { onDismiss: () => void }) {
  useActions([
    {
      id: 'shell.dismiss',
      title: 'Dismiss',
      keys: ['Escape'],
      when: 'global',
      group: 'Navigation',
      run: onDismiss,
    },
  ]);
  return null;
}

function mount(props: Parameters<typeof List>[0] = {}) {
  const view = render(
    <KeymapProvider>
      <List {...props} />
    </KeymapProvider>,
  );
  return { view, user: userEvent.setup() };
}

const cursor = () => screen.getByRole('list').getAttribute('data-cursor-id');
const selected = () => screen.getByRole('list').getAttribute('data-selected');

describe('useListCursor', () => {
  it('starts on the first row and steps with j and k, stopping at the ends', async () => {
    const { user } = mount();
    expect(cursor()).toBe('a');

    await user.keyboard('jj');
    expect(cursor()).toBe('c');

    await user.keyboard('k');
    expect(cursor()).toBe('b');

    await user.keyboard('kk');
    expect(cursor()).toBe('a');
  });

  it('marks the cursor row and announces selection on the rows themselves', async () => {
    const { user } = mount();
    expect(screen.getByText('a').getAttribute('data-cursor')).toBe('');
    expect(screen.getByText('a').id).toBe('testList-row-a');
    expect(screen.getByText('a').getAttribute('aria-selected')).toBe('false');

    await user.keyboard('x');
    expect(screen.getByText('a').getAttribute('aria-selected')).toBe('true');
  });

  it('takes the row the cursor is on as the first end of a shift-extension', async () => {
    const { user } = mount();
    await user.keyboard('j');
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');

    expect(selected()).toBe('b,c');
    expect(cursor()).toBe('c');
  });

  it('shrinks a range back rather than accumulating one', async () => {
    const { user } = mount();
    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{ArrowUp}{/Shift}');

    expect(selected()).toBe('a,b');
  });

  it('selects everything with mod+a and clears with Escape', async () => {
    const { user } = mount();
    // jsdom is not a Mac, so `mod` is Control here.
    await user.keyboard('{Control>}a{/Control}');
    expect(selected()).toBe('a,b,c,d');

    await user.keyboard('{Escape}');
    expect(selected()).toBe('');
  });

  it('leaves Escape unbound while nothing is selected, so the shell still gets it', async () => {
    const shell = vi.fn();
    const user = userEvent.setup();
    render(
      <KeymapProvider>
        <Shell onDismiss={shell} />
        <List />
      </KeymapProvider>,
    );

    // Nothing selected, so the list's own Escape is disabled — and a disabled action is
    // treated as unbound, which is what lets the keystroke reach the outer context.
    await user.keyboard('{Escape}');
    expect(shell).toHaveBeenCalledTimes(1);

    await user.keyboard('x{Escape}');
    expect(shell).toHaveBeenCalledTimes(1);
    expect(selected()).toBe('');
  });

  it('opens the row under the cursor on Enter', async () => {
    const onOpen = vi.fn();
    const { user } = mount({ onOpen });

    await user.keyboard('j{Enter}');
    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('keeps the cursor on its row when the list reorders underneath it', async () => {
    const { view, user } = mount();
    await user.keyboard('jj');
    expect(cursor()).toBe('c');

    view.rerender(
      <KeymapProvider>
        <List ids={['d', 'c', 'b', 'a'] as UUID[]} />
      </KeymapProvider>,
    );
    expect(cursor()).toBe('c');
  });

  it('falls to the next row down when the cursor row is deleted, not to the top', async () => {
    const { view, user } = mount();
    await user.keyboard('j');
    expect(cursor()).toBe('b');

    view.rerender(
      <KeymapProvider>
        <List ids={['a', 'c', 'd'] as UUID[]} />
      </KeymapProvider>,
    );
    expect(cursor()).toBe('c');
  });

  it('unregisters on unmount, so the next list can claim the same action ids', () => {
    // One provider throughout, because it is one registry that would refuse the second
    // registration — two providers would each get a registry of their own and prove nothing.
    const view = render(
      <KeymapProvider>
        <List />
      </KeymapProvider>,
    );
    view.rerender(
      <KeymapProvider>
        <span />
      </KeymapProvider>,
    );

    expect(() =>
      view.rerender(
        <KeymapProvider>
          <List />
        </KeymapProvider>,
      ),
    ).not.toThrow();
  });
});
