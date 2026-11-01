/**
 * Arranges one group's issues into families.
 *
 * In a flat list a sub-issue reads as a child of whatever happens to be above it, which is
 * usually not its parent. So within a group a child goes under its parent and siblings stay
 * together. A parent that is not in the group — filtered out, or in another group — is still
 * drawn, once, as a context row above its first child: indenting under nothing, or under the
 * wrong row, is the confusion this exists to remove.
 *
 * Pure and linear: one lookup per issue, one per context row, one row out per node. It runs
 * on every issue delta over lists of five thousand.
 */

import type { ReorderTarget } from '~/features/issue/mutations';
import type { Issue, UUID } from '~/store';

/** All this needs of a store, so the case table can hand it a bare map. */
export interface FamilySource {
  readonly issues: ReadonlyMap<UUID, Pick<Issue, 'parentId'>>;
}

export interface NestedRow {
  /** `parentContext` is a parent drawn for orientation: it is not a member of the group. */
  readonly kind: 'issue' | 'parentContext';
  readonly id: UUID;
  /** Indent levels. Zero is a top-level row. */
  readonly depth: number;
  /** The row this one is drawn under, whichever kind that row is. */
  readonly under: UUID | null;
  /** Last among its siblings, which is where its connector stops. */
  readonly last: boolean;
  /** The indent columns an ancestor's connector passes straight through on this row. */
  readonly through: readonly number[];
}

interface Node {
  readonly kind: NestedRow['kind'];
  readonly id: UUID;
}

const NOTHING: readonly number[] = [];

export function nestFamilies(ids: readonly UUID[], store: FamilySource): NestedRow[] {
  const members = new Set(ids);

  // First, every parent that needs a context row, so that a context row whose own parent is
  // another context row can be placed under it wherever the two come in the group's order.
  const contexts = new Set<UUID>();
  for (const id of ids) {
    const parentId = store.issues.get(id)?.parentId;
    if (parentId === undefined || members.has(parentId)) continue;
    // Not in the replica means not visible to this person, such as a private team's issue.
    // There is nothing to draw and nothing to name, so the child is an ordinary row.
    if (store.issues.has(parentId)) contexts.add(parentId);
  }

  const roots: Node[] = [];
  const children = new Map<UUID, Node[]>();
  const place = (node: Node, under: UUID | undefined) => {
    if (under === undefined || !(members.has(under) || contexts.has(under))) {
      roots.push(node);
      return;
    }
    const siblings = children.get(under);
    if (siblings === undefined) children.set(under, [node]);
    else siblings.push(node);
  };

  const placed = new Set<UUID>();
  for (const id of ids) {
    const parentId = store.issues.get(id)?.parentId;
    if (parentId !== undefined && contexts.has(parentId) && !placed.has(parentId)) {
      placed.add(parentId);
      place({ kind: 'parentContext', id: parentId }, store.issues.get(parentId)?.parentId);
    }
    place({ kind: 'issue', id }, parentId);
  }

  const rows: NestedRow[] = [];
  const emitted = new Set<UUID>();
  const emit = (
    node: Node,
    depth: number,
    under: UUID | null,
    last: boolean,
    through: readonly number[],
  ) => {
    if (emitted.has(node.id)) return;
    emitted.add(node.id);
    rows.push({ kind: node.kind, id: node.id, depth, under, last, through });
    const below = children.get(node.id);
    if (below === undefined) return;
    // This row's own connector carries on past its descendants unless it was the last sibling.
    const onward = depth > 0 && !last ? [...through, depth - 1] : through;
    below.forEach((child, at) => emit(child, depth + 1, node.id, at === below.length - 1, onward));
  };
  roots.forEach((node) => emit(node, 0, null, true, NOTHING));

  // A parent chain that loops has no root to be reached from. The server refuses to write one,
  // but a replica mid-sync can hold it for a moment, and an issue missing from its list is
  // worse than one that is briefly not indented.
  if (emitted.size < members.size + contexts.size) {
    for (const id of ids) emit({ kind: 'issue', id }, 0, null, true, NOTHING);
  }
  return rows;
}

/**
 * Which issue a manual reorder moves, and between which neighbours it lands.
 *
 * "One place up" means one place among the row's siblings. The row above on screen may be a
 * niece, and taking its key would land this row somewhere unrelated, or do nothing at all.
 *
 * The neighbours named are still neighbours in `ids`, the group's flat order, because that
 * order is what `sortOrder` decides and what the server mints against. The sibling only says
 * where: a context row has no key of its own and sits where its first child does. Going tight
 * on the flat order also keeps a move inside a family from dragging the family: a first child
 * sent "to the top" with `moveToTop` would take the context row above it to the top of the
 * whole list.
 *
 * `order` is the group's issues in flat order and `targets` is what the command acts on. One
 * issue at a time: moving a multi-row selection through a manual order is several mints with
 * several answers about what "one place up" means for the rows in between, and the spec's
 * gesture is about the row under the cursor.
 *
 * A `delta` larger than the list is how "to the top" and "to the bottom" are said: the clamp
 * does the rest, and there is no second code path to keep in step with this one.
 */
export function reorderPlan(
  order: readonly UUID[],
  store: FamilySource,
  targets: readonly UUID[],
  delta: number,
): { id: UUID; target: ReorderTarget } | null {
  if (targets.length !== 1) return null;
  const id = targets[0]!;
  if (!order.includes(id)) return null;

  const rows = nestFamilies(order, store);
  const self = rows.find((row) => row.kind === 'issue' && row.id === id);
  if (self === undefined) return null;
  const siblings = rows.filter((row) => row.under === self.under && row.depth === self.depth);

  const from = siblings.indexOf(self);
  const to = Math.min(Math.max(from + delta, 0), siblings.length - 1);
  if (to === from) return null;

  const flat = order.filter((candidate) => candidate !== id);
  const anchorAt = (row: NestedRow): number => {
    if (row.kind === 'issue') return flat.indexOf(row.id);
    // Never -1: a context row exists because a member names it as parent, and the moved row
    // is its sibling here rather than its child, so `flat` still holds that member.
    return flat.findIndex((candidate) => store.issues.get(candidate)?.parentId === row.id);
  };

  // Past the neighbour in the direction of travel. Downward that is right after its anchor,
  // upward right before it.
  const neighbour = siblings[to]!;
  const at = anchorAt(neighbour) + (to > from ? 1 : 0);
  return {
    id,
    target: { afterId: flat[at - 1] ?? null, beforeId: flat[at] ?? null },
  };
}
