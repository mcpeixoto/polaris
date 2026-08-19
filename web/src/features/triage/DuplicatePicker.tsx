/**
 * The menu that names the canonical issue a triage row is a duplicate of.
 *
 * Ranked by recency of update rather than by identifier, because the usual target is the
 * bug you were just looking at, not the one with the smallest number. The current row is
 * not in the list: an issue cannot be a duplicate of itself.
 */

import type { RefObject } from 'react';

import { Menu, type MenuNode, type MenuPlacement } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { Store, UUID } from '~/store';

interface DuplicatePickerProps {
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
  placement?: MenuPlacement | undefined;
  teamId: UUID | undefined;
  exclude: ReadonlySet<UUID>;
  onSelect: (canonicalId: UUID) => void;
}

export function DuplicatePicker({
  open,
  onClose,
  trigger,
  placement,
  teamId,
  exclude,
  onSelect,
}: DuplicatePickerProps) {
  const items = useLiveQuery(
    (store) => candidates(store, teamId, exclude),
    ['issue', 'team'],
    [teamId ?? '', [...exclude].join(',')],
  );

  const nodes: MenuNode[] =
    items.length === 0
      ? [{ id: 'empty', label: 'No other issues in this team', disabled: true, onSelect: () => {} }]
      : items.map((item) => ({
          id: item.id,
          label: item.title,
          text: `${item.identifier} ${item.title}`,
          hint: item.identifier,
          onSelect: () => onSelect(item.id),
        }));

  return (
    <Menu
      open={open}
      onClose={onClose}
      trigger={trigger}
      placement={placement}
      label="Mark as duplicate of"
      items={nodes}
    />
  );
}

interface Candidate {
  readonly id: UUID;
  readonly identifier: string;
  readonly title: string;
  readonly updatedAt: string;
}

function candidates(
  store: Store,
  teamId: UUID | undefined,
  exclude: ReadonlySet<UUID>,
): Candidate[] {
  if (teamId === undefined) return [];
  const rows: Candidate[] = [];
  for (const id of store.index.byTeam(teamId)) {
    if (exclude.has(id)) continue;
    const issue = store.issues.get(id);
    if (issue === undefined || issue.archivedAt !== undefined) continue;
    rows.push({
      id: issue.id,
      identifier: store.identifierOf(issue),
      title: issue.title,
      updatedAt: issue.updatedAt,
    });
  }
  rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return rows.slice(0, 40);
}
