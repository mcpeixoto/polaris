import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SaveIndicator, useSaveState } from './SaveIndicator';

describe('SaveIndicator', () => {
  // Polite, not assertive: a save confirmation must not talk over the field the user is
  // still typing in.
  it('is a polite status region', () => {
    render(<SaveIndicator state="saved" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Saved');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  // The element stays mounted so the live region exists before it has anything to say —
  // a region inserted at the same moment as its text is not reliably announced.
  it('stays mounted and empty when idle', () => {
    render(<SaveIndicator state="idle" />);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  // Failure has a reason and belongs beside the control; this slot only carries good news,
  // so its silence never doubles as a claim that the write succeeded.
  it('says nothing at all when the write failed', () => {
    render(<SaveIndicator state="failed" />);
    expect(screen.getByRole('status').textContent).toBe('');
  });
});

describe('useSaveState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports saving, then saved, then settles back to idle', async () => {
    const { result } = renderHook(() => useSaveState());

    let resolve = () => {};
    const write = new Promise<void>((done) => {
      resolve = done;
    });

    let ran: Promise<boolean> = Promise.resolve(false);
    act(() => {
      ran = result.current.run(() => write);
    });
    expect(result.current.state).toBe('saving');

    await act(async () => {
      resolve();
      await ran;
    });
    expect(result.current.state).toBe('saved');

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(result.current.state).toBe('idle');
  });

  // The boolean is what lets a caller undo an optimistic patch, so a refusal has to be
  // distinguishable from a success by the return value and not only by the state.
  it('resolves false and keeps the reason when the write is refused', async () => {
    const { result } = renderHook(() => useSaveState());

    let landed = true;
    await act(async () => {
      landed = await result.current.run(() => Promise.reject(new Error('Refused by the server.')));
    });

    expect(landed).toBe(false);
    expect(result.current.state).toBe('failed');
    expect(result.current.error).toBe('Refused by the server.');
  });

  it('drops a failure when the field is edited again', async () => {
    const { result } = renderHook(() => useSaveState());

    await act(async () => {
      await result.current.run(() => Promise.reject(new Error('Refused.')));
    });
    act(() => {
      result.current.clear();
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBeUndefined();
  });
});
