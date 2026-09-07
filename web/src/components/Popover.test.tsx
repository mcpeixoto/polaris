import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { KeymapProvider } from '~/app/keymap';
import { useMenuTrigger } from '~/hooks/useMenuTrigger';

import { Popover } from './Popover';

/**
 * The four promises this shell makes, tested at the level a caller can rely on them: it is
 * dismissed by Escape and by a click outside, it is not dismissed by a click inside, and the
 * keyboard goes back where it came from. Everything else in the file is arithmetic against a
 * viewport jsdom does not lay out.
 */

function frame(children: ReactNode) {
  return <KeymapProvider>{children}</KeymapProvider>;
}

function Harness({ actionId = 'test.closePopover' }: { actionId?: string }) {
  const trigger = useMenuTrigger('dialog');
  return (
    <>
      <button {...trigger.props}>Open</button>
      <Popover
        open={trigger.open}
        onClose={trigger.hide}
        trigger={trigger.ref}
        label="Details"
        actionId={actionId}
      >
        <button type="button">Inside</button>
      </Popover>
    </>
  );
}

describe('Popover', () => {
  it('opens on its trigger and announces itself as a dialog', async () => {
    render(frame(<Harness />));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByRole('dialog', { name: 'Details' })).toBeTruthy();
  });

  it('closes on Escape and gives the trigger its focus back', async () => {
    render(frame(<Harness />));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open' }));

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
  });

  it('closes on a pointerdown outside it but not on one inside', async () => {
    render(
      frame(
        <>
          <Harness />
          <button type="button">Elsewhere</button>
        </>,
      ),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open' }));

    // A control inside the panel is the whole reason this is not a Menu; clicking one must
    // not dismiss the surface it belongs to.
    await user.click(screen.getByRole('button', { name: 'Inside' }));
    expect(screen.getByRole('dialog', { name: 'Details' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
  });

  /**
   * The reason `actionId` is a prop. `KeymapRegistry.register` throws on a duplicate id, so a
   * shared popover with a hard-coded one could be mounted exactly once per screen — and a
   * project has a start date and a target date side by side.
   */
  it('mounts twice on one screen when the two are given different action ids', async () => {
    const onError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        frame(
          <>
            <Harness actionId="test.closeFirst" />
            <Harness actionId="test.closeSecond" />
          </>,
        ),
      ),
    ).not.toThrow();
    onError.mockRestore();

    const user = userEvent.setup();
    const [first, second] = screen.getAllByRole('button', { name: 'Open' });

    // Escape reaches the one that is open and not the one that is not: `enabled` is what makes
    // two bindings on one key in one context legal, and a binding that fired while its panel
    // was shut would swallow the key from whatever else claims it.
    await user.click(second as HTMLElement);
    expect(screen.getAllByRole('dialog', { name: 'Details' })).toHaveLength(1);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    expect(document.activeElement).toBe(second);

    await user.click(first as HTMLElement);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    expect(document.activeElement).toBe(first);
  });

  it('refuses two popovers that claim the same action id, rather than silently dropping one', () => {
    const onError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        frame(
          <>
            <Harness actionId="test.sameId" />
            <Harness actionId="test.sameId" />
          </>,
        ),
      ),
    ).toThrow(/already registered/);
    onError.mockRestore();
  });

  it('is absent from the DOM entirely while it is closed', () => {
    function Closed() {
      const trigger = useRef<HTMLElement | null>(null);
      return (
        <Popover
          open={false}
          onClose={() => {}}
          trigger={trigger}
          label="Details"
          actionId="test.closedPopover"
        >
          <button type="button">Inside</button>
        </Popover>
      );
    }
    render(frame(<Closed />));

    // Not merely hidden: a closed panel that is still in the tree is one Tab can reach.
    expect(screen.queryByRole('button', { name: 'Inside' })).toBeNull();
  });
});
