import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '~/sync/api';

import { useDialogSubmit } from './useDialogSubmit';

/**
 * The test that justifies the hook is the first one: two submits in the same tick must
 * produce one create. It is written without `await`ing between the two calls on purpose,
 * because that is the shape of the bug — a ref read synchronously, not a state read a
 * frame later.
 */
describe('useDialogSubmit', () => {
  it('drops a second submit made in the same tick as the first', async () => {
    const { result } = renderHook(() => useDialogSubmit('Could not create the thing'));

    let creates = 0;
    let release = () => {};
    const create = async () => {
      creates += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.submit(create);
      second = result.current.submit(create);
    });

    expect(await second).toBe(false);
    expect(creates).toBe(1);

    await act(async () => {
      release();
      await first;
    });
    expect(creates).toBe(1);
  });

  it('lets the next submit through once the first has settled', async () => {
    const { result } = renderHook(() => useDialogSubmit('Could not create the thing'));
    let creates = 0;
    const create = async () => {
      creates += 1;
    };

    await act(async () => {
      await result.current.submit(create);
    });
    await act(async () => {
      await result.current.submit(create);
    });

    expect(creates).toBe(2);
  });

  it('surfaces the message an ApiError refusal carries', async () => {
    const { result } = renderHook(() => useDialogSubmit('Could not create the thing'));

    await act(async () => {
      await result.current.submit(() => {
        throw new ApiError('VALIDATION', 'A project needs a team.');
      });
    });

    expect(result.current.error).toBe('A project needs a team.');
  });

  it('falls back to the dialog’s own sentence for a failure that is not an ApiError', async () => {
    const { result } = renderHook(() => useDialogSubmit('Could not create the thing'));

    await act(async () => {
      await result.current.submit(() => {
        throw new TypeError('undefined is not a function');
      });
    });

    expect(result.current.error).toBe('Could not create the thing');
  });

  it('resets saving when the create is refused, so the button can be pressed again', async () => {
    const { result } = renderHook(() => useDialogSubmit('Could not create the thing'));

    await act(async () => {
      await result.current.submit(() => Promise.reject(new ApiError('INTERNAL', 'Nope')));
    });

    expect(result.current.saving).toBe(false);

    let retried = false;
    await act(async () => {
      await result.current.submit(async () => {
        retried = true;
      });
    });
    expect(retried).toBe(true);
  });

  it('clears a previous refusal when a new attempt starts', async () => {
    const { result } = renderHook(() => useDialogSubmit('Could not create the thing'));

    await act(async () => {
      await result.current.submit(() => Promise.reject(new ApiError('INTERNAL', 'Nope')));
    });
    expect(result.current.error).toBe('Nope');

    await act(async () => {
      await result.current.submit(async () => {});
    });
    expect(result.current.error).toBeNull();
  });

  it('keeps setError for the validation the dialog does itself', () => {
    const { result } = renderHook(() => useDialogSubmit('Could not create the thing'));

    act(() => result.current.setError('A project needs a name.'));
    expect(result.current.error).toBe('A project needs a name.');
  });

  it('hands out one submitRef for the lifetime of the dialog', () => {
    const { result, rerender } = renderHook(() => useDialogSubmit('Could not create the thing'));
    const ref = result.current.submitRef;
    rerender();
    expect(result.current.submitRef).toBe(ref);
  });

  /**
   * "Create more" files and keeps the dialog up, so nothing else ever drops `saving` — its
   * primary button would spin for the rest of the sitting. `reset` is that branch's ending,
   * and it is a separate call precisely because the ordinary ending is the opposite: a
   * button that returns to its resting label a frame before the dialog closes reads as a
   * failure.
   */
  it('drops saving on demand, for a dialog that stays open after a create', async () => {
    const { result } = renderHook(() => useDialogSubmit('Could not create the thing'));

    await act(async () => {
      await result.current.submit(async () => {});
    });
    expect(result.current.saving).toBe(true);

    act(() => result.current.reset());
    expect(result.current.saving).toBe(false);
  });
  /**
   * A "create more" run stays open, so the button has to come back. `submit` leaves
   * `saving` set on success — the ordinary ending is a dialog that closes — and a dialog
   * that files and stays would otherwise be left with a primary button spinning over work
   * that finished, refusing the next create.
   */
  it('drops the spinner on reset, for a dialog that files and stays', async () => {
    const { result } = renderHook(() => useDialogSubmit('Could not create the thing'));

    await act(async () => {
      await result.current.submit(async () => {});
    });
    expect(result.current.saving).toBe(true);

    act(() => result.current.reset());

    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
