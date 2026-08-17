import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  clear,
  EMPTY_SELECTION,
  extendTo,
  isEmpty,
  ordered,
  reconcile,
  replace,
  selectAll,
  toggle,
  useSelection,
  type Selection,
} from './useSelection';

/**
 * The list is where range-select bugs hide, and every one of them is a disagreement
 * between the order the user is looking at and the order the selection was measured
 * against. So most of what follows changes the order between two gestures and asserts what
 * comes out — which is exactly what a delta, a filter or a teammate's status change does
 * to a live list.
 */

const LIST = ['a', 'b', 'c', 'd', 'e'];

function selected(selection: Selection): string[] {
  return ordered(selection, LIST);
}

describe('selection', () => {
  it('starts empty', () => {
    expect(isEmpty(EMPTY_SELECTION)).toBe(true);
    expect(selected(EMPTY_SELECTION)).toEqual([]);
  });

  it('toggles one id on and off again', () => {
    const on = toggle(EMPTY_SELECTION, 'c');
    expect(selected(on)).toEqual(['c']);

    const off = toggle(on, 'c');
    expect(isEmpty(off)).toBe(true);
  });

  it('anchors on the last id toggled, so a range starts where the user last touched', () => {
    const first = toggle(EMPTY_SELECTION, 'b');
    const second = toggle(first, 'd');
    expect(second.anchor).toBe('d');

    expect(selected(extendTo(second, LIST, 'e'))).toEqual(['b', 'd', 'e']);
  });

  it('replaces the selection and keeps the anchor on the replacement', () => {
    const many = selectAll(EMPTY_SELECTION, LIST);
    const one = replace(many, 'c');

    expect(selected(one)).toEqual(['c']);
    expect(one.anchor).toBe('c');
  });

  it('returns the same value for a redundant replace, so nothing re-renders', () => {
    const one = replace(EMPTY_SELECTION, 'c');
    expect(replace(one, 'c')).toBe(one);
  });

  it('returns the same value for a redundant clear', () => {
    expect(clear(EMPTY_SELECTION)).toBe(EMPTY_SELECTION);
  });

  it('selects a range in either direction', () => {
    const down = extendTo(toggle(EMPTY_SELECTION, 'b'), LIST, 'd');
    expect(selected(down)).toEqual(['b', 'c', 'd']);

    const up = extendTo(toggle(EMPTY_SELECTION, 'd'), LIST, 'b');
    expect(selected(up)).toEqual(['b', 'c', 'd']);
  });

  it('shrinks the range when the extension comes back towards the anchor', () => {
    let selection = toggle(EMPTY_SELECTION, 'a');
    selection = extendTo(selection, LIST, 'd');
    expect(selected(selection)).toEqual(['a', 'b', 'c', 'd']);

    // The whole point of remembering the base: extending is not accumulating, so coming
    // back up gives the range the user is pointing at rather than the union of every range
    // they passed through on the way.
    selection = extendTo(selection, LIST, 'b');
    expect(selected(selection)).toEqual(['a', 'b']);
  });

  it('keeps a selection made before the range gesture began', () => {
    let selection = toggle(EMPTY_SELECTION, 'e');
    selection = toggle(selection, 'a');
    selection = extendTo(selection, LIST, 'c');

    expect(selected(selection)).toEqual(['a', 'b', 'c', 'e']);

    // …and shrinking the range leaves the earlier selection alone.
    selection = extendTo(selection, LIST, 'b');
    expect(selected(selection)).toEqual(['a', 'b', 'e']);
  });

  it('anchors on the fallback when nothing has been selected yet', () => {
    // Shift-down from a cursor that has been moved with j/k but never used to select. The
    // cursor row is the anchor, or the gesture would select one row and call it a range.
    const selection = extendTo(EMPTY_SELECTION, LIST, 'c', 'b');
    expect(selected(selection)).toEqual(['b', 'c']);
  });

  it('selects a single row when there is no anchor and no fallback', () => {
    expect(selected(extendTo(EMPTY_SELECTION, LIST, 'c'))).toEqual(['c']);
  });

  it('ignores an extension to an id that is not in the list', () => {
    const selection = toggle(EMPTY_SELECTION, 'b');
    expect(extendTo(selection, LIST, 'zz')).toBe(selection);
  });

  describe('when the list is reordered between two gestures', () => {
    // The classic bug: the anchor is remembered as a row number, the list moves, and the
    // range is measured against a position that now holds something else entirely.
    const REORDERED = ['e', 'd', 'c', 'b', 'a'];

    it('measures the range in the order in force at the time of the gesture', () => {
      const anchored = toggle(EMPTY_SELECTION, 'b');
      expect(anchored.anchor).toBe('b');

      const extended = extendTo(anchored, REORDERED, 'd');

      // b..d in the reordered list is d, c, b — not the b, c, d that the positions in the
      // original list would have produced.
      expect(ordered(extended, REORDERED)).toEqual(['d', 'c', 'b']);
    });

    it('re-anchors on the target when the anchored row has left the list', () => {
      const anchored = toggle(EMPTY_SELECTION, 'b');
      const shorter = ['c', 'd', 'e'];

      const extended = extendTo(anchored, shorter, 'e', 'd');

      // 'b' is gone, so the fallback — the cursor row — anchors the range instead of a
      // vanished row silently selecting from the top of the list.
      expect(ordered(extended, shorter)).toEqual(['d', 'e']);
    });

    it('selects only what is on screen after a filter narrows the list', () => {
      const all = selectAll(EMPTY_SELECTION, LIST);
      const filtered = ['a', 'c', 'e'];

      const kept = reconcile(all, filtered);

      expect(ordered(kept, filtered)).toEqual(['a', 'c', 'e']);
      expect(kept.ids.has('b')).toBe(false);
    });
  });

  describe('select all', () => {
    it('takes everything and anchors end to end', () => {
      const all = selectAll(EMPTY_SELECTION, LIST);
      expect(selected(all)).toEqual(LIST);
      expect(all.anchor).toBe('a');
      expect(all.lead).toBe('e');
    });

    it('clears when the list is empty rather than selecting nothing loudly', () => {
      expect(selectAll(selectAll(EMPTY_SELECTION, LIST), [])).toBe(EMPTY_SELECTION);
    });
  });

  describe('reconcile', () => {
    it('returns the same value when nothing was dropped', () => {
      const selection = selectAll(EMPTY_SELECTION, LIST);
      expect(reconcile(selection, LIST)).toBe(selection);
    });

    it('forgets an anchor whose row has gone', () => {
      const selection = toggle(EMPTY_SELECTION, 'b');
      const kept = reconcile(selection, ['a', 'c']);

      expect(kept.anchor).toBeNull();
      expect(kept.ids.size).toBe(0);
    });

    it('leaves a still-present anchor alone', () => {
      const selection = toggle(EMPTY_SELECTION, 'b');
      expect(reconcile(selection, ['a', 'b']).anchor).toBe('b');
    });

    it('drops the remembered base as well, so a later extension cannot resurrect a row', () => {
      let selection = toggle(EMPTY_SELECTION, 'e');
      selection = toggle(selection, 'a');
      selection = extendTo(selection, LIST, 'b');
      expect(selected(selection)).toEqual(['a', 'b', 'e']);

      const withoutE = ['a', 'b', 'c', 'd'];
      const kept = reconcile(selection, withoutE);
      const extended = extendTo(kept, withoutE, 'd');

      expect(ordered(extended, withoutE)).toEqual(['a', 'b', 'c', 'd']);
    });
  });
});

