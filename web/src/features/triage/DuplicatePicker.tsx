/**
 * The menu that names the canonical issue a triage row is a duplicate of.
 *
 * Ranked by recency of update rather than by identifier, because the usual target is the
 * bug you were just looking at, not the one with the smallest number. The current row is
 * not in the list: an issue cannot be a duplicate of itself.
 *
 * Each candidate carries its status icon, as an issue does in every other list in the
 * product. Without it this was the one place somebody chooses an issue by reading a column of
 * titles — and the choice it is used for, merging a triage row into a canonical one, is worth
 * seeing the target's status before making.
 */

import type { RefObject } from 'react';

import { Menu, StateIcon, type MenuNode, type MenuPlacement } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { StateCategory, Store, UUID } from '~/store';

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
    // `workflowState` joins the list because a candidate now carries its status, and a menu
    // showing a stale status is a menu that would have somebody merge into a closed issue.
    ['issue', 'team', 'workflowState'],
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
          // The status, drawn the way it is drawn everywhere else. Merging into an issue that
          // is itself already closed is the mistake this menu makes easy, and the icon is what
          // makes it visible before the choice rather than after it. Decorative: the row's own
          // text is what a screen reader reads, and the status is named in the hint.
          icon: <StateIcon category={item.stateCategory} color={item.stateColor} decorative />,
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
  readonly stateCategory: StateCategory;
  readonly stateColor: string | undefined;
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
    const state = store.workflowStates.get(issue.stateId);
    rows.push({
      id: issue.id,
      identifier: store.identifierOf(issue),
      title: issue.title,
      stateCategory: state?.category ?? ('backlog' as StateCategory),
      stateColor: state?.color,
      updatedAt: issue.updatedAt,
    });
  }
  rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return rows.slice(0, 40);
}
