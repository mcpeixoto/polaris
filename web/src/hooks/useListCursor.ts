/**
 * The keyboard cursor over an ordered list, and the actions that move it.
 *
 * Nine list screens in this product register no keyboard actions at all, because the cursor,
 * the multi-select and the chords that drive them were written into the issue list and stayed
 * there. `j` doing nothing on Projects is not nine small omissions; it is one piece of
 * machinery that was never a piece. This is that piece.
 *
 * Two things it will not do, both learned from the issue list.
 *
 * It does not hold the cursor as an index. A list that remembers "row 4" points at a
 * different thing the moment a delta inserts a row above it, and a list that remembers only
 * the id loses its place entirely when that id is archived out from under it. So both are
 * kept and resolved in order of confidence: the row still holding that id, else the id
 * wherever it moved to, else the row that took its place — the next one down, not the top,
 * because a cursor that jumps to row one on every delete means pressing a key twice acts on
 * the row you meant and then on the first row of the whole screen.
 *
 * It does not rebuild its actions as the cursor moves. The registry captures an action's
 * `run` once, at registration (see `app/keymap`), so every command is reached through a ref
 * that the current render refreshes — the same discipline `useSelection` documents, for the
 * same reason. That also means the registration is torn down exactly once, on unmount, which
 * is what lets two lists mount in sequence under the same `prefix` without the registry
 * rejecting the second as a duplicate id.
 *
 * The caller pushes `useKeyContext('list')` itself. A screen knows whether its list is the
 * thing the keyboard is pointed at; a hook mounted inside a panel does not.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { useActions } from '~/app/keymap';
import type { UUID } from '~/store';

import { useSelection, type SelectionApi } from './useSelection';

/** What a row spreads onto its element so the cursor and the selection are visible and heard. */
export interface ListRowProps {
  id: string;
  'aria-selected': boolean;
  /** Present only on the cursor row, for CSS and for the tests that assert where it is. */
  'data-cursor'?: '' | undefined;
}

export interface ListCursorOptions {
  /** The list in the order it is drawn, headers and dividers already flattened out. */
  ids: readonly UUID[];
  /** Namespace for the registered action ids, e.g. `'projectList'`. */
  prefix: string;
  /** Enter, and a double click. Not called when the list is empty. */
  onOpen?: ((id: UUID) => void) | undefined;
  /**
   * What one row is, in the titles the help overlay and the command menu show: "Select
   * project". Singular and lowercase; the plural for "Select all" is this plus an `s`.
   */
  noun?: string | undefined;
}

export interface ListCursorApi {
  /** The row the keyboard is on, or null when the list is empty. */
  cursorId: UUID | null;
  selection: SelectionApi;
  /** Moves the cursor, e.g. from a click or a focus event. Null parks it at the first row. */
  setCursor(id: UUID | null): void;
  rowProps(id: UUID): ListRowProps;
}

/** The DOM id of one row, namespaced so two lists on one screen cannot collide. */
export function listRowDomId(prefix: string, id: UUID): string {
  return `${prefix}-row-${id}`;
}

interface Commands {
  move(delta: number): void;
  extend(delta: number): void;
  toggle(): void;
  selectAll(): void;
  clearSelection(): void;
  hasSelection(): boolean;
  hasRows(): boolean;
  open(): void;
}

