import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearToasts, offerError, showToast, ToastHost } from './ToastHost';

/**
 * The host's job is announcing, and these tests hold it to that from the outside: which live
 * region a message lands in, whether it survives long enough to be read, and whether pressing
 * Retry runs the caller's closure exactly once.
 *
 * `showToast` is a plain function call into a module-level store rather than a state setter,
 * which is the whole point of it — so the calls are wrapped in `act` here, the way any
 * external store push has to be.
 */

afterEach(() => {
  act(() => clearToasts());
  vi.useRealTimers();
});

function raise(fn: () => void): void {
  act(fn);
}

describe('ToastHost', () => {
  it('puts a failure in the assertive region and a confirmation in the polite one', () => {
    render(<ToastHost />);

    raise(() => {
      offerError({ title: "Couldn't update issue", description: 'Not allowed' });
      showToast({ title: 'Copied link' });
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't update issue");
    expect(alert.textContent).toContain('Not allowed');
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Copied link');
    // The failure must not also be announced politely, or a screen reader says it twice.
    expect(status.textContent).not.toContain("Couldn't update issue");
  });

  // The regions stay in the document, because a live region inserted already populated is
  // often never announced — but an empty one must not be named. A permanent `role="alert"`
  // is an alert on every screen in the product, saying nothing.
  it('names neither region until it has something to say', () => {
    render(<ToastHost />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    raise(() => showToast({ title: 'Copied link' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Copied link');

    raise(() => clearToasts());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows several failures at once rather than replacing the first', () => {
    render(<ToastHost />);

    raise(() => {
      offerError({ title: 'First failed' });
      offerError({ title: 'Second failed' });
    });

    expect(screen.getByText('First failed')).not.toBeNull();
    expect(screen.getByText('Second failed')).not.toBeNull();
  });

  it('offers Retry only when the caller passed one, and runs it once', async () => {
    const user = userEvent.setup();
    render(<ToastHost />);

    raise(() => offerError({ title: 'No retry here' }));
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    const retry = vi.fn();
    raise(() => offerError({ title: 'Could not archive', retry }));
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Could not archive')).toBeNull();
  });

  it('dismisses on the close button', async () => {
    const user = userEvent.setup();
    render(<ToastHost />);

    raise(() => showToast({ title: 'Copied link' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText('Copied link')).toBeNull();
  });

  it('takes itself down when its window closes', () => {
    vi.useFakeTimers();
    render(<ToastHost />);

    raise(() => showToast({ title: 'Copied link' }));
    expect(screen.getByText('Copied link')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByText('Copied link')).toBeNull();
  });

  it('stops the clock while the pointer is on it', () => {
    vi.useFakeTimers();
    const { container } = render(<ToastHost />);
    const host = container.firstElementChild as HTMLElement;

    raise(() => showToast({ title: 'Copied link' }));
    // Reading a toast must not cost the reader the toast. Dispatched directly rather than
    // through userEvent because that helper wants real timers.
    act(() => {
      host.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByText('Copied link')).not.toBeNull();
  });
});
