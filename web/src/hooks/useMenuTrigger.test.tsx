import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useMenuTrigger, type MenuTrigger } from './useMenuTrigger';

/**
 * The anchor is a question asked at read time, and these tests are about the difference
 * between asking and having asked.
 *
 * Everything else here — a boolean and two ARIA attributes — is the sort of thing a test
 * can only restate. What is worth pinning down is that `ref` resolves when Menu reads it
 * rather than when `show` was called, and that an element named by `showFrom` never
 * survives into the next opening.
 */

/** Somewhere for a test to reach the hook's return value from outside the tree. */
type Sink = { current: MenuTrigger | null };

function latest(sink: Sink): MenuTrigger {
  if (sink.current === null) throw new Error('the harness has not rendered');
  return sink.current;
}

/**
 * A trigger that does not exist until the menu is open.
 *
 * This is the issue list's bulk toolbar: nothing is selected, so the toolbar is not mounted,
 * and pressing `S` both mounts it and opens the picker hanging off it.
 */
function LateTrigger({ sink }: { sink: Sink }) {
  const trigger = useMenuTrigger();
  sink.current = trigger;
  return trigger.open ? <button {...trigger.props}>Status</button> : null;
}

/** A registered trigger and a row glyph the same picker can be told to hang off instead. */
function RowAndTrigger({ sink }: { sink: Sink }) {
  const trigger = useMenuTrigger();
  sink.current = trigger;
  return (
    <>
      <button {...trigger.props}>Status</button>
      <button>Row glyph</button>
    </>
  );
}

describe('useMenuTrigger', () => {
  it('resolves the anchor when it is read, not when the menu was opened', () => {
    const sink: Sink = { current: null };
    render(<LateTrigger sink={sink} />);

    expect(latest(sink).ref.current).toBeNull();

    act(() => {
      latest(sink).show();
    });

    /*
     * The SelectionBar regression, and the reason `ref` is an object with a getter rather
     * than the plain ref it looks like it should be. An implementation that snapshotted the
     * element inside `show` would snapshot the `null` above — the trigger is mounted by the
     * commit that `show` schedules, and Menu measures it in a layout effect after that. Every
     * keyboard-opened picker in the list would then draw unpositioned, and no assertion on
     * coordinates could catch it, because every rect in jsdom is already zero.
     */
    expect(latest(sink).ref.current).toBe(screen.getByRole('button', { name: 'Status' }));
  });

  it('lets React write the registered trigger through props.ref', () => {
    const sink: Sink = { current: null };
    render(<RowAndTrigger sink={sink} />);

    // React assigns to `.current` on mount, and two call sites hand this same object
    // straight to JSX as a `ref`. A getter-only object would have thrown before this line.
    expect(latest(sink).ref.current).toBe(screen.getByRole('button', { name: 'Status' }));
  });

  it('anchors to the element showFrom named, and drops it on the next opening', () => {
    const sink: Sink = { current: null };
    render(<RowAndTrigger sink={sink} />);
    const registered = screen.getByRole('button', { name: 'Status' });
    const glyph = screen.getByRole('button', { name: 'Row glyph' });

    act(() => {
      latest(sink).showFrom(glyph);
    });
    expect(latest(sink).open).toBe(true);
    expect(latest(sink).ref.current).toBe(glyph);

    // A row element outliving its opening is the failure this clears: the menu would return
    // focus to a glyph in some row the user was not in, and position itself over it.
    act(() => {
      latest(sink).show();
    });
    expect(latest(sink).ref.current).toBe(registered);
  });

  it('clears the override on hide and on toggle as well as on show', () => {
    const sink: Sink = { current: null };
    render(<RowAndTrigger sink={sink} />);
    const registered = screen.getByRole('button', { name: 'Status' });
    const glyph = screen.getByRole('button', { name: 'Row glyph' });

    act(() => {
      latest(sink).showFrom(glyph);
    });
    act(() => {
      latest(sink).hide();
    });
    expect(latest(sink).open).toBe(false);
    expect(latest(sink).ref.current).toBe(registered);

    // Toggle is what the trigger's own click runs, so a stale row here would mean a picker
    // opened by pointer from the toolbar still anchored to whatever row opened it last.
    act(() => {
      latest(sink).showFrom(glyph);
    });
    act(() => {
      latest(sink).toggle();
    });
    expect(latest(sink).ref.current).toBe(registered);
  });

  it('falls back to the registered trigger when showFrom is given nothing', () => {
    const sink: Sink = { current: null };
    render(<RowAndTrigger sink={sink} />);
    const registered = screen.getByRole('button', { name: 'Status' });

    // So a caller with nothing to anchor to — a context menu opened from a chord — does not
    // have to branch between two ways of opening the same picker.
    act(() => {
      latest(sink).showFrom(null);
    });
    expect(latest(sink).open).toBe(true);
    expect(latest(sink).ref.current).toBe(registered);
  });
});
