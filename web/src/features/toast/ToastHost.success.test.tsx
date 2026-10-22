import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { clearToasts, offerError, offerSuccess, ToastHost } from './ToastHost';

/**
 * Where a confirmation is announced.
 *
 * The host's two regions are split on `tone === 'error'`, so a third tone lands in the polite
 * one without anything being added for it — and that is the point worth holding in a test,
 * because the alternative is a success that interrupts a screen reader mid-sentence to say
 * something went right.
 */

afterEach(() => {
  act(() => clearToasts());
});

describe('a success toast', () => {
  it('is announced politely, never as an alert', () => {
    render(<ToastHost />);

    act(() => {
      offerSuccess({ title: 'Merged Acme into Globex' });
    });

    expect(screen.getByRole('status').textContent).toContain('Merged Acme into Globex');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sits beside a failure rather than in place of it', () => {
    render(<ToastHost />);

    act(() => {
      offerError({ title: "Couldn't save that change" });
      offerSuccess({ title: 'Deleted the dashboard' });
    });

    expect(screen.getByRole('alert').textContent).toContain("Couldn't save that change");
    expect(screen.getByRole('status').textContent).toContain('Deleted the dashboard');
  });
});
