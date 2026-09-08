import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PropertyTrigger } from './PropertyTrigger';

/**
 * What this component has to get right is what a screen reader and a row click each hear.
 *
 * The name is the *value* and the tooltip is the *verb*, which is the opposite of what an
 * icon button normally does — "Change status" is the action, "In Progress" is what the glyph
 * is currently saying, and a control announced as "Change status" tells a screen reader user
 * nothing about the issue in front of them. And the click must die at the button: every one
 * of these sits inside a row whose own click opens the issue, so a trigger that lets the
 * press bubble changes the assignee and then navigates away from the list it was changed in.
 */

/** Decorative, as the real call sites pass — IconButton draws it inside an aria-hidden slot. */
const GLYPH = <svg viewBox="0 0 14 14" />;

describe('PropertyTrigger', () => {
  it('is named by the value and described by the verb', async () => {
    const user = userEvent.setup();
    render(
      <PropertyTrigger name="In Progress" action="Change status" open={false} onOpen={() => {}}>
        {GLYPH}
      </PropertyTrigger>,
    );

    const button = screen.getByRole('button', { name: 'In Progress' });

    // The hint is reachable from the keyboard, which in a product driven by chords is the
    // only way most people meet it. Tooltip shows on focus without the hover delay.
    await user.tab();
    expect(button).toBe(document.activeElement);
    expect(screen.getByRole('tooltip').textContent).toBe('Change status');

    // And it is attached as the description rather than left as a purely visual hint —
    // IconButton only skips that when the tip repeats the name, which here it never does.
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('Change status');
  });

  it('reports the open state of the menu it opened', () => {
    const { rerender } = render(
      <PropertyTrigger name="In Progress" action="Change status" open={false} onOpen={() => {}}>
        {GLYPH}
      </PropertyTrigger>,
    );

    const button = screen.getByRole('button', { name: 'In Progress' });
    expect(button.getAttribute('aria-expanded')).toBe('false');

    // Open is owned by the surface holding the single picker, not by the trigger — so the
    // attribute has to follow a prop, and following it is the thing worth asserting.
    rerender(
      <PropertyTrigger name="In Progress" action="Change status" open onOpen={() => {}}>
        {GLYPH}
      </PropertyTrigger>,
    );
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('hands the menu its own button and leaves the row alone', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <PropertyTrigger name="In Progress" action="Change status" open={false} onOpen={onOpen}>
          {GLYPH}
        </PropertyTrigger>
      </div>,
    );

    const button = screen.getByRole('button', { name: 'In Progress' });
    await user.click(button);

    // The element itself, because that is what the menu anchors to and hands focus back to.
    expect(onOpen).toHaveBeenCalledWith(button);
    // The whole reason this is a component rather than a spread of useMenuTrigger's props.
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('leaves the tab order alone unless the surface roves', () => {
    const { rerender } = render(
      <PropertyTrigger name="In Progress" action="Change status" open={false} onOpen={() => {}}>
        {GLYPH}
      </PropertyTrigger>,
    );

    // In Peek and the detail rail these are ordinary focusable controls, and a tabindex
    // written there would be a decision nobody asked for.
    expect(screen.getByRole('button', { name: 'In Progress' }).getAttribute('tabindex')).toBeNull();

    // Inside a role="option" row it may not be a tab stop: that listbox navigates by
    // aria-activedescendant, and a stop inside an option breaks the roving model.
    rerender(
      <PropertyTrigger
        name="In Progress"
        action="Change status"
        open={false}
        roving
        onOpen={() => {}}
      >
        {GLYPH}
      </PropertyTrigger>,
    );
    expect(screen.getByRole('button', { name: 'In Progress' }).getAttribute('tabindex')).toBe('-1');
  });
});
