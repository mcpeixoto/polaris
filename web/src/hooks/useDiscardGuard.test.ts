import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDiscardGuard } from './useDiscardGuard';

describe('useDiscardGuard', () => {
  it('closes straight away when there is nothing to lose', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useDiscardGuard(false, onClose));

    act(() => result.current.requestClose());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.confirming).toBe(false);
  });

  it('asks first when the dialog holds typing', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useDiscardGuard(true, onClose));

    act(() => result.current.requestClose());

    expect(result.current.confirming).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the dialog open, and its question dismissed, on "keep editing"', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useDiscardGuard(true, onClose));

    act(() => result.current.requestClose());
    act(() => result.current.keep());

    expect(result.current.confirming).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on discard, and lowers the question before it goes', () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useDiscardGuard(true, onClose));

    act(() => result.current.requestClose());
    act(() => result.current.discard());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.confirming).toBe(false);
  });

  it('follows the caller when the last field is emptied again', () => {
    const onClose = vi.fn();
    const { result, rerender } = renderHook(
      ({ dirty }: { dirty: boolean }) => useDiscardGuard(dirty, onClose),
      { initialProps: { dirty: true } },
    );

    rerender({ dirty: false });
    act(() => result.current.requestClose());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.confirming).toBe(false);
  });
});