describe('useSelection', () => {
  it('reconciles against the order it is given, in the same render', () => {
    const { result, rerender } = renderHook(({ order }) => useSelection(order), {
      initialProps: { order: LIST },
    });

    act(() => {
      result.current.toggle('b');
      result.current.extendTo('d');
    });
    expect(result.current.ordered).toEqual(['b', 'c', 'd']);

    // The list loses a selected row, as a delta from another session would do.
    rerender({ order: ['a', 'b', 'd', 'e'] });

    expect(result.current.ordered).toEqual(['b', 'd']);
    expect(result.current.size).toBe(2);
  });

  it('extends over the current order after a reorder, not the one the anchor was set in', () => {
    const { result, rerender } = renderHook(({ order }) => useSelection(order), {
      initialProps: { order: LIST },
    });

    act(() => result.current.toggle('b'));
    rerender({ order: ['e', 'd', 'c', 'b', 'a'] });
    act(() => result.current.extendTo('d'));

    expect(result.current.ordered).toEqual(['d', 'c', 'b']);
  });

  it('keeps its methods stable so registered actions never go stale', () => {
    const { result, rerender } = renderHook(({ order }) => useSelection(order), {
      initialProps: { order: LIST },
    });
    const first = result.current.toggle;

    act(() => result.current.toggle('c'));
    rerender({ order: ['a', 'c'] });

    expect(result.current.toggle).toBe(first);
    // …and the stable method still sees the current selection rather than the one it
    // closed over, which is the failure this stability is bought to avoid.
    act(() => result.current.toggle('c'));
    expect(result.current.size).toBe(0);
  });

  it('selects everything currently listed and clears again', () => {
    const { result } = renderHook(() => useSelection(LIST));

    act(() => result.current.selectAll());
    expect(result.current.ordered).toEqual(LIST);

    act(() => result.current.clear());
    expect(result.current.size).toBe(0);
  });
});
