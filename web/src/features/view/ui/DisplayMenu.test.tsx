import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { KeymapProvider } from '~/app/keymap';
import { DEFAULT_DISPLAY, type DisplayOptions } from '~/filter';

import { DisplayMenu } from './DisplayMenu';

/**
 * The display menu, driven the way it is used: one control at a time, with the patch it
 * emits as the only thing that matters.
 *
 * The patch is the whole contract. `useView` merges it over the URL and the view re-renders
 * from that — so a control that emitted the right *value* under the wrong key, or a whole
 * options object instead of a patch, would look perfectly correct on screen and quietly
 * overwrite the choices the user made before it. That is the class of bug these are for,
 * and it is why every assertion below is on the argument rather than on the rendering.
 */

function renderMenu(display: Partial<DisplayOptions> = {}, triage = false) {
  const onChange = vi.fn();
  const onClose = vi.fn();

  function Harness() {
    // A real trigger, because the panel positions against it and hands focus back to it.
    const trigger = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button type="button" ref={trigger}>
          Display
        </button>
        <DisplayMenu
          display={{ ...DEFAULT_DISPLAY, ...display }}
          onChange={onChange}
          open
          onClose={onClose}
          trigger={trigger}
          triage={triage}
        />
      </>
    );
  }

  render(
    <KeymapProvider>
      <Harness />
    </KeymapProvider>,
  );

  return { onChange, onClose, user: userEvent.setup() };
}

describe('DisplayMenu', () => {
  it('writes the layout as soon as it is chosen, with no apply step', async () => {
    const { user, onChange } = renderMenu();

    await user.click(screen.getByRole('button', { name: 'Board' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ layout: 'board' });
  });

  it('writes a grouping change as a patch naming only the grouping', async () => {
    const { user, onChange } = renderMenu();

    await user.selectOptions(screen.getByLabelText('Grouping'), 'assignee');

    expect(onChange).toHaveBeenCalledWith({ groupBy: 'assignee' });
  });

  it('writes an ordering and a direction separately', async () => {
    const { user, onChange } = renderMenu();

    await user.selectOptions(screen.getByLabelText('Ordering'), 'priority');
    await user.click(screen.getByRole('button', { name: 'Descending' }));

    expect(onChange.mock.calls.map((call) => call[0])).toEqual([
      { orderBy: 'priority' },
      { direction: 'desc' },
    ]);
  });

  it('writes the two switches as booleans', async () => {
    const { user, onChange } = renderMenu();

    await user.click(screen.getByRole('checkbox', { name: 'Show completed' }));

    expect(onChange).toHaveBeenCalledWith({ showCompleted: false });
  });

  it('hides show-snoozed on ordinary views', () => {
    renderMenu();
    expect(screen.queryByRole('checkbox', { name: 'Show snoozed' })).toBeNull();
  });

  it('writes show-snoozed from the triage inbox', async () => {
    const { user, onChange } = renderMenu({}, true);
    await user.click(screen.getByRole('checkbox', { name: 'Show snoozed' }));
    expect(onChange).toHaveBeenCalledWith({ showSnoozed: true });
  });

  /**
   * The order is not cosmetic: `toDisplayParams` compares the joined list against the
   * default's, so the same five properties in a different order become a `show=` parameter
   * pinned into every link somebody shares.
   */
  it('emits the whole property set in canonical order when one is unticked', async () => {
    const { user, onChange } = renderMenu();

    await user.click(screen.getByRole('checkbox', { name: 'Estimate' }));

    expect(onChange).toHaveBeenCalledWith({
      properties: ['priority', 'assignee', 'labels', 'dueDate'],
    });
  });

  it('emits the property back in its canonical place when it is ticked again', async () => {
    const { user, onChange } = renderMenu({ properties: ['priority', 'labels'] });

    await user.click(screen.getByRole('checkbox', { name: 'Assignee' }));

    // Not appended: the assignee belongs between the priority and the labels, wherever it
    // happens to have been turned back on from.
    expect(onChange).toHaveBeenCalledWith({ properties: ['priority', 'assignee', 'labels'] });
  });

  it('resets to the defaults, every option at once', async () => {
    const { user, onChange } = renderMenu({
      layout: 'board',
      groupBy: 'assignee',
      showCompleted: false,
      properties: ['priority'],
    });

    await user.click(screen.getByRole('button', { name: 'Reset to default' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(DEFAULT_DISPLAY);
  });

  it('offers no reset when there is nothing to reset', () => {
    renderMenu();

    expect(screen.getByRole('button', { name: 'Reset to default' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText('All defaults')).toBeTruthy();
  });

  it('names the default that each changed value replaced', () => {
    renderMenu({ groupBy: 'assignee', showCompleted: false });

    expect(screen.getByText('2 changed')).toBeTruthy();
    expect(screen.getByText('Default: Status')).toBeTruthy();
    // The switch says what the default was in the words the switch is labelled in.
    expect(screen.getByText(/Default: shown/)).toBeTruthy();
  });

  /**
   * The point of the note is that nothing is refused. The user may be one click away from
   * changing the grouping too, so the ordering is written exactly as asked for — and the
   * menu says out loud that the list underneath will not look sorted by it.
   */
  it('says when an ordering has nothing to do under the current grouping', () => {
    renderMenu({ orderBy: 'manual', groupBy: 'assignee' });

    expect(screen.getByRole('note').textContent).toMatch(/Manual order/);
  });

  it('says nothing when the ordering and the grouping agree', () => {
    renderMenu({ orderBy: 'manual', groupBy: 'state' });

    expect(screen.queryByRole('note')).toBeNull();
  });

  it('closes on Escape through the keymap rather than a handler of its own', async () => {
    const { user, onClose } = renderMenu();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
