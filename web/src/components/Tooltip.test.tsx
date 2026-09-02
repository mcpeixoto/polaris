import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tooltip } from './Tooltip';

/**
 * The three things a tooltip owes that this one used not to: a way out that is not the
 * pointer, a position that stays on screen and follows the control it describes, and a
 * delay that is paid once per visit to a toolbar rather than once per button.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Tooltip', () => {
  it('dismisses on Escape while leaving the trigger focused', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip label="Archive issue">
        <button>Archive</button>
      </Tooltip>,
    );

    // Focus shows it immediately: landing on a control is a deliberate act, unlike a pointer
    // passing over one.
    const trigger = screen.getByRole('button', { name: 'Archive' });
    await user.tab();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('tooltip').textContent).toBe('Archive issue');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('tooltip')).toBeNull();
    // Escape dismissed the tip and nothing else — the focus that summoned it stays put.
    expect(document.activeElement).toBe(trigger);
  });

  it('shifts back on screen rather than hanging off the right edge', async () => {
    const user = userEvent.setup();
    // A trigger hard against the right edge, and a tip wider than the room left for it. The
    // flip cannot help: both `top` and `bottom` are equally off screen sideways.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.getAttribute('role') === 'tooltip') {
        return {
          top: 0,
          bottom: 24,
          left: window.innerWidth - 40,
          right: window.innerWidth + 160,
          width: 200,
          height: 24,
        } as DOMRect;
      }
      return {
        top: 100,
        bottom: 128,
        left: window.innerWidth - 30,
        right: window.innerWidth,
        width: 30,
        height: 28,
      } as DOMRect;
    });

    render(
      <Tooltip label="Open the display options for this view">
        <button>Display</button>
      </Tooltip>,
    );

    await user.tab();
    const tip = screen.getByRole('tooltip');
    // Anchored at the trigger's centre, then pulled left by the overhang plus the margin.
    const anchored = window.innerWidth - 15;
    expect(tip.style.left).toBe(`${anchored - (160 + 8)}px`);
  });

  it('opens the next hint in a group without making the user wait again', () => {
    vi.useFakeTimers();
    // Past whatever warm window the tests above left behind: the group timer is module-level
    // on purpose, and a test that assumed a cold start would pass by accident.
    vi.advanceTimersByTime(5_000);
    render(
      <>
        <Tooltip label="Archive">
          <button>One</button>
        </Tooltip>
        <Tooltip label="Snooze">
          <button>Two</button>
        </Tooltip>
      </>,
    );

    const one = screen.getByRole('button', { name: 'One' });
    const two = screen.getByRole('button', { name: 'Two' });

    fireEvent.mouseOver(one);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByRole('tooltip').textContent).toBe('Archive');

    fireEvent.mouseOut(one);
    fireEvent.mouseOver(two);

    // No timer advanced: the group is warm, so crossing a toolbar costs the delay once.
    expect(screen.getByRole('tooltip').textContent).toBe('Snooze');
  });
});
