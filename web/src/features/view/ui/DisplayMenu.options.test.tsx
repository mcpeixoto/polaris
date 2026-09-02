import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { KeymapProvider } from '~/app/keymap';
import { DEFAULT_DISPLAY, parseDisplayParams, type DisplayOptions } from '~/filter';
import { DISPLAY_PROPERTIES } from '~/filter/types';

import { DisplayMenu, PROPERTY_LABELS } from './DisplayMenu';

/**
 * The options the menu did not have, and the Tab that walked out of it.
 *
 * `DisplayMenu.test.tsx` covers the contract every control here shares — a patch naming one
 * key, written the moment it is chosen. These are about the controls that were missing, plus
 * the one thing the panel owes as a `role="dialog"`: focus that stays inside it.
 */

function renderMenu(display: Partial<DisplayOptions> = {}) {
  const onChange = vi.fn();

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
          onClose={vi.fn()}
          trigger={trigger}
        />
      </>
    );
  }

  render(
    <KeymapProvider>
      <Harness />
    </KeymapProvider>,
  );

  return { onChange, user: userEvent.setup() };
}

describe('sub-grouping', () => {
  it('writes a patch naming only the sub-grouping', async () => {
    const { user, onChange } = renderMenu({ groupBy: 'state' });

    await user.selectOptions(screen.getByLabelText('Sub-grouping'), 'assignee');

    expect(onChange).toHaveBeenCalledWith({ subGroupBy: 'assignee' });
  });

  /**
   * Every swimlane would hold the rows of the header above it, and the header would repeat
   * that header's word. The pairing is not refused so much as never offered — which is the
   * same treatment `orderingNote` gives an ordering with nothing left to decide.
   */
  it('does not offer the dimension the list is already grouped by', () => {
    renderMenu({ groupBy: 'assignee' });

    const select = screen.getByLabelText('Sub-grouping');
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toContain('No sub-grouping');
    expect(options).not.toContain('Assignee');
    expect(options).toContain('Status');
  });

  // A swimlane inside no group is simply a grouping, which the control above already is.
  it('is inert with no grouping to slice', () => {
    renderMenu({ groupBy: 'none' });
    expect(screen.getByLabelText('Sub-grouping')).toHaveProperty('disabled', true);
    expect(screen.getByText('Choose a grouping first')).toBeTruthy();
  });

  // A hand-edited link can pair them; the menu reads that as no sub-grouping rather than
  // drawing a choice nobody could have made.
  it('reads a sub-grouping equal to the grouping as none', () => {
    renderMenu({ groupBy: 'priority', subGroupBy: 'priority' });
    expect(screen.getByLabelText('Sub-grouping')).toHaveProperty('value', 'none');
    // One change — the grouping — and not two: a sub-grouping that means nothing is not a
    // decision somebody took, so the header must not offer to reset it as if it were.
    expect(screen.getByText('1 changed')).toBeTruthy();
  });
});

describe('show empty groups', () => {
  it('writes the toggle as a boolean', async () => {
    const { user, onChange } = renderMenu();

    await user.click(screen.getByRole('checkbox', { name: 'Show empty groups' }));

    expect(onChange).toHaveBeenCalledWith({ showEmptyGroups: true });
  });

  it('counts as a change and names the default it replaced', () => {
    renderMenu({ showEmptyGroups: true });
    expect(screen.getByText('1 changed')).toBeTruthy();
    expect(screen.getByText(/Default: hidden/)).toBeTruthy();
  });
});

describe('display properties', () => {
  /**
   * The menu is the only place a property name becomes a word, so a name a link can carry
   * and the menu cannot draw is a tick somebody can never take off again.
   */
  it('has a word and a tick for everything a URL can carry', () => {
    renderMenu();

    const params = new URLSearchParams({ show: [...DISPLAY_PROPERTIES, 'sla'].join(',') });
    const parsed = parseDisplayParams(params).properties ?? [];
    expect(parsed.length).toBe(DISPLAY_PROPERTIES.length);
    for (const property of parsed) {
      expect(PROPERTY_LABELS[property]).toBeTruthy();
      expect(screen.getByRole('checkbox', { name: PROPERTY_LABELS[property] })).toBeTruthy();
    }
  });

  it('offers the properties that were only reachable by URL', async () => {
    const { user, onChange } = renderMenu();

    await user.click(screen.getByRole('checkbox', { name: 'Project' }));

    // Canonical order, not click order: `toDisplayParams` compares the joined list against
    // the default's, so the same set in another order pins a `show=` into every shared link.
    expect(onChange).toHaveBeenCalledWith({
      properties: ['priority', 'assignee', 'labels', 'estimate', 'dueDate', 'project'],
    });
  });
});

/**
 * Tab, inside the panel.
 *
 * It is a dialog and it takes the focus on opening, so Tab out of the last control dropped a
 * keyboard user into the list behind a surface they cannot see past — with the panel still
 * open, and every further Tab walking further from the way back.
 */
describe('the focus trap', () => {
  it('wraps forwards from the last control to the first', async () => {
    const { user } = renderMenu();

    const controls = screen.getAllByRole('checkbox');
    const last = controls[controls.length - 1];
    last?.focus();
    await user.tab();

    const panel = screen.getByRole('dialog', { name: 'Display options' });
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'List' }));
  });

  it('wraps backwards from the first control to the last', async () => {
    const { user } = renderMenu();

    screen.getByRole('button', { name: 'List' }).focus();
    await user.tab({ shift: true });

    const panel = screen.getByRole('dialog', { name: 'Display options' });
    expect(panel.contains(document.activeElement)).toBe(true);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(document.activeElement).toBe(checkboxes[checkboxes.length - 1]);
  });
});
