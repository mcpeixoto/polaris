import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineProvider } from '~/app/context';
import { KeymapProvider } from '~/app/keymap';
import { detectPlatform } from '~/keys';
import { Store } from '~/store';
import type { SyncEngine } from '~/sync/engine';

import { clearUndoOffers, offerUndo, UndoToast } from './UndoToast';
import {
  EMPTY_UNDO_STACK,
  expire,
  latest,
  record,
  take,
  UNDO_DEPTH,
  UNDO_WINDOW_MS,
  type UndoStack,
} from './undo';

const WORKSPACE = 'workspace-1';

/** jsdom is not a Mac, but it is not reliably not-a-Mac either. Ask the matcher. */
const MOD = detectPlatform() === 'mac' ? 'Meta' : 'Control';

function entry(id: string, undo: () => Promise<void> = () => Promise.resolve()) {
  return { id, label: `Deleted ${id.toUpperCase()}`, undo };
}

/** Fills the stack past its depth, oldest first. */
function filled(count: number, at = 0): UndoStack {
  let stack = EMPTY_UNDO_STACK;
  for (let i = 0; i < count; i++) stack = record(stack, entry(`e${i}`), at + i);
  return stack;
}

/**
 * The stack as a value.
 *
 * Only this level can prove the rules that make the offer trustworthy rather than merely
 * present: that an entry stops being runnable on a clock nobody has to remember to check, that
 * a long session cannot accumulate closures, and — the one that actually bites — that taking an
 * entry consumes it, so a double press restores one issue rather than sending two writes for
 * the same one.
 */
describe('the undo stack', () => {
  const NOW = 1_000_000;

  it('offers the newest entry, and nothing once its window has closed', () => {
    const stack = record(EMPTY_UNDO_STACK, entry('a'), NOW);

    expect(latest(stack, NOW)?.label).toBe('Deleted A');
    expect(latest(stack, NOW + UNDO_WINDOW_MS - 1)?.label).toBe('Deleted A');
    // The boundary itself is closed: at the instant the toast is due to go, the offer has
    // gone. Anything else would make "the toast is still there" an unreliable signal.
    expect(latest(stack, NOW + UNDO_WINDOW_MS)).toBeNull();
  });

  it('expires entries without being asked twice, and does not churn when nothing lapsed', () => {
    const stack = record(record(EMPTY_UNDO_STACK, entry('a'), NOW), entry('b'), NOW + 1000);

    // Identity, because the host publishes whatever this returns and an allocation per prune
    // would put its timer into a loop with itself.
    expect(expire(stack, NOW + 2000)).toBe(stack);

    const pruned = expire(stack, NOW + UNDO_WINDOW_MS + 1);
    expect(pruned.entries.map((e) => e.id)).toEqual(['b']);
    expect(expire(pruned, NOW + UNDO_WINDOW_MS + 1001).entries).toEqual([]);
  });

  it('holds a bounded number of entries, dropping the oldest', () => {
    const stack = filled(UNDO_DEPTH + 3);

    expect(stack.entries).toHaveLength(UNDO_DEPTH);
    // Every entry retains a closure over an engine and an id, so the bound is what stops a
    // long session from growing a leak that has nothing to do with what the user did.
    expect(stack.entries[0]?.id).toBe('e3');
    expect(stack.entries[UNDO_DEPTH - 1]?.id).toBe(`e${UNDO_DEPTH + 2}`);
  });

  it('refreshes an entry offered again rather than queueing a second one', () => {
    const once = record(EMPTY_UNDO_STACK, entry('a'), NOW);
    const twice = record(once, entry('a'), NOW + 5000);

    expect(twice.entries).toHaveLength(1);
    expect(latest(twice, NOW + UNDO_WINDOW_MS + 1)?.id).toBe('a');
  });

  it('hands an entry out once, so undoing twice runs the undo once', async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const stack = record(EMPTY_UNDO_STACK, entry('a', undo), NOW);

    const first = take(stack, 'a', NOW);
    const second = take(first.stack, 'a', NOW);

    expect(first.action).not.toBeNull();
    expect(second.action).toBeNull();

    await first.action?.undo();
    await second.action?.undo();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('drops an expired entry rather than running it late', () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const stack = record(EMPTY_UNDO_STACK, entry('a', undo), NOW);

    const result = take(stack, 'a', NOW + UNDO_WINDOW_MS);
    expect(result.action).toBeNull();
    expect(result.stack.entries).toEqual([]);
    expect(undo).not.toHaveBeenCalled();
  });
});

