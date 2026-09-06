/**
 * The toast stack shares the bottom-left corner with the undo toast, and steps out of its
 * way — a failure raised during an undo window has to land above the offer, not on the
 * button that takes something back.
 */

import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { publish } from '~/features/undo/offers';
import { EMPTY_UNDO_STACK, record } from '~/features/undo/undo';

import { clearToasts, showToast, ToastHost } from './ToastHost';

afterEach(() => {
  act(() => {
    clearToasts();
    publish(EMPTY_UNDO_STACK);
  });
});

describe('ToastHost beside the undo toast', () => {
  it('sits in the corner until an undo is on offer, then lifts above it', () => {
    const { container } = render(<ToastHost />);
    act(() => {
      showToast({ title: 'Copied link' });
    });
    const host = container.firstElementChild;
    expect(host?.getAttribute('data-above-undo')).toBeNull();

    act(() => {
      publish(record(EMPTY_UNDO_STACK, { id: 'u1', label: 'Deleted ENG-4', undo: async () => {} }));
    });
    expect(host?.getAttribute('data-above-undo')).toBe('true');

    act(() => {
      publish(EMPTY_UNDO_STACK);
    });
    expect(host?.getAttribute('data-above-undo')).toBeNull();
  });
});
