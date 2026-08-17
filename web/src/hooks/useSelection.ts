/**
 * Multi-select over an ordered list of ids.
 *
 * The whole module is written as pure functions over an immutable value, with a thin hook
 * at the bottom, because range-select is where list bugs live and a bug you can only
 * reproduce by clicking a virtualised list is a bug nobody fixes. Everything here is
 * testable without a DOM, and the tests beside it are the specification.
 *
 * Two decisions carry the design.
 *
 * The anchor is an **id**, never an index. A list that stores "the range started at row 12"
 * is wrong the instant a delta reorders it, a filter narrows it, or a teammate's status
 * change moves an issue into another group — and it is wrong silently, selecting a
 * different twelve rows than the ones the user is looking at. Resolving the anchor against
 * the order in force *at the moment of the gesture* is what makes shift-select survive a
 * list that is changing underneath it.
 *
 * A range gesture **replaces** its own previous range rather than accumulating. The
 * selection is remembered as it stood when the gesture began (`base`), and each extension
 * is that base plus the anchor-to-lead run. Without this, shift-down four times and back up
 * three leaves four rows selected instead of one, which is the behaviour every file manager
 * and every mail client has trained people out of expecting.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import type { UUID } from '~/store';

export interface Selection {
  /** The selected ids. The value every consumer reads. */
  readonly ids: ReadonlySet<UUID>;
  /** Where the live range gesture started. Null when there is no gesture to extend. */
  readonly anchor: UUID | null;
  /** The far end of the live range — where the next extension moves from. */
  readonly lead: UUID | null;
  /**
   * The selection as it stood before the live range gesture began. Extending recomputes
   * `ids` as this plus the current range, which is what makes an extension reversible.
   */
  readonly base: ReadonlySet<UUID>;
}

const NO_IDS: ReadonlySet<UUID> = new Set<UUID>();

export const EMPTY_SELECTION: Selection = {
  ids: NO_IDS,
  anchor: null,
  lead: null,
  base: NO_IDS,
};

/** Nothing is selected. Cheaper than reading `.ids.size` at every call site, and clearer. */
export function isEmpty(selection: Selection): boolean {
  return selection.ids.size === 0;
}

/**
 * The selection in list order.
 *
 * A `Set` iterates in insertion order, which is the order the user happened to click in —
 * fine for "how many", wrong for anything that applies an operation in sequence or reports
 * "moved 3 issues to In Progress" with the first one named.
 */
export function ordered(selection: Selection, order: readonly UUID[]): UUID[] {
  if (selection.ids.size === 0) return [];
  return order.filter((id) => selection.ids.has(id));
}

/** Everything and nothing else, anchored so a following shift-extension starts here. */
export function replace(selection: Selection, id: UUID): Selection {
  if (selection.ids.size === 1 && selection.ids.has(id) && selection.anchor === id) {
    return selection;
  }
  const ids: ReadonlySet<UUID> = new Set([id]);
  return { ids, anchor: id, lead: id, base: ids };
}

/**
 * Flips one id, and re-anchors on it.
 *
 * Re-anchoring is what makes "select this one, then shift-select down to there" work
 * without a separate gesture to place the anchor: the last row touched deliberately is
 * always where the next range begins.
 */
export function toggle(selection: Selection, id: UUID): Selection {
  const ids = new Set(selection.ids);
  if (!ids.delete(id)) ids.add(id);
  return { ids, anchor: id, lead: id, base: ids };
}

/**
 * Extends the range to `to`, over the order in force right now.
 *
 * `from` is the anchor to use when there is no live one — the cursor row, in a list where
 * the user has been moving without selecting. Falling back to `to` itself is the last
 * resort and selects a single row, which is the honest answer when nothing says where a
 * range would have started.
 *
 * An anchor that is no longer in `order` is treated as no anchor at all. That is the case
 * this function exists for: the anchored issue was archived, filtered out, or moved to
 * another group between the two keystrokes, and a range measured from a row that is not on
 * screen selects a span the user never indicated.
 */
export function extendTo(
  selection: Selection,
  order: readonly UUID[],
  to: UUID,
  from?: UUID | null,
): Selection {
  const target = order.indexOf(to);
  if (target === -1) return selection;

  const live =
    selection.anchor !== null && order.includes(selection.anchor) ? selection.anchor : null;
  const anchor = live ?? from ?? to;
  const start = order.indexOf(anchor);
  if (start === -1) return replace(selection, to);

  const [low, high] = start <= target ? [start, target] : [target, start];
  const ids = new Set(selection.base);
  for (let i = low; i <= high; i++) {
    const id = order[i];
    if (id !== undefined) ids.add(id);
  }
  return { ids, anchor, lead: to, base: selection.base };
}