/**
 * The toast.
 *
 * What only a rendered one can show: that an offer made from anywhere in the application
 * reaches the single mounted host, that the announcement is a live region rather than a shape
 * in the corner of the screen, that it takes itself away on the clock, and that the shortcut
 * works because it was registered with the keymap rather than because a component is listening
 * for keys.
 */
describe('UndoToast', () => {
  function renderToast() {
    const store = new Store(WORKSPACE);
    const mutate = vi.fn().mockResolvedValue({});
    const engine = { store, mutate } as unknown as SyncEngine;

    render(
      // JSX would need a .tsx file, and this one is the undo module's test — the component is
      // here because it is the only surface the stack has, not because it is the subject. The
      // children go in the props object rather than as trailing arguments because React 19's
      // `createElement` types check them against the component's own props, and a provider
      // that declares `children` as required is not satisfied by the variadic form.
      createElement(MemoryRouter, {
        children: createElement(KeymapProvider, {
          children: createElement(EngineProvider, {
            engine,
            status: { phase: 'idle' },
            children: createElement(UndoToast),
          }),
        }),
      }),
    );

    return { user: userEvent.setup() };
  }

  function undoButton(): HTMLElement | null {
    return screen.queryByRole('button', { name: 'Undo' });
  }

  beforeEach(() => {
    // The stack is module state so that a click handler anywhere can reach it without a
    // context. That is exactly why it has to be emptied between tests.
    clearUndoOffers();
  });

  // Only the auto-dismissal test installs fake timers, and it is the only one that presses
  // nothing: user-event drives its own gestures through the real event loop, and a test that
  // fakes the clock underneath it waits forever for a keystroke that is never scheduled.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces the newest offer in a live region', () => {
    renderToast();
    expect(undoButton()).toBeNull();

    act(() => offerUndo({ label: 'Deleted ENG-42', undo: () => Promise.resolve() }));

    expect(screen.getByRole('status').textContent).toContain('Deleted ENG-42');
    expect(undoButton()).toBeTruthy();
  });

  it('takes itself away when the window elapses', () => {
    vi.useFakeTimers();
    renderToast();
    act(() => offerUndo({ label: 'Deleted ENG-42', undo: () => Promise.resolve() }));

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    });
    expect(undoButton()).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(undoButton()).toBeNull();
    // The region survives so the next offer is announced into a node the reader is already
    // subscribed to; only its contents went.
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('shows the newest offer when two arrive', () => {
    renderToast();
    act(() => offerUndo({ label: 'Deleted ENG-1', undo: () => Promise.resolve() }));
    act(() => offerUndo({ label: 'Deleted ENG-2', undo: () => Promise.resolve() }));

    expect(screen.getByRole('status').textContent).toContain('Deleted ENG-2');
    expect(screen.getByRole('status').textContent).not.toContain('Deleted ENG-1');
  });

  it('runs the undo when the button is pressed, and dismisses itself', async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const { user } = renderToast();
    act(() => offerUndo({ label: 'Deleted ENG-42', undo }));

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(undo).toHaveBeenCalledTimes(1);
    expect(undoButton()).toBeNull();
  });

  it('runs the undo from the keymap, not from a handler of its own', async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const { user } = renderToast();
    act(() => offerUndo({ label: 'Deleted ENG-42', undo }));

    await user.keyboard(`{${MOD}>}z{/${MOD}}`);

    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('does nothing on the shortcut once the offer has lapsed', async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const { user } = renderToast();
    act(() => offerUndo({ label: 'Deleted ENG-42', undo }));

    // The clock is faked, the timers are not: user-event needs a real event loop to press
    // keys through, and what is under test here is the gate on the action rather than the
    // toast's own dismissal — the registry asks `enabled` at the instant the key is struck.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + UNDO_WINDOW_MS);

    await user.keyboard(`{${MOD}>}z{/${MOD}}`);

    // A disabled action is treated as unbound, so the keystroke falls through to whatever
    // else wants it rather than being swallowed by a command with nothing to undo.
    expect(undo).not.toHaveBeenCalled();
  });
});
