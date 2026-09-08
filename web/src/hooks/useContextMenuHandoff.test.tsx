import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useContextMenuHandoff } from './useContextMenuHandoff';

describe('useContextMenuHandoff', () => {
  it('reports a hand-off once and then clears', () => {
    const { result } = renderHook(() => useContextMenuHandoff());

    expect(result.current.consume()).toBe(false);

    act(() => {
      result.current.begin();
    });
    expect(result.current.consume()).toBe(true);
    expect(result.current.consume()).toBe(false);
  });
});
