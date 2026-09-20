/**
 * Moving a group heading, as arithmetic over a list of keys.
 *
 * `groupIssues` decides what the groups *are* and, absent an opinion, what order they come
 * in. This is the opinion: the list the reader built by dragging a heading or pressing the
 * move chord, which `DisplayOptions.groupOrder` carries and the URL shares.
 *
 * It is separate from `group.ts` because it is about the keys and nothing else — no store,
 * no issues, no grouping dimension. A drag hands it the keys currently on screen and gets
 * back the keys as they should be, and that is the whole contract. Written against the keys
 * rather than against the groups so that the same two functions serve the list's headings
 * and the board's columns, which are the same arrangement seen turned ninety degrees.
 *
 * Both functions are given the keys **as currently drawn**, not the stored order. That is
 * the load-bearing detail: a stored order is usually partial — it names the groups somebody
 * has moved and says nothing about the rest — so reordering against it would drop every
 * group it does not mention. Taking the drawn order and returning a complete one means the
 * arrangement is always the full picture after the first move, and a group added later
 * still lands at the end because `groupIssues` puts unranked groups after ranked ones.
 */

/**
 * The order with `source` put where `target` currently sits.
 *
 * Drag up and the dragged group takes the target's place, pushing it down; drag down and it
 * lands just after the target. That asymmetry is not a special case in the code — removing
 * first and inserting at the target's original index produces both — and it is what the
 * pointer means in either direction: the thing you dropped is where you dropped it.
 *
 * Returns the input array unchanged when the move is a no-op, so a drop on a heading's own
 * self does not write a URL or a preference.
 */
export function reorderGroupKeys(
  keys: readonly string[],
  source: string,
  target: string,
): readonly string[] {
  const from = keys.indexOf(source);
  const to = keys.indexOf(target);
  if (from === -1 || to === -1 || from === to) return keys;
  const next = [...keys];
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}

/**
 * The order with `key` moved `delta` places — the keyboard's half of the drag.
 *
 * Clamped rather than wrapped. A group at the top that jumped to the bottom on one more
 * press of the same chord would be a list nobody could nudge into place without watching it,
 * and the press that does nothing is the one that says "this is already the top".
 */
export function shiftGroupKey(
  keys: readonly string[],
  key: string,
  delta: number,
): readonly string[] {
  const from = keys.indexOf(key);
  if (from === -1) return keys;
  const to = from + delta;
  if (to < 0 || to >= keys.length) return keys;
  const next = [...keys];
  next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}

/**
 * Whether a view's groups can be arranged at all.
 *
 * Two cases cannot, and both are about the key rather than about taste. Under no grouping
 * there is one run of rows and no heading to take hold of. Under swimlanes a key names two
 * dimensions at once (`status/assignee`), and the arrangement is applied before the lanes
 * are cut — so a dropped lane would be written into an order that the next render's keys no
 * longer match, and the move would appear to do nothing.
 */
export function canReorderGroups(groupBy: string, subGroupBy: string): boolean {
  return groupBy !== 'none' && subGroupBy === 'none';
}

/**
 * The private drag type a group heading carries.
 *
 * Named rather than `text/plain` so a surface that accepts both a card and a heading can tell
 * them apart from a `dragover`, where `dataTransfer.types` is the only thing the browser lets
 * a handler read — the payload itself is sealed until the drop. It is also what stops a
 * heading dragged into a text field from pasting a UUID.
 */
export const GROUP_DRAG = 'application/x-polaris-group';

/**
 * What a heading or a column needs to be arranged, as one prop rather than five.
 *
 * Absent — rather than present and inert — where the view's groups cannot be arranged, so the
 * grip, the drop targets and the menu items are not drawn at all. See `canReorderGroups`.
 */
export interface GroupReorder {
  /** The group currently held, so every other one can show it has somewhere to land. */
  readonly draggingKey: string | null;
  onStart(key: string): void;
  onEnd(): void;
  onDrop(targetKey: string): void;
  /** The pointer-free half: what the column menu's Move items and the move chords run. */
  onMove(key: string, delta: number): void;
}
