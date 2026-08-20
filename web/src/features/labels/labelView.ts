/**
 * A label as a screen: every live issue that carries it, or every child of a group.
 *
 * Team labels stay on that team because they can only be applied there. Workspace labels
 * span teams. A group is not applied to anything, so its view is the union of its children.
 */

import type { Store, UUID } from '~/store';

export function labelViewPath(labelId: UUID): string {
  return `/label/${labelId}`;
}

export function userViewPath(userId: UUID): string {
  return `/user/${userId}`;
}

/** The issues a label view lists, or an empty set when the label is not in the replica. */
export function issueIdsForLabelView(store: Store, labelId: UUID): ReadonlySet<UUID> {
  const label = store.labels.get(labelId);
  if (label === undefined) return EMPTY;
  if (!label.isGroup) return store.issueIdsWithLabel(labelId);

  const ids = new Set<UUID>();
  for (const candidate of store.labels.values()) {
    if (candidate.parentId !== labelId || candidate.isGroup) continue;
    for (const issueId of store.issueIdsWithLabel(candidate.id)) ids.add(issueId);
  }
  return ids;
}

export function labelViewTitle(store: Store, labelId: UUID): string | null {
  const label = store.labels.get(labelId);
  if (label === undefined) return null;
  if (label.isGroup || label.parentId === undefined) return label.name;
  const group = store.labels.get(label.parentId);
  return group === undefined ? label.name : `${group.name}: ${label.name}`;
}

export function gotoLabelItems(store: Store): readonly Omit<LabelGotoItem, 'onSelect'>[] {
  const items: Omit<LabelGotoItem, 'onSelect'>[] = [];
  for (const label of store.labels.values()) {
    if (label.archivedAt !== undefined) continue;
    const group = label.parentId === undefined ? undefined : store.labels.get(label.parentId)?.name;
    items.push({
      id: label.id,
      name: label.name,
      color: label.color,
      groupName: group,
      isGroup: label.isGroup,
      teamId: label.teamId,
    });
  }
  items.sort((a, b) => {
    const left = a.groupName === undefined ? a.name : `${a.groupName}: ${a.name}`;
    const right = b.groupName === undefined ? b.name : `${b.groupName}: ${b.name}`;
    return left.localeCompare(right);
  });
  return items;
}

export interface LabelGotoItem {
  readonly id: UUID;
  readonly name: string;
  readonly color: string;
  readonly groupName: string | undefined;
  readonly isGroup: boolean;
  readonly teamId: UUID | undefined;
}

const EMPTY: ReadonlySet<UUID> = new Set();