/** Every id currently in the list, anchored end to end so a following extension shrinks it. */
export function selectAll(selection: Selection, order: readonly UUID[]): Selection {
  if (order.length === 0) return clear(selection);
  const ids: ReadonlySet<UUID> = new Set(order);
  const first = order[0] ?? null;
  const last = order[order.length - 1] ?? null;
  return { ids, anchor: first, lead: last, base: ids };
}

/** Returns the same value when it is already empty, so a redundant Escape is not a render. */
export function clear(selection: Selection): Selection {
  return selection.ids.size === 0 && selection.anchor === null ? selection : EMPTY_SELECTION;
}

/**
 * Drops everything the list no longer contains.
 *
 * Called whenever the order changes, and it is not housekeeping: a bulk action over a
 * selection holding ids that were archived by a teammate two minutes ago would send
 * mutations for issues the user cannot see, and the count in the toolbar would disagree
 * with the number of highlighted rows.
 *
 * Returns the same object when nothing was dropped, so the common case — a delta that did
 * not touch anything selected — costs a size comparison and no re-render.
 */
export function reconcile(selection: Selection, order: readonly UUID[]): Selection {
  if (selection.ids.size === 0 && selection.anchor === null && selection.base.size === 0) {
    return selection;
  }

  const present = new Set(order);
  const ids = keep(selection.ids, present);
  const base = keep(selection.base, present);
  const anchor =
    selection.anchor !== null && present.has(selection.anchor) ? selection.anchor : null;
  const lead = selection.lead !== null && present.has(selection.lead) ? selection.lead : null;

  if (
    ids === selection.ids &&
    base === selection.base &&
    anchor === selection.anchor &&
    lead === selection.lead
  ) {
    return selection;
  }
  return { ids, anchor, lead, base };
}

/** Filters a set, returning the original when every member survived. */
function keep(ids: ReadonlySet<UUID>, present: ReadonlySet<UUID>): ReadonlySet<UUID> {
  let dropped = false;
  for (const id of ids) {
    if (!present.has(id)) {
      dropped = true;
      break;
    }
  }
  if (!dropped) return ids;
  const kept = new Set<UUID>();
  for (const id of ids) if (present.has(id)) kept.add(id);
  return kept;
}

/** What a list gets back. Every method is stable for the life of the component. */
export interface SelectionApi {
  readonly ids: ReadonlySet<UUID>;
  readonly size: number;
  readonly anchor: UUID | null;
  readonly lead: UUID | null;
  /** The selection in list order — what a bulk action iterates. */
  readonly ordered: readonly UUID[];
  replace(id: UUID): void;
  toggle(id: UUID): void;
  extendTo(to: UUID, from?: UUID | null): void;
  selectAll(): void;
  clear(): void;
}

/**
 * Holds a selection against a list whose contents change under it.
 *
 * The reconciliation happens during render rather than in an effect. An effect would let
 * one frame through in which the toolbar says "4 selected" and only three rows are
 * highlighted — brief, but it is the frame in which the user presses the button.
 */
export function useSelection(order: readonly UUID[]): SelectionApi {
  const [stored, setStored] = useState<Selection>(EMPTY_SELECTION);
  const selection = useMemo(() => reconcile(stored, order), [stored, order]);

  // The keyboard actions are registered once and then read whatever is current, rather
  // than being rebuilt — and re-registered — on every cursor move. See app/keymap: an
  // action's `run` closure is captured at registration and never refreshed.
  const orderRef = useRef(order);
  orderRef.current = order;

  /**
   * Every mutation goes through the updater form, and reconciles inside it.
   *
   * Two gestures can land in one batch — a keystroke that selects and extends, a click
   * handler that does both — and a version reading the last rendered selection would apply
   * the second gesture to the state before the first.
   */
  const update = useCallback((apply: (current: Selection, order: readonly UUID[]) => Selection) => {
    setStored((previous) => {
      const current = orderRef.current;
      return apply(reconcile(previous, current), current);
    });
  }, []);

  return {
    ids: selection.ids,
    size: selection.ids.size,
    anchor: selection.anchor,
    lead: selection.lead,
    ordered: useMemo(() => ordered(selection, order), [selection, order]),
    replace: useCallback((id: UUID) => update((current) => replace(current, id)), [update]),
    toggle: useCallback((id: UUID) => update((current) => toggle(current, id)), [update]),
    extendTo: useCallback(
      (to: UUID, from?: UUID | null) =>
        update((current, order) => extendTo(current, order, to, from)),
      [update],
    ),
    selectAll: useCallback(() => update((current, order) => selectAll(current, order)), [update]),
    clear: useCallback(() => update(clear), [update]),
  };
}
