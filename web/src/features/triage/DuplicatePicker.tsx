/**
 * The menu that names the canonical issue a triage row is a duplicate of.
 *
 * It is a search, not a list. What is typed into the menu's filter comes back out through
 * `onFilterChange` and is run over the replica by `duplicateCandidates`, so the choice is
 * over every live issue in the workspace rather than over whichever rows this component
 * happened to hand the menu — the target of a merge is usually the older report, and it is
 * often in another team. With nothing typed the answer is the team's own work by recency,
 * which is the right guess for somebody who has just been looking at the target.
 *
 * The current row is not in the list: an issue cannot be a duplicate of itself.
 *
 * Each candidate carries its status icon, as an issue does in every other list in the
 * product. Without it this was the one place somebody chooses an issue by reading a column of
 * titles — and the choice it is used for, merging a triage row into a canonical one, is worth
 * seeing the target's status before making. A match from another team carries that team's
 * key too, because merging into an issue somebody else owns is a decision, not a detail.
 */

import { useEffect, useState, type RefObject } from 'react';

import { Menu, StateIcon, type MenuNode, type MenuPlacement } from '~/components';
import { useLiveQuery } from '~/hooks/useLiveQuery';
import type { UUID } from '~/store';

import { duplicateCandidates } from './duplicates';

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
  const [query, setQuery] = useState('');

  // The menu empties its own filter box once it has left the screen, and this is the same
  // reset on this side: a menu reopened on the next triage row must not answer the question
  // the previous one was asked.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const items = useLiveQuery(
    (store) => duplicateCandidates(store, { query, teamId, exclude }),
    // `workflowState` joins the list because a candidate now carries its status, and a menu
    // showing a stale status is a menu that would have somebody merge into a closed issue.
    ['issue', 'team', 'workflowState'],
    [teamId ?? '', [...exclude].join(','), query],
  );

  const nodes: MenuNode[] =
    items.length === 0
      ? [
          {
            id: 'empty',
            label: query.trim() === '' ? 'No other issues in this team' : 'No issue matches that',
            disabled: true,
            onSelect: () => {},
          },
        ]
      : items.map((item) => ({
          id: item.id,
          label: item.title,
          // The filter text is carried in the matchable text on purpose. The menu also
          // filters what it is given, by raw substring, and the search that produced these
          // rows is the server's — folded and term by term — so "acao" or "login redirect"
          // would find the right issue here and then have the menu hide it again. Searching
          // twice by two different rules is one rule too many; this leaves the menu's own
          // pass matching everything and the search deciding.
          text: `${item.identifier} ${item.title} ${query}`,
          hint:
            item.teamKey === undefined ? item.identifier : `${item.identifier} · ${item.teamKey}`,
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
      filterable
      filterPlaceholder="Search every issue…"
      emptyLabel="No issue matches that"
      onFilterChange={setQuery}
      items={nodes}
    />
  );
}