export function useListCursor({
  ids,
  prefix,
  onOpen,
  noun = 'item',
}: ListCursorOptions): ListCursorApi {
  const selection = useSelection(ids);
  const [held, setHeld] = useState<{ index: number; id: UUID } | null>(null);

  const cursorId = useMemo<UUID | null>(() => {
    if (ids.length === 0) return null;
    if (held === null) return ids[0] ?? null;
    if (ids[held.index] === held.id) return held.id;

    const moved = ids.indexOf(held.id);
    if (moved !== -1) return held.id;

    // Gone: the row below is where the eye already is, and the row below the last one is
    // the last one.
    return ids[Math.min(held.index, ids.length - 1)] ?? null;
  }, [ids, held]);

  const setCursor = useCallback(
    (id: UUID | null) => {
      if (id === null) {
        setHeld(null);
        return;
      }
      const at = ids.indexOf(id);
      if (at === -1) return;
      setHeld({ index: at, id });
    },
    [ids],
  );

  const commands = useRef<Commands>({
    move: () => {},
    extend: () => {},
    toggle: () => {},
    selectAll: () => {},
    clearSelection: () => {},
    hasSelection: () => false,
    hasRows: () => false,
    open: () => {},
  });

  /** The row `delta` steps from the cursor, clamped to the ends. */
  const step = (delta: number): UUID | null => {
    if (ids.length === 0) return null;
    const at = cursorId === null ? 0 : Math.max(ids.indexOf(cursorId), 0);
    const next = ids[Math.min(Math.max(at + delta, 0), ids.length - 1)];
    return next ?? null;
  };

  const land = (id: UUID) => setHeld({ index: ids.indexOf(id), id });

  commands.current = {
    move: (delta) => {
      const next = step(delta);
      if (next !== null) land(next);
    },
    extend: (delta) => {
      const next = step(delta);
      if (next === null) return;
      // The cursor is the fallback anchor, so the first shift-arrow of a gesture takes the
      // row the user is on as well as the one they are moving to.
      selection.extendTo(next, cursorId);
      land(next);
    },
    toggle: () => {
      if (cursorId !== null) selection.toggle(cursorId);
    },
    selectAll: () => selection.selectAll(),
    clearSelection: () => selection.clear(),
    hasSelection: () => selection.size > 0,
    hasRows: () => ids.length > 0,
    open: () => {
      if (cursorId !== null) onOpen?.(cursorId);
    },
  };

  useActions(
    [
      {
        id: `${prefix}.moveDown`,
        title: 'Move down',
        keys: ['j', 'ArrowDown'],
        when: 'list',
        group: 'Navigation',
        // Hidden from the command menu: "Move down" is not something anybody searches for,
        // and it still appears in the help overlay, which is where it belongs.
        hidden: true,
        run: () => commands.current.move(1),
      },
      {
        id: `${prefix}.moveUp`,
        title: 'Move up',
        keys: ['k', 'ArrowUp'],
        when: 'list',
        group: 'Navigation',
        hidden: true,
        run: () => commands.current.move(-1),
      },
      {
        id: `${prefix}.extendDown`,
        title: 'Extend selection down',
        keys: ['shift+ArrowDown'],
        when: 'list',
        group: 'Selection',
        run: () => commands.current.extend(1),
      },
      {
        id: `${prefix}.extendUp`,
        title: 'Extend selection up',
        keys: ['shift+ArrowUp'],
        when: 'list',
        group: 'Selection',
        run: () => commands.current.extend(-1),
      },
      {
        id: `${prefix}.toggleSelected`,
        title: `Select ${noun}`,
        keys: ['x'],
        when: 'list',
        group: 'Selection',
        run: () => commands.current.toggle(),
      },
      {
        id: `${prefix}.selectAll`,
        title: `Select all ${noun}s`,
        keys: ['mod+a'],
        when: 'list',
        group: 'Selection',
        run: () => commands.current.selectAll(),
      },
      {
        id: `${prefix}.clearSelection`,
        title: 'Clear selection',
        keys: ['Escape'],
        when: 'list',
        group: 'Selection',
        hidden: true,
        // Disabled is treated as unbound, so with nothing selected Escape falls through to
        // the shell's dismiss instead of being swallowed by a command with nothing to do.
        enabled: () => commands.current.hasSelection(),
        run: () => commands.current.clearSelection(),
      },
      {
        id: `${prefix}.open`,
        title: `Open ${noun}`,
        keys: ['Enter'],
        when: 'list',
        group: 'Navigation',
        enabled: () => commands.current.hasRows(),
        run: () => commands.current.open(),
      },
    ],
    [prefix, noun],
  );

  const rowProps = useCallback(
    (id: UUID): ListRowProps => ({
      id: listRowDomId(prefix, id),
      'aria-selected': selection.ids.has(id),
      ...(id === cursorId ? { 'data-cursor': '' as const } : null),
    }),
    [prefix, selection.ids, cursorId],
  );

  return { cursorId, selection, setCursor, rowProps };
}
